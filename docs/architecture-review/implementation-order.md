# Architecture Review Round 2 — Implementation Order

## File Conflict Analysis

| File | Plans | Risk |
|------|-------|------|
| `src/main/services/agent-service.ts` | 04, 07 | **Medium** — 07 changes constructor, 04 extracts methods. 07 first. |
| `src/main/ipc-handlers/index.ts` | 08 only | None |
| `src/main/ipc-handlers/telegram-handlers.ts` | 07 only | None |
| `src/main/services/workflow-service.ts` | 02 only | None |
| `src/main/providers/setup.ts` | 02, 04 | **Low** — different sections |
| `docs/patterns.md` | 09 only | None |

## Waves

### Wave 1 — Fully independent (parallel)

| Plan | Part | Score | Target |
|------|------|:-----:|:------:|
| 03 | Pipeline Engine | 9.1 | 9.3+ |
| 05 | Data Layer | 8.6 | 9+ |
| 06 | SCM/Git | 8.5 | 9+ |
| 09 | Template Infra | 7.3 | 9+ |

No file conflicts. All can run in parallel.

### Wave 2 — After Wave 1 (parallel)

| Plan | Part | Score | Target |
|------|------|:-----:|:------:|
| 01 | UI Layer | 8.1 | 9+ |
| 07 | Notifications | 7.4 | 9+ |
| 08 | Shared/Cross-cutting | 8.1 | 9+ |

Plan 07 must complete before Plan 04 (Wave 3) due to shared `agent-service.ts`.

### Wave 3 — After Wave 2 (parallel)

| Plan | Part | Score | Target |
|------|------|:-----:|:------:|
| 02 | WorkflowService | 8.3 | 9+ |
| 04 | Agent System | 8.5 | 9+ |

Plan 04 depends on Plan 07 (Wave 2) completing first — shared `agent-service.ts` constructor change.

## Verification

After each wave:
1. `yarn checks` (TypeScript + ESLint)
2. `yarn test` (all unit + e2e tests)
