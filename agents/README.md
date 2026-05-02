# Codex subagents (Parliament-style refactor pipeline)

These TOML files define the Codex CLI subagents used by `periodicRefactorWorkflow`.

At image build time the Dockerfile copies this directory to
`/home/agent/.codex/agents/` so the CLI auto-discovers them.

## Personas

| File | Role | Sandbox (declared) |
|---|---|---|
| `planner.toml` | Picks ONE refactor theme, decomposes it into 2–4 steps with `[critical]` requirements | `read-only` |
| `implementer.toml` | Applies one step's edits to the working tree | `workspace-write` |
| `reviewer-security.toml` | Parliament member — security only | `read-only` |
| `reviewer-performance.toml` | Parliament member — performance / cost only | `read-only` |
| `reviewer-readability.toml` | Parliament member — clarity / naming / cohesion only | `read-only` |
| `reviewer-dx.toml` | Parliament member — DX, tests, types, errors only | `read-only` |

## Important caveat: declared sandbox is informational (codex 0.128.0)

The orchestrator runs Codex with `--sandbox workspace-write`, which scopes
filesystem writes to `[workdir, /tmp, ~/.codex/memories]`. Empirically the
**parent's effective sandbox cascades to every subagent**:

| Parent flag | Child TOML | Child can write outside? |
|---|---|---|
| `workspace-write` | `read-only` | **YES** (TOML downward limit not honored) |
| `read-only` | `workspace-write` | NO (TOML upward expansion not honored) |

So in this version, the per-agent TOML `sandbox_mode` field is documentation
only. The reviewer "read-only" guarantee is prompt-based, not enforced.

Consequences:
- Treat `sandbox_mode` as a hint to the model and a record of intent.
- The orchestrator prompt repeats "do not modify files" / "do not git push"
  to each persona.
- After every reviewer round the orchestrator runs `git diff` and reverts any
  drift the reviewers introduced.
- The Docker container + `workspace-write` sandbox together are the real
  security boundary (no /etc, no /usr writes; only workdir, /tmp, codex
  memories).

## Adding a new reviewer concern

1. Drop a new `reviewer-<concern>.toml` here.
2. Update the orchestrator prompt in `src/workflows/refactor-prompt.ts` to
   spawn it alongside the existing four.
3. Watch out for `agents.max_threads` (default 6) in `codex-config/config.toml`
   — bump it if you spawn more than 6 in parallel.
