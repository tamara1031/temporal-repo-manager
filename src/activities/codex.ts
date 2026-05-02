import { ApplicationFailure } from '@temporalio/activity';
import { execCommand } from './_exec';

export interface CodexInput {
  workdir: string;
  prompt: string;
  /** Optional system-level instruction prepended to the prompt. */
  systemPrompt?: string;
  /** Optional supporting context (logs, diffs, prior analysis) prepended to the prompt. */
  context?: string;
  /** Files to focus on. Appended to the prompt as a hint; codex still has full repo access. */
  paths?: string[];
  model?: string;
  timeoutMs?: number;
}

export interface CodexOutput {
  /** Trimmed stdout from codex (truncated to 16 KiB). */
  message: string;
  /** Full raw stdout. */
  raw: string;
  /** Files codex modified, derived from `git status --porcelain`. */
  changedFiles: string[];
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

async function changedFilesIn(workdir: string): Promise<string[]> {
  const res = await execCommand('git', ['status', '--porcelain'], { cwd: workdir });
  if (res.code !== 0) return [];
  return res.stdout
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}

/**
 * Runs `codex exec` against the working tree at `workdir`.
 *
 * - If the prompt asks codex to inspect only, no files are modified and
 *   `changedFiles` is empty — i.e. this doubles as an analysis activity.
 * - If the prompt asks codex to edit, modifications land in the working tree
 *   and `changedFiles` lists them. Commit / push happens in the workflow.
 *
 * Adjust the `args` array if your installed codex version uses different flags.
 */
export async function codexActivity(input: CodexInput): Promise<CodexOutput> {
  const args = ['exec'];
  if (input.model) args.push('--model', input.model);

  const parts = [input.systemPrompt?.trim(), input.context?.trim(), input.prompt.trim()]
    .filter(Boolean) as string[];
  if (input.paths && input.paths.length > 0) {
    parts.push('Focus on these paths:\n' + input.paths.map((p) => ` - ${p}`).join('\n'));
  }
  const fullPrompt = parts.join('\n\n');

  const res = await execCommand('codex', args, {
    cwd: input.workdir,
    input: fullPrompt,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
      CODEX_NON_INTERACTIVE: '1',
    },
  });

  if (res.code !== 0) {
    throw ApplicationFailure.create({
      message: `codex exited ${res.code}: ${res.stderr.slice(0, 1024)}`,
      type: 'CodexInvocationError',
      details: [res.stdout.slice(0, 4096), res.stderr.slice(0, 4096)],
    });
  }

  const changedFiles = await changedFilesIn(input.workdir);
  return {
    message: res.stdout.trim().slice(0, 16 * 1024),
    raw: res.stdout,
    changedFiles,
  };
}
