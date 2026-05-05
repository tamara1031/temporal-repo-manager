/**
 * `designPhaseWorkflow` — runs the plan → Design Parliament loop as its own
 * Temporal workflow.
 *
 * Mirrors the pattern of `refactorStepWorkflow`: the parent passes a spawn-
 * budget slice, the child runs its own bookkeeping, and the caller reconciles
 * the deltas from `spawnCounts` on return.
 *
 * Output discriminators:
 *   - `completed`        — plan is ready for the implementation loop
 *   - `no-op`            — planner returned no actionable theme; caller skips
 *   - `plan-failed`      — planner threw a non-retryable error; caller skips
 *   - `budget-exhausted` — not enough budget for even the initial plan call
 */

import { log } from '@temporalio/workflow';
import type { ContextArtifact, DesignPhaseRecord, PlanOutput } from '../activities/refactor';
import { SpawnCounter, type SpawnCounts } from './_internal/spawn-budget';
import {
  runDesignPhase,
  DEFAULT_DESIGN_PHASE_CONFIG,
  type DesignPhaseConfig,
} from './_internal/design-phase-loop';

export { DEFAULT_DESIGN_PHASE_CONFIG, type DesignPhaseConfig } from './_internal/design-phase-loop';

export interface DesignPhaseInput {
  workdir: string;
  contextArtifact: ContextArtifact;
  brief?: string;
  /** Slice of the parent's spawn budget the child may consume. */
  spawnBudget: number;
  config: DesignPhaseConfig;
}

/**
 * Discriminated union mirroring the internal `DesignPhaseLoopResult` shape,
 * with `spawnCounts` added to every variant. Using a discriminated union (rather
 * than an optional-field interface) means callers never need a `!` assertion:
 * TypeScript narrows `plan` and `designRecord` as present once `outcome` is
 * checked to be `'completed'` or `'no-op'`. Parallels the pattern established
 * for `RefactorStepOutput`.
 */
export type DesignPhaseOutput =
  | { outcome: 'completed'; plan: PlanOutput; designRecord: DesignPhaseRecord; spawnCounts: SpawnCounts }
  | { outcome: 'no-op'; plan: PlanOutput; designRecord: DesignPhaseRecord; spawnCounts: SpawnCounts }
  | { outcome: 'plan-failed'; spawnCounts: SpawnCounts }
  | { outcome: 'budget-exhausted'; spawnCounts: SpawnCounts };

/** All possible outcomes for a design phase run, derived from the output union. */
export type DesignPhaseOutcome = DesignPhaseOutput['outcome'];

export async function designPhaseWorkflow(input: DesignPhaseInput): Promise<DesignPhaseOutput> {
  const spawnCounter = new SpawnCounter(input.spawnBudget);

  log.info('designPhaseWorkflow start', {
    spawnBudget: input.spawnBudget,
    maxRounds: input.config.maxRounds,
  });

  const result = await runDesignPhase({
    workdir: input.workdir,
    contextArtifact: input.contextArtifact,
    brief: input.brief,
    spawnCounter,
    config: input.config,
  });

  const spawnCounts = spawnCounter.summary().perRole;

  log.info('designPhaseWorkflow done', { outcome: result.outcome, spawnCounts });

  if (result.outcome === 'plan-failed') {
    return { outcome: 'plan-failed', spawnCounts };
  }
  if (result.outcome === 'budget-exhausted') {
    return { outcome: 'budget-exhausted', spawnCounts };
  }
  if (result.outcome === 'no-op') {
    return { outcome: 'no-op', plan: result.plan, designRecord: result.record, spawnCounts };
  }
  return { outcome: 'completed', plan: result.plan, designRecord: result.record, spawnCounts };
}
