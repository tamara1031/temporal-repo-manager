import { execOrThrow } from '../_internal/exec';
import { ghEnv } from './_internal/gh-env';
import { parsePRViewJSON } from './_internal/pr-view';

export interface CreatePRInput {
  repoFullName: string;
  workdir: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface PRInfo {
  number: number;
  url: string;
  branch: string;
  baseBranch: string;
  repoFullName: string;
}

export async function createPRActivity(input: CreatePRInput): Promise<PRInfo> {
  const env = ghEnv();
  const args = [
    'pr',
    'create',
    '--repo',
    input.repoFullName,
    '--base',
    input.baseBranch,
    '--head',
    input.branch,
    '--title',
    input.title,
    '--body',
    input.body,
  ];
  if (input.draft) args.push('--draft');
  await execOrThrow('gh', args, { cwd: input.workdir, env });
  const view = await execOrThrow(
    'gh',
    ['pr', 'view', input.branch, '--repo', input.repoFullName, '--json', 'number,url'],
    { cwd: input.workdir, env },
  );
  const parsed = parsePRViewJSON(view.stdout);
  return {
    number: parsed.number,
    url: parsed.url,
    branch: input.branch,
    baseBranch: input.baseBranch,
    repoFullName: input.repoFullName,
  };
}
