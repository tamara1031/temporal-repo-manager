import { execOrThrow } from '../_internal/exec';

export interface RestoreInput {
  workdir: string;
  /**
   * When omitted, the entire working tree is reset: tracked files are reverted
   * to the index and any untracked files / directories are removed.
   */
  paths?: string[];
}

/**
 * Roll back working-tree changes for the given paths (or everything when
 * `paths` is omitted).
 *
 * The naive `git checkout -- <paths>` we used to call here fails as soon as
 * one of the paths is untracked (`??`) or a pure staged-add — those files do
 * not exist in HEAD, so there is nothing to "check out". Callers feed us
 * paths derived straight from `git status --porcelain`, so untracked entries
 * are routine. We classify each path through `git status --porcelain` again
 * (using the same paths as a pathspec, so it is bounded by the caller's
 * request) and dispatch:
 *
 *   - tracked changes (modifications, deletions, renames) → `git checkout --`
 *   - untracked files (`??`) and staged-adds (`A?`)        → drop from index
 *     (tolerating untracked) and then `git clean -fd` from the worktree
 *
 * Paths that are already clean simply do not appear in the status output, so
 * they're silently skipped.
 */
export async function restoreActivity(input: RestoreInput): Promise<void> {
  const { workdir } = input;
  const paths = input.paths;

  if (!paths || paths.length === 0) {
    // Full restore: revert tracked working-tree changes, then drop any
    // untracked files / directories the implementer may have created.
    await execOrThrow('git', ['checkout', '--', '.'], { cwd: workdir });
    await execOrThrow('git', ['clean', '-fd'], { cwd: workdir });
    return;
  }

  const status = await execOrThrow(
    'git',
    ['status', '--porcelain', '--', ...paths],
    { cwd: workdir },
  );

  const toCheckout: string[] = [];
  const toRemove: string[] = [];

  for (const raw of status.stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (!rest) continue;
    const target = rest.split(' -> ').pop() ?? rest;

    // `??` is purely untracked; an `A` in either position means the file was
    // added in the index without any HEAD counterpart. Both cases have
    // nothing to "check out", so the only sensible rollback is to delete.
    if (xy === '??' || xy[0] === 'A' || xy[1] === 'A') {
      toRemove.push(target);
    } else {
      toCheckout.push(target);
    }
  }

  if (toCheckout.length > 0) {
    await execOrThrow('git', ['checkout', '--', ...toCheckout], { cwd: workdir });
  }
  if (toRemove.length > 0) {
    // Drop any index entry first so staged-adds become untracked, then wipe
    // the working-tree files. `--ignore-unmatch` keeps purely-untracked
    // paths (which were never in the index) from failing the rm.
    await execOrThrow(
      'git',
      ['rm', '-f', '--cached', '--ignore-unmatch', '--', ...toRemove],
      { cwd: workdir },
    );
    await execOrThrow('git', ['clean', '-fd', '--', ...toRemove], { cwd: workdir });
  }
}
