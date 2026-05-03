import { execOrThrow } from '../_internal/exec';

export interface DiffStatInput {
  workdir: string;
}

export interface DiffStatOutput {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/**
 * Parse `git diff --shortstat` (e.g. " 2 files changed, 18 insertions(+), 7 deletions(-)").
 * Empty diff returns zeros. Used for the pre-Parliament trivial-diff gate.
 */
export async function diffStatActivity(input: DiffStatInput): Promise<DiffStatOutput> {
  const res = await execOrThrow('git', ['diff', '--shortstat'], { cwd: input.workdir });
  const text = res.stdout.trim();
  if (!text) return { filesChanged: 0, insertions: 0, deletions: 0 };
  const filesMatch = text.match(/(\d+)\s+files?\s+changed/);
  const insMatch = text.match(/(\d+)\s+insertions?\(\+\)/);
  const delMatch = text.match(/(\d+)\s+deletions?\(-\)/);
  return {
    filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
    insertions: insMatch ? parseInt(insMatch[1], 10) : 0,
    deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
  };
}
