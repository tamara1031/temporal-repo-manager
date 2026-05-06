import { createHash } from 'crypto';
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
  /**
   * SHA-256 hex digest of the FULL diff before truncation.
   * Used for no-progress detection: comparing hashes is correct regardless of
   * whether the diff was truncated, unlike comparing the text prefix.
   */
  contentHash: string;
}

/** Full unified diff for reviewer input. Truncated to keep activity payloads small. */
export async function diffTextActivity(input: DiffTextInput): Promise<DiffTextOutput> {
  const res = await execOrThrow('git', ['diff'], { cwd: input.workdir });
  const full = res.stdout;
  const contentHash = createHash('sha256').update(full).digest('hex');
  const max = input.maxBytes ?? 8 * 1024;
  if (full.length <= max) return { text: full, truncated: false, contentHash };
  return { text: full.slice(0, max), truncated: true, contentHash };
}
