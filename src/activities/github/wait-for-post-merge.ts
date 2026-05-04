import { log } from '@temporalio/activity';
import { pollPostMergeOutcome, type PostMergeOutcome } from './_internal/post-merge-poll';
import { observePRState } from './_internal/pr-state';
import { runGitHubWait } from './_internal/wait-heartbeat';

export interface WaitForPostMergeInput {
  repoFullName: string;
  prNumber: number;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export type { PostMergeOutcome } from './_internal/post-merge-poll';
export { mapPostMergeStateToOutcome } from './_internal/post-merge-poll';

/**
 * Poll after `gh pr merge --auto` has accepted the merge request. This is an
 * Activity rather than workflow-side polling so the wait can heartbeat and
 * receive cancellation through Temporal's activity cancellation path.
 */
export async function waitForPostMergeActivity(
  input: WaitForPostMergeInput,
): Promise<PostMergeOutcome> {
  const outcome = await runGitHubWait(
    { phase: 'post-merge', prNumber: input.prNumber },
    async ({ env, sleep, now }) => {
      return pollPostMergeOutcome(
        {
          prNumber: input.prNumber,
          pollIntervalMs: input.pollIntervalMs,
          maxPollAttempts: input.maxPollAttempts,
        },
        {
          observe: async () => {
            return observePRState(input.repoFullName, input.prNumber, env);
          },
          sleep,
          now,
          onTerminalOutcome: (outcome, observed) => {
            if (outcome === 'merged') {
              log.info('PR merge observed', {
                prNumber: input.prNumber,
                mergedAt: observed.mergedAt,
              });
            } else {
              log.info('PR closed externally during post-merge poll', {
                prNumber: input.prNumber,
              });
            }
          },
        },
      );
    },
  );
  if (outcome === 'merge-queued') {
    log.info('PR still queued after merge request; reporting merge-queued', {
      prNumber: input.prNumber,
    });
  }
  return outcome;
}
