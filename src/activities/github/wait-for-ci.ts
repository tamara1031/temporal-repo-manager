import { Context, log } from '@temporalio/activity';
import { execOrThrow } from '../_internal/exec';
import { decideCIStatus, parseStatusCheckRollupJSON, type CompletedCIDecision } from './_internal/ci-rollup';
import { ghEnv, sleepCancellable } from './_internal/gh-env';

export interface WaitForCIInput {
  repoFullName: string;
  prNumber: number;
  pollIntervalSeconds?: number;
  maxWaitSeconds?: number;
}

export interface CIResult {
  status: 'success' | 'failure' | 'timeout';
  failedRunIds: string[];
  failedJobNames: string[];
}

export async function waitForCIActivity(input: WaitForCIInput): Promise<CIResult> {
  const env = ghEnv();
  const interval = (input.pollIntervalSeconds ?? 30) * 1000;
  const deadline = Date.now() + (input.maxWaitSeconds ?? 60 * 60) * 1000;
  const ctx = Context.current();

  while (Date.now() < deadline) {
    ctx.heartbeat({ phase: 'wait-ci', prNumber: input.prNumber });

    const view = await execOrThrow(
      'gh',
      [
        'pr',
        'view',
        String(input.prNumber),
        '--repo',
        input.repoFullName,
        '--json',
        'statusCheckRollup',
      ],
      { env },
    );
    const checks = parseStatusCheckRollupJSON(view.stdout);
    const decision = decideCIStatus(checks);

    if (decision.status === 'success' && checks.length === 0) {
      log.info('No CI checks configured for PR — treating as success', { pr: input.prNumber });
      return toCIResult(decision);
    }

    if (decision.status !== 'pending') {
      return toCIResult(decision);
    }

    await sleepCancellable(interval, ctx.cancellationSignal);
  }
  return { status: 'timeout', failedRunIds: [], failedJobNames: [] };
}

function toCIResult(decision: CompletedCIDecision): CIResult {
  return {
    status: decision.status,
    failedRunIds: decision.failedRunIds,
    failedJobNames: decision.failedJobNames,
  };
}
