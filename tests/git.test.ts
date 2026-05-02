import { describe, expect, it } from 'vitest';
import { fetchRemoteBranchRefSpec, remoteBranchRef } from '../src/activities/git';

describe('git activity helpers', () => {
  it('builds a remote-tracking ref for non-default base branches', () => {
    expect(remoteBranchRef('release/v1')).toBe('refs/remotes/origin/release/v1');
  });

  it('builds an explicit fetch refspec for shallow clones', () => {
    expect(fetchRemoteBranchRefSpec('develop')).toBe(
      'develop:refs/remotes/origin/develop',
    );
  });

  it('rejects empty base branches before invoking git', () => {
    expect(() => remoteBranchRef('   ')).toThrow('base branch must not be empty');
  });
});
