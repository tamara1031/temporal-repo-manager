import { execCommand } from '../_internal/exec';
import { ghEnv } from './_internal/gh-env';

export interface FetchFailedLogsInput {
  repoFullName: string;
  runId: string;
  maxBytes?: number;
}

export async function fetchFailedRunLogsActivity(input: FetchFailedLogsInput): Promise<string> {
  const env = ghEnv();
  const max = input.maxBytes ?? 256 * 1024;
  const res = await execCommand(
    'gh',
    ['run', 'view', input.runId, '--repo', input.repoFullName, '--log-failed'],
    { env },
  );
  const combined = (res.stdout || '') + (res.code === 0 ? '' : `\n[stderr]\n${res.stderr}`);
  return combined.slice(0, max);
}
