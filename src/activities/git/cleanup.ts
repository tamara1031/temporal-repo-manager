import * as fs from 'fs/promises';

export interface CleanupInput {
  workdir: string;
}

export async function cleanupWorkspaceActivity(input: CleanupInput): Promise<void> {
  await fs.rm(input.workdir, { recursive: true, force: true });
}
