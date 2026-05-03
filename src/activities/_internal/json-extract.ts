/**
 * Shared JSON extraction for activity-side Codex output parsing.
 * Tolerant of preamble / markdown fences / trailing prose - Codex sometimes
 * leaks filler text despite prompt-side hardening.
 */

/**
 * Pull the first `{...}` JSON object out of arbitrary model text. Tolerates a
 * preamble or markdown fences. Returns undefined on any parse failure.
 */
export function extractJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  // Fast path: whole text is JSON.
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to fenced/embedded extraction.
  }
  // Look for ```json ... ``` fence first (deterministic boundary).
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through.
    }
  }
  // Last resort: greedy match on first balanced-looking object.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}
