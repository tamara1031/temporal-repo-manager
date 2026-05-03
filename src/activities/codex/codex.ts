/**
 * `codexActivity` — generic single-shot codex Activity used outside the
 * refactor pipeline (CI self-heal, merge-conflict resolution in pr-lifecycle).
 * The refactor pipeline uses the role-specific activities in `../refactor/`
 * for visibility; this one is for ad-hoc "run codex on the working tree once"
 * scenarios where decomposition adds no value.
 */

import { execCommand } from '../_internal/exec';
import { runCodexExec } from '../_internal/run-codex';

export interface CodexInput {
  workdir: string;
  prompt: string;
  /** Optional system-level instruction prepended to the prompt. */
  systemPrompt?: string;
  /** Optional supporting context (logs, diffs) prepended to the prompt. */
  context?: string;
  /** Files to focus on. Appended as a hint; codex still has full repo access. */
  paths?: string[];
  model?: string;
  timeoutMs?: number;
}

export interface CodexOutput {
  /** Trimmed last message (truncated to 16 KiB). */
  message: string;
  /** Files codex modified, derived from `git status --porcelain`. */
  changedFiles: string[];
}

const GENERIC_DEFAULT_TIMEOUT_MS = 80 * 60 * 1000;

export async function codexActivity(input: CodexInput): Promise<CodexOutput> {
  const parts = [input.systemPrompt?.trim(), input.context?.trim(), input.prompt.trim()].filter(
    Boolean,
  ) as string[];
  if (input.paths && input.paths.length > 0) {
    parts.push('Focus on these paths:\n' + input.paths.map((p) => ` - ${p}`).join('\n'));
  }
  const fullPrompt = parts.join('\n\n');

  const out = await runCodexExec({
    workdir: input.workdir,
    prompt: fullPrompt,
    timeoutMs: input.timeoutMs ?? GENERIC_DEFAULT_TIMEOUT_MS,
    model: input.model,
  });
  const changedFiles = await changedFilesIn(input.workdir);
  return {
    message: out.lastMessage.slice(0, 16 * 1024),
    changedFiles,
  };
}

async function changedFilesIn(workdir: string): Promise<string[]> {
  const res = await execCommand('git', ['status', '--porcelain'], { cwd: workdir });
  if (res.code !== 0) return [];
  return res.stdout
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}
