/**
 * The published-pack registry format (tools/pack/registry.json) and its
 * cross-entry checks — the registry's equivalent of schema.ts/validatePack.
 *
 * It exists because a registry PR can be conflict-FREE and still be wrong:
 * two branches that each append an entry for the same pack merge cleanly
 * into a registry listing that pack TWICE. Git can't see it; this can.
 * Everything that reads the registry runs these checks, so a duplicate id
 * fails `npm run pack:list` and the unit test rather than shipping.
 */
import { z } from 'zod';

const slug = /^[a-z0-9][a-z0-9-]*$/;

export const registryEntrySchema = z
  .object({
    /** Short stable slug — also the pack's subdomain and Pages project. */
    id: z.string().regex(slug).max(40),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(600),
    /** GitHub "owner/name" holding a valid pack at the repo root. */
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    /** Review maturity of the question bank — see docs/pack-registry.md.
     *  `draft` until a human has actually reviewed the questions. */
    status: z.enum(['draft', 'reviewed', 'maintained']).optional(),
    /** Mechanically derived capability badges — see docs/pack-registry.md. */
    badges: z.array(z.string().regex(slug).max(30)).max(8).optional(),
    demoUrl: z.string().url().max(300).optional(),
    questionCount: z.number().int().positive().max(100000).optional(),
  })
  .strict();

export const registrySchema = z
  .object({
    $comment: z.string().optional(),
    packs: z.array(registryEntrySchema).min(1),
  })
  .strict();

export type RegistryEntry = z.infer<typeof registryEntrySchema>;
export type Registry = z.infer<typeof registrySchema>;

/**
 * Parse + cross-check a registry. Returns the entries, or throws with every
 * problem listed at once (same contract as the pack validator: loop until
 * clean). Cross-entry rules git merges cannot catch:
 *   - ids are unique (the duplicate-append trap)
 *   - repos are unique (two ids pointing at one pack repo)
 */
export function validateRegistry(raw: unknown): RegistryEntry[] {
  const parsed = registrySchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map(
      (i) => `registry.json${i.path.length ? `[${i.path.join('.')}]` : ''}: ${i.message}`,
    );
    throw new Error(`invalid registry:\n  ${errors.join('\n  ')}`);
  }

  const errors: string[] = [];
  for (const field of ['id', 'repo'] as const) {
    const seen = new Map<string, number>();
    for (const entry of parsed.data.packs) {
      seen.set(entry[field], (seen.get(entry[field]) ?? 0) + 1);
    }
    for (const [value, count] of Array.from(seen)) {
      if (count > 1) {
        errors.push(
          `registry.json: ${field} "${value}" appears ${count} times — ` +
            `each pack gets exactly one entry (did two branches both add it?)`,
        );
      }
    }
  }
  if (errors.length) throw new Error(`invalid registry:\n  ${errors.join('\n  ')}`);

  return parsed.data.packs;
}
