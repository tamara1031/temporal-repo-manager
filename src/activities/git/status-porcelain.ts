import { execOrThrow } from '../_internal/exec';

export interface PorcelainInput {
  workdir: string;
}

export interface PorcelainOutput {
  /** `git status --porcelain` lines (e.g. ` M src/foo.ts`, `?? src/bar.ts`). */
  entries: string[];
}

/** Snapshot working-tree state. Used to detect reviewer drift between Parliament rounds. */
export async function statusPorcelainActivity(input: PorcelainInput): Promise<PorcelainOutput> {
  const res = await execOrThrow('git', ['status', '--porcelain'], { cwd: input.workdir });
  const entries = res.stdout
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter(Boolean);
  return { entries };
}
