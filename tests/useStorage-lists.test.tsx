// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import {
  useEarnedAchievements,
  useQuestionNotes,
  useQuestionVotes,
} from '@/lib/useStorage';
import {
  recordEarnedAchievements,
  recordNote,
  recordVote,
  saveAchievements,
} from '@/lib/storage';

// Pins the shared contract of the three reactive list hooks: they read
// storage on mount, re-read on the app's storage event AND on the
// cross-tab `storage` event, and their setters write through and
// re-render. One behaviour, three hooks — a refactor that folds them
// together must keep all of it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {});
}

async function fire(name: string) {
  await act(async () => {
    window.dispatchEvent(new Event(name));
  });
}

let votesApi: ReturnType<typeof useQuestionVotes> | undefined;
let notesApi: ReturnType<typeof useQuestionNotes> | undefined;

function Stickers() {
  const { earned, earnedList } = useEarnedAchievements();
  return (
    <div data-testid="stickers" data-count={earnedList.length}>
      {[...earned].sort().join(',')}
    </div>
  );
}

function Votes() {
  votesApi = useQuestionVotes();
  return (
    <div data-testid="votes" data-count={votesApi.votesList.length}>
      {[...votesApi.votes.entries()].map(([q, v]) => `${q}:${v.vote}`).join(',')}
    </div>
  );
}

function Notes() {
  notesApi = useQuestionNotes();
  return (
    <div data-testid="notes" data-count={notesApi.notesList.length}>
      {[...notesApi.notes.entries()].map(([q, n]) => `${q}:${n.text}`).join(',')}
    </div>
  );
}

const text = (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent;
const count = (id: string) =>
  container.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-count');

describe('useEarnedAchievements', () => {
  it('reads storage on mount and exposes both a set and the list', async () => {
    saveAchievements([
      { id: 'b', earnedAt: 2 },
      { id: 'a', earnedAt: 1 },
    ]);
    await render(<Stickers />);
    expect(text('stickers')).toBe('a,b');
    expect(count('stickers')).toBe('2');
  });

  it('re-reads on the app storage event and on the cross-tab storage event', async () => {
    await render(<Stickers />);
    expect(text('stickers')).toBe('');

    recordEarnedAchievements(['first']);
    expect(text('stickers')).toBe(''); // no event yet → not re-read
    await fire('quizmill:storage');
    expect(text('stickers')).toBe('first');

    recordEarnedAchievements(['second']);
    await fire('storage');
    expect(text('stickers')).toBe('first,second');
  });
});

describe('useQuestionVotes', () => {
  it('reads on mount, and setVote writes through and re-renders', async () => {
    recordVote('q1', 'up');
    await render(<Votes />);
    expect(text('votes')).toBe('q1:up');

    await act(async () => {
      votesApi!.setVote('q2', 'down', 'unclear');
    });
    expect(text('votes')).toBe('q1:up,q2:down');
    expect(votesApi!.votes.get('q2')?.comment).toBe('unclear');

    await act(async () => {
      votesApi!.setVote('q1', null);
    });
    expect(text('votes')).toBe('q2:down');
    expect(count('votes')).toBe('1');
  });

  it('re-reads when another writer fires the storage event', async () => {
    await render(<Votes />);
    recordVote('q9', 'up');
    await fire('quizmill:storage');
    expect(text('votes')).toBe('q9:up');
  });
});

describe('useQuestionNotes', () => {
  it('reads on mount, and setNote upserts / deletes with re-render', async () => {
    recordNote('q1', 'remember this');
    await render(<Notes />);
    expect(text('notes')).toBe('q1:remember this');

    await act(async () => {
      notesApi!.setNote('q1', 'edited');
    });
    expect(text('notes')).toBe('q1:edited');

    await act(async () => {
      notesApi!.setNote('q1', '   ');
    });
    expect(text('notes')).toBe('');
    expect(count('notes')).toBe('0');
  });

  it('re-reads on the cross-tab storage event', async () => {
    await render(<Notes />);
    recordNote('q3', 'from another tab');
    await fire('storage');
    expect(text('notes')).toBe('q3:from another tab');
  });
});
