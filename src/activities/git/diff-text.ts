import { execOrThrow } from '../_internal/exec';

export interface DiffTextInput {
  workdir: string;
  /** Truncate the returned diff to this many bytes. Default 8 KiB. */
  maxBytes?: number;
}

export interface DiffTextOutput {
  /** UTF-8 truncated diff text. Empty when there are no changes. */
  text: string;
  /** True when the underlying `git diff` was longer than `maxBytes`. */
  truncated: boolean;
}

/** Full unified diff for reviewer input. Truncated to keep activity payloads small. */
export async function diffTextActivity(input: DiffTextInput): Promise<DiffTextOutput> {
  const res = await execOrThrow('git', ['diff'], { cwd: input.workdir });
  const max = input.maxBytes ?? 8 * 1024;
  if (res.stdout.length <= max) return { text: res.stdout, truncated: false };
  return { text: res.stdout.slice(0, max), truncated: true };
}
