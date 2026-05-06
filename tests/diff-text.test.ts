/**
 * Unit tests for diffTextActivity — specifically the contentHash guarantee:
 * the hash must cover the full diff before truncation so that no-progress
 * detection in refactor-step-loop.ts is correct regardless of diff size.
 *
 * `git diff` compares the working tree against the index (staged area). Each
 * test stages an initial version of file.ts then modifies the working-tree
 * copy, which is sufficient to produce a diff without requiring a commit.
 * This avoids commit-signing constraints in CI environments.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execOrThrow } from '../src/activities/_internal/exec';
import { diffTextActivity } from '../src/activities/git/diff-text';

let workdir = '';

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'diff-text-test-'));
  await execOrThrow('git', ['init'], { cwd: workdir });
  // Stage the initial file so the working tree matches the index (no diff).
  await fs.writeFile(path.join(workdir, 'file.ts'), 'initial content\n');
  await execOrThrow('git', ['add', 'file.ts'], { cwd: workdir });
});

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true });
});

describe('diffTextActivity', () => {
  it('returns empty text and a stable hash when there are no changes', async () => {
    // Working tree matches the index — git diff returns nothing.
    const result = await diffTextActivity({ workdir });
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
    const expectedHash = createHash('sha256').update('').digest('hex');
    expect(result.contentHash).toBe(expectedHash);
  });

  it('contentHash matches sha256 of the full diff text when not truncated', async () => {
    await fs.writeFile(path.join(workdir, 'file.ts'), 'changed content\n');
    const result = await diffTextActivity({ workdir });
    expect(result.truncated).toBe(false);
    const expectedHash = createHash('sha256').update(result.text).digest('hex');
    expect(result.contentHash).toBe(expectedHash);
  });

  it('contentHash covers the FULL diff even when text is truncated', async () => {
    // Write enough content to produce a diff larger than the small maxBytes cap.
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}: ${'x'.repeat(50)}`).join('\n');
    await fs.writeFile(path.join(workdir, 'file.ts'), lines);
    const result = await diffTextActivity({ workdir, maxBytes: 100 });

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(100);

    // Hash must NOT match the truncated prefix — it covers the full diff.
    const truncatedPrefixHash = createHash('sha256').update(result.text).digest('hex');
    expect(result.contentHash).not.toBe(truncatedPrefixHash);

    // Calling again must return the same hash (stable for the same workdir state).
    const result2 = await diffTextActivity({ workdir, maxBytes: 100 });
    expect(result.contentHash).toBe(result2.contentHash);
  });

  it('returns different hashes for different diffs', async () => {
    await fs.writeFile(path.join(workdir, 'file.ts'), 'version A\n');
    const resultA = await diffTextActivity({ workdir });

    await fs.writeFile(path.join(workdir, 'file.ts'), 'version B\n');
    const resultB = await diffTextActivity({ workdir });

    expect(resultA.contentHash).not.toBe(resultB.contentHash);
  });
});
