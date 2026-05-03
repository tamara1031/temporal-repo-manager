import { execOrThrow } from '../_internal/exec';

export interface SnapshotInput {
  workdir: string;
}

export interface SnapshotOutput {
  /** True when there were pending changes and a checkpoint commit was created. */
  snapped: boolean;
}

/**
 * Commits all current working-tree changes (tracked and untracked) as a
 * temporary internal checkpoint commit so that a later call to
 * `popWorkdirSnapshotActivity` can restore exactly the pre-step state —
 * even if a subsequent step modified the same files.
 *
 * Pre-commit hooks are skipped (`--no-verify`) because this commit is
 * ephemeral and is always undone by `popWorkdirSnapshotActivity` before
 * the branch is pushed.
 */
export async function snapshotWorkdirActivity(input: SnapshotInput): Promise<SnapshotOutput> {
  await execOrThrow('git', ['add', '-A'], { cwd: input.workdir });
  const status = await execOrThrow('git', ['status', '--porcelain'], { cwd: input.workdir });
  if (!status.stdout.trim()) {
    return { snapped: false };
  }
  await execOrThrow('git', ['commit', '--no-verify', '-m', '__steward-snapshot__'], {
    cwd: input.workdir,
  });
  return { snapped: true };
}

/**
 * Undoes the checkpoint commit made by `snapshotWorkdirActivity`, returning
 * its changes to the working tree as unstaged modifications.
 * Only call this when `snapshotWorkdirActivity` returned `{ snapped: true }`.
 */
export async function popWorkdirSnapshotActivity(input: SnapshotInput): Promise<void> {
  // --mixed (default): HEAD and index roll back one commit; working tree untouched
  await execOrThrow('git', ['reset', 'HEAD~1'], { cwd: input.workdir });
}
