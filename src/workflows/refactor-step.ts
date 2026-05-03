/**
 * `refactorStepWorkflow` — runs a single plan step's
 * implement→Parliament→drift-audit→critical_block loop as its own Temporal
 * workflow.
 *
 * Lifted out of `periodicRefactorWorkflow` so future orchestrators
 * (issue-driven flows, manual one-off invocations, etc.) can reuse the
 * same per-step machinery without duplicating the loop. The orchestrator
 * passes in the slice of its budgets that the step is allowed to consume,
 * the child runs its own bookkeeping locally, and the caller reconciles
 * the deltas afterward.
 *
 * Constraint: the workdir is pod-local (same as the existing parent/child
 * relationship with `robustPRMergeWorkflow`). Parent and child must run
 * on the same Worker.
 */

import { log } from '@temporalio/workflow';
import type { ContextArtifact, PlanStep } from '../activities/refactor';
import { AdvisorBudget, type AdvisorAuditEntry } from './_internal/advisor';
import { SpawnCounter } from './_internal/spawn-budget';
import {
  runRefactorStep,
  type CircuitBreaker,
  type StepLoopConfig,
} from './_internal/refactor-step-loop';
import type { StepRecord } from './_internal/refactor-report';

// Re-export the canonical default so consumers (orchestrators + tests) get
// `refactorStepWorkflow` and its config defaults from a single import path.
export {
  DEFAULT_STEP_LOOP_CONFIG,
  type StepLoopConfig,
} from './_internal/refactor-step-loop';

export interface RefactorStepInput {
  step: PlanStep;
  workdir: string;
  contextArtifact: ContextArtifact;
  /** Slice of the parent's spawn budget the child may consume. */
  spawnBudget: number;
  /** Slice of the parent's advisor budget the child may consume. */
  advisorBudget: number;
  config: StepLoopConfig;
}

/**
 * Discriminator carried back to the parent so it can decide whether to
 * proceed with the next step (`completed`), stop because budget is gone
 * (`budget-halted`), or stop because a reviewer raised a critical_block
 * (`circuit-broken`).
 */
export type RefactorStepKind = 'completed' | 'budget-halted' | 'circuit-broken';

export interface RefactorStepOutput {
  kind: RefactorStepKind;
  /**
   * Present when `kind !== 'budget-halted'`. The parent appends this to
   * its `stepRecords` list.
   */
  record?: StepRecord;
  /** Present when `kind === 'circuit-broken'`. */
  circuitBroken?: CircuitBreaker;
  /** Codex spawns this step actually consumed, broken down by role. */
  spawnCounts: Record<string, number>;
  /** Advisor consults this step actually consumed (≤ input.advisorBudget). */
  advisorConsumed: number;
  /** Audit entries from advisor consults made during this step. */
  advisorAudits: AdvisorAuditEntry[];
}

export async function refactorStepWorkflow(
  input: RefactorStepInput,
): Promise<RefactorStepOutput> {
  // Local bookkeeping. The parent passed in a slice of its remaining budget;
  // the child may not exceed that slice, but the parent reconciles afterward
  // by reading `spawnCounts` / `advisorConsumed` off the return value.
  const spawnCounter = new SpawnCounter(input.spawnBudget);
  const advisorBudget = new AdvisorBudget(input.advisorBudget);
  const advisorAudits: AdvisorAuditEntry[] = [];

  log.info('refactorStepWorkflow start', {
    step: input.step.title,
    spawnBudget: input.spawnBudget,
    advisorBudget: input.advisorBudget,
  });

  const result = await runRefactorStep({
    step: input.step,
    workdir: input.workdir,
    contextArtifact: input.contextArtifact,
    spawnCounter,
    advisorBudget,
    advisorAudits,
    config: input.config,
  });

  const spawnCounts = spawnCounter.summary().perRole;
  const advisorConsumed = advisorBudget.used();

  if (result.kind === 'budget-halted') {
    return {
      kind: 'budget-halted',
      spawnCounts,
      advisorConsumed,
      advisorAudits,
    };
  }
  if (result.kind === 'circuit-broken') {
    return {
      kind: 'circuit-broken',
      record: result.record,
      circuitBroken: result.circuitBroken,
      spawnCounts,
      advisorConsumed,
      advisorAudits,
    };
  }
  return {
    kind: 'completed',
    record: result.record,
    spawnCounts,
    advisorConsumed,
    advisorAudits,
  };
}
