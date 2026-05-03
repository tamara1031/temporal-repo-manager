import { execOrThrow } from '../_internal/exec';
import { ghEnv } from './_internal/gh-env';

export interface MergePRInput {
  repoFullName: string;
  prNumber: number;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  deleteBranch?: boolean;
}

export async function mergePRActivity(input: MergePRInput): Promise<void> {
  const env = ghEnv();
  const method = input.mergeMethod ?? 'squash';
  const args = [
    'pr',
    'merge',
    String(input.prNumber),
    '--repo',
    input.repoFullName,
    `--${method}`,
    '--auto',
  ];
  if (input.deleteBranch) args.push('--delete-branch');
  await execOrThrow('gh', args, { env });
}
