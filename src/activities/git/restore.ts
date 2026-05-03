import { execOrThrow } from '../_internal/exec';

export interface RestoreInput {
  workdir: string;
  /** When omitted, restores everything (`git restore .`). */
  paths?: string[];
}

export async function restoreActivity(input: RestoreInput): Promise<void> {
  const args = ['checkout', '--'];
  if (input.paths && input.paths.length > 0) {
    args.push(...input.paths);
  } else {
    // `git restore .` is the documented form, but `git checkout -- .` is universally available.
    args.push('.');
  }
  await execOrThrow('git', args, { cwd: input.workdir });
}
