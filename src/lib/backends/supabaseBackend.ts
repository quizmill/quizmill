/**
 * Supabase sync backend — the original cloud mirror, now behind the
 * SyncBackend interface. Auth is Supabase's email OTP; rows live in the
 * four tables created by supabase/migrations/ and are guarded by RLS.
 *
 * The row-mapping layer (local camelCase ⇄ Postgres snake_case) lives
 * here because it's a Supabase-schema detail — the worker backend ships
 * local shapes verbatim instead.
 */
import { APP_CONFIG } from '@/config';
import type { Attempt, Session } from '@/data/types';
import * as storage from '../storage';
import { getSupabase } from '../supabase';
import type { QueueOp, RemoteData, SyncBackend } from '../syncBackend';

// All packs share one Supabase project, so every row is partitioned by the
// pack that wrote it. Reads filter by it and writes stamp it; without this a
// user signed in to two packs would see their histories commingled.
const PACK_ID = APP_CONFIG.packId;

// ── Field mapping: local camelCase  ⇄  Supabase snake_case ───────────────

function sessionToRow(s: Session, user_id: string) {
  return {
    id: s.id,
    user_id,
    pack_id: PACK_ID,
    subject: s.subject,
    started_at: new Date(s.startedAt).toISOString(),
    ended_at: s.endedAt != null ? new Date(s.endedAt).toISOString() : null,
    question_count: s.questionCount,
    correct_count: s.correctCount,
    mode: s.mode ?? 'practice',
  };
}
function rowToSession(r: Record<string, unknown>): Session {
  return {
    id: r.id as string,
    subject: r.subject as Session['subject'],
    startedAt: Date.parse(r.started_at as string),
    endedAt: r.ended_at ? Date.parse(r.ended_at as string) : null,
    questionCount: r.question_count as number,
    correctCount: r.correct_count as number,
    mode: r.mode as Session['mode'],
  };
}

function attemptToRow(a: Attempt, user_id: string) {
  return {
    id: a.id,
    user_id,
    pack_id: PACK_ID,
    session_id: a.sessionId,
    question_id: a.questionId,
    answered_at: new Date(a.answeredAt).toISOString(),
    selected_answer: a.selectedAnswer,
    is_correct: a.isCorrect,
    time_taken_seconds: a.timeTakenSeconds,
    subject: a.subject,
    topic: a.topic,
    difficulty: a.difficulty,
  };
}
function rowToAttempt(r: Record<string, unknown>): Attempt {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    questionId: r.question_id as string,
    answeredAt: Date.parse(r.answered_at as string),
    selectedAnswer: r.selected_answer as string,
    isCorrect: r.is_correct as boolean,
    timeTakenSeconds: r.time_taken_seconds as number,
    subject: r.subject as Attempt['subject'],
    topic: r.topic as string,
    difficulty: r.difficulty as number,
  };
}

function achievementToRow(a: storage.EarnedAchievement, user_id: string) {
  return {
    user_id,
    pack_id: PACK_ID,
    achievement_id: a.id,
    earned_at: new Date(a.earnedAt).toISOString(),
  };
}
function rowToAchievement(r: Record<string, unknown>): storage.EarnedAchievement {
  return {
    id: r.achievement_id as string,
    earnedAt: Date.parse(r.earned_at as string),
  };
}

function voteToRow(v: storage.QuestionVote, user_id: string) {
  return {
    user_id,
    pack_id: PACK_ID,
    question_id: v.questionId,
    vote: v.vote,
    comment: v.comment ?? null,
    voted_at: new Date(v.votedAt).toISOString(),
  };
}
function rowToVote(r: Record<string, unknown>): storage.QuestionVote {
  return {
    questionId: r.question_id as string,
    vote: r.vote as storage.VoteDir,
    comment: (r.comment as string) ?? undefined,
    votedAt: Date.parse(r.voted_at as string),
  };
}

function noteToRow(n: storage.QuestionNote, user_id: string) {
  return {
    user_id,
    pack_id: PACK_ID,
    question_id: n.questionId,
    text: n.text,
    updated_at: new Date(n.updatedAt).toISOString(),
  };
}
function rowToNote(r: Record<string, unknown>): storage.QuestionNote {
  return {
    questionId: r.question_id as string,
    text: r.text as string,
    updatedAt: Date.parse(r.updated_at as string),
  };
}

// ── SyncBackend impl ────────────────────────────────────────────────────

export const supabaseBackend: SyncBackend = {
  async getUserId() {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session?.user.id ?? null;
  },

  onAuthChange(cb) {
    const sb = getSupabase();
    if (!sb) return;
    sb.auth.onAuthStateChange((_event, session) => {
      cb(session?.user.id ?? null);
    });
  },

  async runOp(op: QueueOp, user_id: string) {
    const sb = getSupabase();
    if (!sb) throw new Error('supabase client unavailable');
    switch (op.t) {
      case 'sessions': {
        const { error } = await sb.from('sessions').upsert(sessionToRow(op.row, user_id));
        if (error) throw error;
        return;
      }
      case 'attempts': {
        const { error } = await sb.from('attempts').upsert(attemptToRow(op.row, user_id));
        if (error) throw error;
        return;
      }
      case 'achievements': {
        // Achievements are write-once (earned_at never changes), so use
        // ON CONFLICT DO NOTHING (ignoreDuplicates) rather than DO UPDATE.
        // This makes the first-sign-in bulk re-push of rows that were just
        // pulled a true no-op, and — crucially — needs only the INSERT RLS
        // policy: the achievements table has no UPDATE policy, so an
        // upsert-as-update was rejected and wedged the queue ("Couldn't sync N").
        // The local merge already keeps the earliest unlock time (storage.ts).
        const { error } = await sb
          .from('achievements')
          .upsert(achievementToRow(op.row, user_id), {
            onConflict: 'user_id,pack_id,achievement_id',
            ignoreDuplicates: true,
          });
        if (error) throw error;
        return;
      }
      case 'votes': {
        if (op.op === 'delete') {
          const { error } = await sb
            .from('votes')
            .delete()
            .eq('user_id', user_id)
            .eq('pack_id', PACK_ID)
            .eq('question_id', op.questionId);
          if (error) throw error;
          return;
        }
        const { error } = await sb
          .from('votes')
          .upsert(voteToRow(op.row, user_id), { onConflict: 'user_id,pack_id,question_id' });
        if (error) throw error;
        return;
      }
      case 'notes': {
        if (op.op === 'delete') {
          const { error } = await sb
            .from('notes')
            .delete()
            .eq('user_id', user_id)
            .eq('pack_id', PACK_ID)
            .eq('question_id', op.questionId);
          if (error) throw error;
          return;
        }
        const { error } = await sb
          .from('notes')
          .upsert(noteToRow(op.row, user_id), { onConflict: 'user_id,pack_id,question_id' });
        if (error) throw error;
        return;
      }
      case 'clear-all': {
        // Pack-scoped: clearing history in one pack must not wipe the user's
        // rows for the other packs sharing this project.
        for (const table of ['sessions', 'attempts', 'achievements', 'votes', 'notes']) {
          const { error } = await sb
            .from(table)
            .delete()
            .eq('user_id', user_id)
            .eq('pack_id', PACK_ID);
          if (error) throw error;
        }
        return;
      }
      case 'clear-sessions': {
        const { error: aErr } = await sb
          .from('attempts')
          .delete()
          .eq('user_id', user_id)
          .eq('pack_id', PACK_ID)
          .in('session_id', op.sessionIds);
        if (aErr) throw aErr;
        const { error: sErr } = await sb
          .from('sessions')
          .delete()
          .eq('user_id', user_id)
          .eq('pack_id', PACK_ID)
          .in('id', op.sessionIds);
        if (sErr) throw sErr;
        return;
      }
    }
  },

  async pullAll(user_id: string): Promise<RemoteData> {
    const sb = getSupabase();
    if (!sb) throw new Error('supabase client unavailable');
    const [sessions, attempts, achievements, votes, notes] = await Promise.all([
      sb.from('sessions').select('*').eq('user_id', user_id).eq('pack_id', PACK_ID),
      sb.from('attempts').select('*').eq('user_id', user_id).eq('pack_id', PACK_ID),
      sb.from('achievements').select('*').eq('user_id', user_id).eq('pack_id', PACK_ID),
      sb.from('votes').select('*').eq('user_id', user_id).eq('pack_id', PACK_ID),
      sb.from('notes').select('*').eq('user_id', user_id).eq('pack_id', PACK_ID),
    ]);
    return {
      sessions: (sessions.data ?? []).map(rowToSession),
      attempts: (attempts.data ?? []).map(rowToAttempt),
      achievements: (achievements.data ?? []).map(rowToAchievement),
      votes: (votes.data ?? []).map(rowToVote),
      notes: (notes.data ?? []).map(rowToNote),
    };
  },
};
