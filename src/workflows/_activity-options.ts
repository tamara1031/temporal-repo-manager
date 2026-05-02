import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const NON_RETRYABLE = ['MissingCredentials'] as const;

/** Short, idempotent calls (gh read-only, git plumbing, status updates). */
export const cheap = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 5,
    nonRetryableErrorTypes: [...NON_RETRYABLE],
  },
});

/** Heavy or external work (clone, push, codex). */
export const heavy = proxyActivities<typeof activities>({
  startToCloseTimeout: '20 minutes',
  retry: {
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 4,
    nonRetryableErrorTypes: [...NON_RETRYABLE],
  },
});

/** Long-running CI poll. The activity heartbeats; workflow timer is unused. */
export const ciWait = proxyActivities<typeof activities>({
  startToCloseTimeout: '70 minutes',
  heartbeatTimeout: '2 minutes',
  retry: {
    initialInterval: '15s',
    backoffCoefficient: 2,
    maximumInterval: '2 minutes',
    maximumAttempts: 3,
    nonRetryableErrorTypes: [...NON_RETRYABLE],
  },
});
