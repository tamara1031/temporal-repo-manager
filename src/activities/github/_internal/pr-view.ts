import { invalidGhOutput, isRecord, parseGhJSON } from './gh-json';

export interface PRViewJSON {
  number: number;
  url: string;
}

export function parsePRViewJSON(stdout: string): PRViewJSON {
  const data = parseGhJSON(stdout, 'gh pr view --json number,url');
  if (!isRecord(data)) {
    throw invalidGhOutput('gh pr view --json number,url output must be a JSON object');
  }
  if (typeof data.number !== 'number') {
    throw invalidGhOutput('gh pr view --json number,url output is missing numeric field "number"');
  }
  if (typeof data.url !== 'string') {
    throw invalidGhOutput('gh pr view --json number,url output is missing string field "url"');
  }
  return { number: data.number, url: data.url };
}
