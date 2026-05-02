import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { WorkflowFailedError } from '@temporalio/client';
import { randomUUID } from 'crypto';
import { robustPRMergeWorkflow } from '../src/workflows';
import { getWorkflowBundle, makeMockActivities } from './helpers';

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
});

afterAll(async () => {
  await env?.teardown();
});

const baseInput = {
  repoFullName: 'example/repo',
  workdir: '/tmp/agent-workspaces/mock',
  branch: 'agent/refactor/test',
  baseBranch: 'main',
  prTitle: 'refactor(auto): test',
  prBody: 'body',
};

async function runWith(
  taskQueueName: string,
  acts: Parameters<typeof makeMockActivities>[0],
  input: Partial<typeof baseInput> & { maxFixIterations?: number } = {},
) {
  const { activities, calls } = makeMockActivities(acts);
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: taskQueueName,
    workflowBundle: await getWorkflowBundle(),
    activities,
  });
  const promise = env.client.workflow.execute(robustPRMergeWorkflow, {
    taskQueue: taskQueueName,
    workflowId: `${taskQueueName}-${randomUUID()}`,
    args: [{ ...baseInput, ...input }],
  });
  const result = await worker.runUntil(promise).catch((err: unknown) => err);
  return { result, calls };
}

describe('robustPRMergeWorkflow', () => {
  it('happy path: push → createPR → CI green → no conflict → merge', async () => {
    const { result, calls } = await runWith('pr-happy', {});
    expect((result as any).prNumber).toBe(42);
    expect((result as any).iterations).toBe(0);

    const names = calls.log.map((c) => c.name);
    expect(names).toEqual([
      'pushBranchActivity', // initial setUpstream push
      'createPRActivity',
      'waitForCIActivity',
      'checkConflictActivity',
      'mergePRActivity',
    ]);
  });

  it('CI failure → self-heal once → CI green → merge', async () => {
    let ciCalls = 0;
    const { result, calls } = await runWith('pr-self-heal', {
      waitForCIActivity: async () => {
        ciCalls += 1;
        if (ciCalls === 1) {
          return {
            status: 'failure' as const,
            failedRunIds: ['12345'],
            failedJobNames: ['lint'],
          };
        }
        return { status: 'success' as const, failedRunIds: [], failedJobNames: [] };
      },
    });

    expect((result as any).prNumber).toBe(42);
    expect((result as any).iterations).toBe(1);

    const names = calls.log.map((c) => c.name);
    // After CI failure: fetch logs → codex fix → commit → push → CI again → conflict check → merge.
    expect(names).toContain('fetchFailedRunLogsActivity');
    expect(names).toContain('codexActivity');
    expect(names.filter((n) => n === 'waitForCIActivity').length).toBe(2);
    expect(names.filter((n) => n === 'pushBranchActivity').length).toBe(2);
    expect(names).toContain('mergePRActivity');
  });

  it('conflict → resolve → CI green → merge', async () => {
    let conflictCalls = 0;
    const { result, calls } = await runWith('pr-conflict', {
      checkConflictActivity: async () => {
        conflictCalls += 1;
        if (conflictCalls === 1) {
          return {
            hasConflict: true,
            conflictedFiles: ['src/foo.ts'],
            diffSummary: '<<<<<<< HEAD\n=======\n>>>>>>> main\n',
          };
        }
        return { hasConflict: false, conflictedFiles: [] };
      },
    });

    expect((result as any).prNumber).toBe(42);
    expect((result as any).iterations).toBe(1);

    const names = calls.log.map((c) => c.name);
    expect(names.filter((n) => n === 'checkConflictActivity').length).toBe(2);
    expect(names).toContain('codexActivity');
    expect(names.filter((n) => n === 'pushBranchActivity').length).toBe(2);
    expect(names).toContain('mergePRActivity');
  });

  it('fails when codex produces no diff during self-heal', async () => {
    const { result } = await runWith('pr-no-diff', {
      waitForCIActivity: async () => ({
        status: 'failure' as const,
        failedRunIds: ['1'],
        failedJobNames: ['ci'],
      }),
      commitAllActivity: async () => ({ committed: false }),
    });
    expect(result).toBeInstanceOf(WorkflowFailedError);
  });

  it('throws CITimeout when CI never settles', async () => {
    const { result } = await runWith('pr-ci-timeout', {
      waitForCIActivity: async () => ({
        status: 'timeout' as const,
        failedRunIds: [],
        failedJobNames: [],
      }),
    });
    expect(result).toBeInstanceOf(WorkflowFailedError);
  });

  it('exceeds max iterations when self-heal cannot converge', async () => {
    const { result } = await runWith(
      'pr-max-iters',
      {
        waitForCIActivity: async () => ({
          status: 'failure' as const,
          failedRunIds: ['x'],
          failedJobNames: ['ci'],
        }),
      },
      { maxFixIterations: 2 },
    );
    expect(result).toBeInstanceOf(WorkflowFailedError);
  });
});
