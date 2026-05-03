import { runRefactorActivity } from './_internal/codex-runner';
import { parsePlanOutput } from './_internal/parsers';
import { PROMPTS } from './_internal/prompts';
import type { ContextArtifact, PlanOutput } from './_internal/types';

export interface PlanInput {
  workdir: string;
  contextArtifact: ContextArtifact;
  brief?: string;
  /** Optional override (default 5 min — within plan proxy's startToCloseTimeout). */
  timeoutMs?: number;
}

const PLAN_TIMEOUT_MS = 5 * 60 * 1000;

export async function planActivity(input: PlanInput): Promise<PlanOutput> {
  const prompt = PROMPTS.plan(input.contextArtifact, input.brief);
  return runRefactorActivity({
    workdir: input.workdir,
    prompt,
    timeoutMs: input.timeoutMs,
    defaultTimeoutMs: PLAN_TIMEOUT_MS,
    mapResult: (res) => parsePlanOutput(res.lastMessage),
  });
}
