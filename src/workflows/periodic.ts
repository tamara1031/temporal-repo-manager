import {
  executeChild,
  workflowInfo,
  log,
  CancellationScope,
  ChildWorkflowCancellationType,
  ParentClosePolicy,
} from '@temporalio/workflow';
import { cheap, heavy, contextCodex, planCodex } from './proxies';
import { robustPRMergeWorkflow } from './pr-lifecycle';
import type { ContextArtifact, PlanOutput, ReviewConcern } from '../activities/refactor';
import { filesFromPorcelain } from './_internal/porcelain';
import { AdvisorBudget, type AdvisorAuditEntry } from './_internal/advisor';
import { renderReport, type StepRecord } from './_internal/refactor-report';
import { DEFAULT_PERIODIC_SPAWN_CAP, SpawnCounter } from './_internal/spawn-budget';
import {
  runRefactorStep,
  type CircuitBreaker,
  type StepLoopConfig,
} from './_internal/refactor-step-loop';

export interface PeriodicRefactorInput {
  repoFullName: string;
  baseBranch?: string;
  refactorBrief?: string;
  /** When false, the child PR-lifecycle stops before merging. Defaults to true. */
  autoMerge?: boolean;
  /**
   * Hard cap on advisor (top-model) consultations within this workflow run.
   * Defaults to 1: critical_block from a reviewer is the only place we consult.
   * Set to 0 to disable advisor escalation entirely.
   */
  maxAdvisorConsults?: number;
}

export interface PeriodicRefactorOutput {
  prUrl?: string;
  prNumber?: number;
  merged?: boolean;
  /**
   * Forwarded from the child PR-lifecycle workflow when one ran. Lets the
   * operator distinguish "merge actually landed" from "merge queued" or
   * "merge superseded by an external close/merge".
   */
  prOutcome?:
    | 'merged'
    | 'merge-queued'
    | 'auto-merge-disabled'
    | 'closed-externally'
    | 'merged-externally';
  /**
   * Combined advisor audit trail (this workflow + child). The PR body
   * already lists the periodic-side consults; the child's are appended here
   * because they happen *after* PR body rendering.
   */
  advisorAudits?: AdvisorAuditEntry[];
  skipped?: 'no-changes' | 'no-op-plan' | 'plan-failed';
}

/** Hard cap on plan steps regardless of what the planner returns. */
const MAX_STEPS = 2;

const STEP_LOOP_CONFIG: StepLoopConfig = {
  /** Per-step iteration cap (iter 0..maxIter-1). */
  maxIter: 2,
  /** Pre-Parliament gate: skip reviewers when (insertions + deletions) is below this. */
  trivialLineThreshold: 30,
  /** Pre-Parliament gate: skip reviewers when filesChanged is below this. */
  trivialFileThreshold: 3,
  /** Diff text size handed to each reviewer. */
  reviewDiffBytes: 8 * 1024,
  reviewerConcerns: ['correctness', 'quality'] as const satisfies readonly ReviewConcern[],
};

/**
 * periodicRefactorWorkflow — runs on a Temporal Schedule.
 *
 * Pipeline (one Temporal Activity per role — full visibility in the UI):
 *   clone → plan → for each step: implement → diff-stat (gate) → optional
 *   parliament (correctness ‖ quality) → drift-audit → aggregate → iter
 *   → commit-and-handoff to robustPRMergeWorkflow.
 */
export async function periodicRefactorWorkflow(
  input: PeriodicRefactorInput,
): Promise<PeriodicRefactorOutput> {
  const baseBranch = input.baseBranch ?? 'main';
  const info = workflowInfo();
  const branch = `agent/refactor/${info.workflowId}`.replace(/:/g, '-');

  const clone = await heavy.cloneRepoActivity({
    repoFullName: input.repoFullName,
    branch,
    ref: baseBranch,
  });
  const workdir = clone.workdir;
  const spawnCounter = new SpawnCounter(DEFAULT_PERIODIC_SPAWN_CAP);
  const advisorBudget = new AdvisorBudget(input.maxAdvisorConsults ?? 1);
  const advisorAudits: AdvisorAuditEntry[] = [];

  try {
    // ── Phase 0. Context Artifact ────────────────────────────────────────
    // One codex call distills a small repo summary that gets folded into the
    // *static* (cacheable) prefix of every downstream role prompt. This is
    // the prompt-cache hit lever — plan / implement / review all share the
    // same prefix bytes within a workflow run.
    const generatedAt = new Date(workflowInfo().startTime).toISOString();
    spawnCounter.consume('context', 1);
    const contextArtifact: ContextArtifact = await contextCodex.extractContextArtifactActivity({
      workdir,
      generatedAt,
    });

    // ── Phase 1. Plan ────────────────────────────────────────────────────
    let plan: PlanOutput;
    try {
      spawnCounter.consume('planner', 1);
      plan = await planCodex.planActivity({
        workdir,
        contextArtifact,
        brief: input.refactorBrief,
      });
    } catch (err) {
      log.warn('planner failed; producing plan-failed report', { err: String(err) });
      return { skipped: 'plan-failed' };
    }

    if (plan.theme === 'no-op' || plan.steps.length === 0) {
      log.info('planner returned no-op; skipping refactor', { theme: plan.theme });
      return { skipped: 'no-op-plan' };
    }

    const plannedSteps = plan.steps.slice(0, MAX_STEPS);
    const droppedFromPlan = plan.steps.slice(MAX_STEPS);

    // ── Phase 2. Step loop ───────────────────────────────────────────────
    const stepRecords: StepRecord[] = [];
    let circuitBroken: CircuitBreaker | undefined;

    for (const step of plannedSteps) {
      const result = await runRefactorStep({
        step,
        workdir,
        contextArtifact,
        spawnCounter,
        advisorBudget,
        advisorAudits,
        config: STEP_LOOP_CONFIG,
      });

      if (result.kind === 'budget-halted') {
        // Budget ran out mid-step: drop the partial record and stop.
        break;
      }
      if (result.kind === 'circuit-broken') {
        stepRecords.push(result.record);
        circuitBroken = result.circuitBroken;
        break;
      }
      // result.kind === 'completed'
      if (result.record.outcome === 'dropped-not-converged') {
        // Roll back the failed step before moving on.
        const cur = await cheap.statusPorcelainActivity({ workdir });
        const stepFiles = filesFromPorcelain(cur.entries);
        if (stepFiles.length > 0) {
          await cheap.restoreActivity({ workdir, paths: stepFiles });
        }
      }
      stepRecords.push(result.record);
    }

    // ── Phase 3. Handoff ─────────────────────────────────────────────────
    const finalStatus = await cheap.statusPorcelainActivity({ workdir });
    if (finalStatus.entries.length === 0) {
      log.info('no working-tree changes after refactor pass; skipping PR');
      return { skipped: 'no-changes' };
    }

    const prBody = renderReport({
      plan,
      droppedFromPlan,
      stepRecords,
      circuitBroken,
      spawnSummary: spawnCounter.summary(),
      branch,
      advisorAudits,
      stepCap: MAX_STEPS,
    });

    await heavy.commitAllActivity({
      workdir,
      message: `refactor(auto): ${branch}`,
    });

    const prResult = await executeChild(robustPRMergeWorkflow, {
      args: [
        {
          repoFullName: input.repoFullName,
          workdir,
          branch,
          baseBranch,
          prTitle: `refactor(auto): ${plan.theme}`.slice(0, 70),
          prBody,
          autoMerge: input.autoMerge,
        },
      ],
      workflowId: `pr-lifecycle-${branch}`,
      // ABANDON lets the child PR-merge complete autonomously even if the
      // periodic schedule is cancelled or the parent dies between "PR opened"
      // and "PR merged". The child has its own `maxFixIterations` cap so it
      // can't run forever.
      parentClosePolicy: ParentClosePolicy.ABANDON,
      cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
    });

    return {
      prUrl: prResult.prUrl,
      prNumber: prResult.prNumber,
      merged: prResult.merged,
      prOutcome: prResult.outcome,
      advisorAudits: [...advisorAudits, ...(prResult.advisorAudits ?? [])],
    };
  } finally {
    // Cleanup must run even when the workflow is cancelled — otherwise the
    // cancellation propagates to the cleanup activity and `workdir` leaks.
    // Errors are logged rather than swallowed so a chronically-failing cleanup
    // (disk full, permission issue) is observable.
    await CancellationScope.nonCancellable(async () => {
      try {
        await cheap.cleanupWorkspaceActivity({ workdir });
      } catch (err) {
        log.warn('cleanupWorkspaceActivity failed', { workdir, err: String(err) });
      }
    });
  }
}

