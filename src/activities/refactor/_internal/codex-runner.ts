import { runCodexExec, type CodexRunOutput } from '../../_internal/run-codex';

export interface RefactorActivityRunInput<T> {
  workdir: string;
  prompt: string;
  timeoutMs?: number;
  defaultTimeoutMs: number;
  mapResult: (output: CodexRunOutput) => T | Promise<T>;
}

export async function runRefactorActivity<T>(input: RefactorActivityRunInput<T>): Promise<T> {
  const output = await runCodexExec({
    workdir: input.workdir,
    prompt: input.prompt,
    timeoutMs: input.timeoutMs ?? input.defaultTimeoutMs,
  });
  return input.mapResult(output);
}
