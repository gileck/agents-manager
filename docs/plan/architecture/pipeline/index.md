# Pipeline System

The pipeline is a dynamic state machine that drives task workflows. Pipelines are **data, not code** — JSON definitions of statuses and transitions, executed by a generic engine.

## Docs

| Doc | What's In It |
|-----|-------------|
| [engine.md](engine.md) | Core pipeline engine, transition execution, agent integration, interfaces, extensibility, DB schema, phase rollout |
| [json-contract.md](json-contract.md) | Data model, JSON format, annotated example, handlers, guard/hook catalogs, built-in pipelines |
| [outcome-schemas.md](outcome-schemas.md) | Outcome registry, payload types, JSON Schema validation, human-in-the-loop patterns |
| [event-log.md](event-log.md) | Task event log — what gets logged, interface, where events come from |
| [errors.md](errors.md) | Failed agent handling, auto-retry, task supervisor, concurrent runs |
| [ui.md](ui.md) | Kanban integration, workflow visualizer, pipeline editor, React hooks, IPC channels |

## How It Evolves

### Week 1 - Simple pipeline
```
Open → In Progress → Done
```

### Week 3 - Add planning
```
Open → Planning → Planned → In Progress → Done
                                 ↓
                              Failed
```

### Week 6 - Add PR review with agent
```
Open → Planning → Planned → In Progress → PR Review → Done
                     ↑                        ↓
                     └──── Changes Requested ──┘
                                 ↓
                              Failed
```

### Week 10 - Different pipeline for bugs vs features
```
Bug:     Open → Investigating → Fix In Progress → PR Review → QA → Done
Feature: Open → Planning → Design Review → Implementation → PR Review → Done
```

### Week 12 - Human-in-the-loop workflows
```
Open → Planning → Needs Info (agent asks questions) → Planning (admin answers) → Planned
                                                                                    ↓
       Options Proposed (agent presents 3 approaches) ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ Implementation
                ↓                                                                    ↑
       Option Selected (admin picks one) → Implementation → PR Review → Done
                                                               ↓
                                              Changes Requested (admin adds comments)
                                                               ↓
                                                         Implementation (loop)
```

**All of this works with the same engine.** The only thing that changes is the pipeline definition JSON.

## Three Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Pipeline Definition (JSON)                         │
│  The MAP — what states exist, what transitions are valid     │
│  Lives in: database (editable at runtime via UI)             │
│  Changes: often (new statuses, new transitions, rewiring)    │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Pipeline Engine (core code)                        │
│  The RUNTIME — validates, executes, logs                     │
│  Lives in: implementations/pipeline-engine.ts                │
│  Changes: rarely (the engine is generic)                     │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Handlers (feature modules)                         │
│  The BEHAVIOR — what actually happens on each transition     │
│  Lives in: handlers/*.ts (one file per feature concern)      │
│  Changes: when adding new capabilities                       │
└─────────────────────────────────────────────────────────────┘
```

**The key insight:** Layer 1 (JSON) is the wiring diagram. Layer 3 (handlers) is the actual logic. Layer 2 (engine) connects them.
