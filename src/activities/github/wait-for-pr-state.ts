import { log } from '@temporalio/activity';
import { observePRState } from './_internal/pr-state';
import { pollPRState } from './_internal/wait-pr-state-poll';
import { runGitHubWait } from './_internal/wait-heartbeat';
import { type ObservePRStateOutput, type PRLifecycleState } from './observe-pr-state';

export interface WaitForPRStateInput {
  repoFullName: string;
  prNumber: number;
  /**
   * States that should end the wait. Defaults to CLOSED or MERGED, which is
   * the usual "wait until the PR is no longer open" lifecycle gate.
   */
  targetStates?: PRLifecycleState[];
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

export interface WaitForPRStateOutput extends ObservePRStateOutput {
  timedOut: boolean;
}

/**
 * Long-running PR lifecycle poll. This stays in an Activity so the wait can
 * heartbeat and be cancelled without workflow-side timers.
 */
export async function waitForPRStateActivity(
  input: WaitForPRStateInput,
): Promise<WaitForPRStateOutput> {
  return runGitHubWait(
    { phase: 'wait-pr-state', prNumber: input.prNumber },
    async ({ env, sleep, now }) => {
      return pollPRState(input, {
        observe: () => observePRState(input.repoFullName, input.prNumber, env),
        sleep,
        now,
        onTargetState: (observed) => {
          log.info('Observed target PR state', {
            prNumber: input.prNumber,
            state: observed.state,
          });
        },
      });
    },
  );
}
