import { execOrThrow } from '../_internal/exec';

export interface CommitInput {
  workdir: string;
  message: string;
}

export interface CommitOutput {
  committed: boolean;
  sha?: string;
}

export async function commitAllActivity(input: CommitInput): Promise<CommitOutput> {
  await execOrThrow('git', ['add', '-A'], { cwd: input.workdir });
  const status = await execOrThrow('git', ['status', '--porcelain'], { cwd: input.workdir });
  if (!status.stdout.trim()) {
    return { committed: false };
  }
  await execOrThrow('git', ['commit', '-m', input.message], { cwd: input.workdir });
  const sha = (await execOrThrow('git', ['rev-parse', 'HEAD'], { cwd: input.workdir })).stdout
    .trim();
  return { committed: true, sha };
}
