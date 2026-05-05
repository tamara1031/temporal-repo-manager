import type { PRLifecycleState } from '../observe-pr-state';
import {
  normalizeAttemptPollTiming,
  normalizeNonNegativePollWaitMs,
  normalizePollAttempts,
  pollWithBudget,
} from './polling-budget';

export type PostMergeOutcome = 'merged' | 'merge-queued' | 'closed-externally';

const DEFAULT_POST_MERGE_POLL_ATTEMPTS = 6;
const DEFAULT_POST_MERGE_POLL_INTERVAL_MS = 10_000;
const MAX_POST_MERGE_ACTIVITY_WAIT_MS = 4 * 60 * 1000;

export interface PostMergePollOptions {
  prNumber: number;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  maxActivityWaitMs?: number;
}

export interface PostMergePollDeps {
  observe: () => Promise<{ state: PRLifecycleState; mergedAt?: string }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  onTerminalOutcome?: (
    outcome: Exclude<PostMergeOutcome, 'merge-queued'>,
    observed: { state: PRLifecycleState; mergedAt?: string },
  ) => void;
}

export async function pollPostMergeOutcome(
  input: PostMergePollOptions,
  deps: PostMergePollDeps,
): Promise<PostMergeOutcome> {
  const attempts = normalizePollAttempts(
    input.maxPollAttempts,
    DEFAULT_POST_MERGE_POLL_ATTEMPTS,
  );
  const maxActivityWaitMs = normalizeNonNegativePollWaitMs(
    input.maxActivityWaitMs,
    MAX_POST_MERGE_ACTIVITY_WAIT_MS,
  );
  const timing = normalizeAttemptPollTiming({
    nowMs: deps.now(),
    intervalMs: Math.floor(input.pollIntervalMs ?? DEFAULT_POST_MERGE_POLL_INTERVAL_MS),
    defaultIntervalMs: DEFAULT_POST_MERGE_POLL_INTERVAL_MS,
    attempts,
    maxWaitMs: maxActivityWaitMs,
  });

  return pollWithBudget<PostMergeOutcome>({
    intervalMs: timing.intervalMs,
    defaultIntervalMs: DEFAULT_POST_MERGE_POLL_INTERVAL_MS,
    deadlineMs: timing.deadlineMs,
    now: deps.now,
    sleep: deps.sleep,
    maxAttempts: attempts,
    observeAtDeadline: true,
    observe: async () => {
      const observed = await deps.observe();
      const outcome = mapPostMergeStateToOutcome(observed.state, false);
      if (outcome && outcome !== 'merge-queued') {
        deps.onTerminalOutcome?.(outcome, observed);
        return { done: true, value: outcome };
      }
      return { done: false };
    },
    onTimeout: () => 'merge-queued',
  });
}

export function mapPostMergeStateToOutcome(
  state: PRLifecycleState,
  waitBudgetExhausted: boolean,
): PostMergeOutcome | undefined {
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed-externally';
  return waitBudgetExhausted ? 'merge-queued' : undefined;
}
