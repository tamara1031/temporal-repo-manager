import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const NON_RETRYABLE = ['MissingCredentials', 'InvalidGitRef'] as const;

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

/** Heavy or external work (clone, push). */
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

/**
 * Long-running codex orchestration. The Parliament-style refactor pipeline
 * spawns ~30 subagent calls inside a single `codex exec`, which can stretch
 * past 20 minutes. exec.ts heartbeats every 5s while codex is running, so
 * the heartbeat timeout can stay tight.
 */
export const bigCodex = proxyActivities<typeof activities>({
  startToCloseTimeout: '90 minutes',
  heartbeatTimeout: '2 minutes',
  retry: {
    initialInterval: '30s',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 2,
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
