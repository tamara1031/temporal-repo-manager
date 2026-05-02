/**
 * Activity mock factory for workflow tests.
 *
 * The mocked surface mirrors the real activity exports in `src/activities`.
 * Each test overrides the calls it cares about; defaults are no-ops that
 * return plausible stub data so workflows run end-to-end without surprises.
 */
import type * as activities from '../src/activities';

export interface ActivityCalls {
  log: Array<{ name: string; args: unknown[] }>;
}

export function makeMockActivities(
  overrides: Partial<typeof activities> = {},
): { activities: typeof activities; calls: ActivityCalls } {
  const calls: ActivityCalls = { log: [] };

  function record<T>(name: string, fn: (...args: any[]) => Promise<T>) {
    return async (...args: any[]): Promise<T> => {
      calls.log.push({ name, args });
      return fn(...args);
    };
  }

  const defaults = {
    cloneRepoActivity: record('cloneRepoActivity', async () => ({
      workdir: '/tmp/agent-workspaces/mock',
      branch: 'agent/refactor/test',
      baseSha: 'deadbeef',
    })),
    commitAllActivity: record('commitAllActivity', async () => ({
      committed: true,
      sha: 'cafebabe',
    })),
    pushBranchActivity: record('pushBranchActivity', async () => undefined),
    checkConflictActivity: record('checkConflictActivity', async () => ({
      hasConflict: false,
      conflictedFiles: [],
    })),
    cleanupWorkspaceActivity: record('cleanupWorkspaceActivity', async () => undefined),
    createPRActivity: record('createPRActivity', async () => ({
      number: 42,
      url: 'https://github.com/example/repo/pull/42',
      branch: 'agent/refactor/test',
      baseBranch: 'main',
      repoFullName: 'example/repo',
    })),
    waitForCIActivity: record('waitForCIActivity', async () => ({
      status: 'success' as const,
      failedRunIds: [],
      failedJobNames: [],
    })),
    fetchFailedRunLogsActivity: record('fetchFailedRunLogsActivity', async () => 'log lines'),
    mergePRActivity: record('mergePRActivity', async () => undefined),
    codexActivity: record('codexActivity', async () => ({
      message: 'codex stub message',
      raw: 'codex stub message',
      changedFiles: ['src/foo.ts'],
    })),
  };

  // Layer overrides on top, preserving the call recorder.
  const merged: typeof activities = { ...defaults } as typeof activities;
  for (const [name, fn] of Object.entries(overrides)) {
    if (typeof fn === 'function') {
      (merged as any)[name] = record(name, fn as any);
    }
  }
  return { activities: merged, calls };
}
