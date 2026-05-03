import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execOrThrow } from '../_internal/exec';
import {
  fetchRemoteBranchRefSpec,
  ghAuthEnv,
  gitCloneUrl,
  remoteBranchRef,
} from './_internal/git-env';

export interface CloneInput {
  repoFullName: string;
  ref?: string;
  branch: string;
  workspaceRoot?: string;
}

export interface CloneOutput {
  workdir: string;
  branch: string;
  baseSha: string;
}

export async function cloneRepoActivity(input: CloneInput): Promise<CloneOutput> {
  const root = input.workspaceRoot ?? path.join(os.tmpdir(), 'repo-steward-workspaces');
  await fs.mkdir(root, { recursive: true });
  const safeName = input.repoFullName.replace('/', '__');
  const workdir = await fs.mkdtemp(path.join(root, `${safeName}-`));

  const env = ghAuthEnv();
  await execOrThrow('git', ['clone', '--depth', '50', gitCloneUrl(input.repoFullName), workdir], {
    env,
  });

  // Identity used by all auto-generated commits. Override with GIT_BOT_NAME /
  // GIT_BOT_EMAIL on the Worker so the commits clearly attribute to a known
  // bot account (e.g. your own GitHub no-reply address) instead of the
  // default placeholder.
  const botName = process.env.GIT_BOT_NAME ?? 'repo-steward-bot';
  const botEmail = process.env.GIT_BOT_EMAIL ?? 'ai-agent@users.noreply.github.com';
  await execOrThrow('git', ['config', 'user.email', botEmail], { cwd: workdir });
  await execOrThrow('git', ['config', 'user.name', botName], { cwd: workdir });

  if (input.ref) {
    const remoteRef = remoteBranchRef(input.ref);
    await execOrThrow(
      'git',
      ['fetch', '--depth', '50', 'origin', fetchRemoteBranchRefSpec(input.ref)],
      { cwd: workdir, env },
    );
    await execOrThrow('git', ['checkout', '--detach', remoteRef], { cwd: workdir });
  }

  await execOrThrow('git', ['checkout', '-b', input.branch], { cwd: workdir });

  const headRes = await execOrThrow('git', ['rev-parse', 'HEAD'], { cwd: workdir });
  return {
    workdir,
    branch: input.branch,
    baseSha: headRes.stdout.trim(),
  };
}
