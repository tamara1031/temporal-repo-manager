import * as fs from 'fs/promises';
import * as path from 'path';
import { log } from '@temporalio/activity';
import { execCommand, execOrThrow } from '../_internal/exec';
import { ghAuthEnv } from './_internal/git-env';

export interface CheckConflictInput {
  workdir: string;
  baseBranch: string;
}

export interface CheckConflictOutput {
  hasConflict: boolean;
  conflictedFiles: string[];
  diffSummary?: string;
}

async function isMergeInProgress(workdir: string): Promise<boolean> {
  try {
    await fs.access(path.join(workdir, '.git', 'MERGE_HEAD'));
    return true;
  } catch {
    return false;
  }
}

export async function checkConflictActivity(
  input: CheckConflictInput,
): Promise<CheckConflictOutput> {
  const env = ghAuthEnv();
  await execOrThrow('git', ['fetch', 'origin', input.baseBranch], { cwd: input.workdir, env });

  // Trial merge with --no-commit --no-ff. A non-zero exit only signals "conflicts
  // present"; we still need to scan the index to enumerate them.
  const trial = await execCommand(
    'git',
    ['merge', '--no-commit', '--no-ff', `origin/${input.baseBranch}`],
    { cwd: input.workdir, env },
  );
  if (trial.code !== 0) {
    log.info('Trial merge exited non-zero (likely conflicts)', { code: trial.code });
  }

  const diff = await execOrThrow('git', ['diff', '--name-only', '--diff-filter=U'], {
    cwd: input.workdir,
  });
  const conflicted = diff.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  let diffSummary: string | undefined;
  if (conflicted.length > 0) {
    const summary = await execOrThrow('git', ['diff', '--cc'], { cwd: input.workdir });
    diffSummary = summary.stdout.slice(0, 16 * 1024);
  }

  // Abort only when a merge is actually in progress; otherwise `merge --abort`
  // would error spuriously.
  if (await isMergeInProgress(input.workdir)) {
    await execCommand('git', ['merge', '--abort'], { cwd: input.workdir });
  }

  return {
    hasConflict: conflicted.length > 0,
    conflictedFiles: conflicted,
    diffSummary,
  };
}
