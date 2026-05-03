import { execOrThrow } from '../_internal/exec';
import { ghAuthEnv } from './_internal/git-env';

export interface PushInput {
  workdir: string;
  branch: string;
  setUpstream?: boolean;
  force?: boolean;
}

export async function pushBranchActivity(input: PushInput): Promise<void> {
  const env = ghAuthEnv();
  const args = ['push'];
  if (input.setUpstream) args.push('-u');
  if (input.force) args.push('--force-with-lease');
  args.push('origin', input.branch);
  await execOrThrow('git', args, { cwd: input.workdir, env });
}
