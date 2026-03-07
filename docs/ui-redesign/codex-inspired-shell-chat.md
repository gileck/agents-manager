# Codex-Inspired Shell + Chat Design Contract

## Intent
Create a Codex-inspired desktop experience for Agents Manager while preserving existing route information architecture and behavior.

## Visual Rules
1. Contrast: dark-first neutral surfaces with one cool primary accent, muted separators, and high readability text.
2. Spacing scale: 4px base grid with compact density on shell controls and comfortable density in conversation content.
3. Border treatment: soft outlines (`hsl(var(--border) / 0.65-0.9)`) and low-opacity layers instead of hard lines.
4. Corner radius: rounded surfaces (`--radius: 14px`) with pill controls in top actions.
5. Elevation: subtle blur and layered cards; avoid heavy shadows.
6. Motion: only meaningful transitions, 120-180ms, no decorative animation loops.

## Typography
1. Sans stack: `SF Pro Text`, `SF Pro Display`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`.
2. Mono stack: `SF Mono`, `JetBrains Mono`, `Cascadia Code`, `Menlo`, `Consolas`, `monospace`.
3. Body density: 14px base with stronger hierarchy in chat headline and shell section labels.

## Shell Composition Targets
1. Sidebar: compact nav, clearly grouped sections, session rows prioritized.
2. Top bar: restrained utility controls with rounded pills.
3. Main pane: low-noise background with layered content surfaces.

## Chat Composition Targets
1. Empty state: centered prompt with project context and minimal decoration.
2. Messages: wide readable assistant blocks, subtle user bubble contrast.
3. Composer: elevated rounded container, compact control rail, explicit send/stop actions.
4. Secondary context: optional right panel remains but visually quieter.

## Baseline Snapshot Checklist
Store baseline screenshots in `docs/ui-redesign/baseline/` before visual verification:
1. `01-shell-sidebar.png`
2. `02-topbar.png`
3. `03-chat-empty.png`
4. `04-chat-active.png`
5. `05-theme-page.png`

## Acceptance Snapshot Checklist
Store acceptance screenshots in `docs/ui-redesign/acceptance/` after redesign:
1. `01-shell-sidebar-dark.png`
2. `02-shell-sidebar-light.png`
3. `03-chat-empty-dark.png`
4. `04-chat-active-dark.png`
5. `05-theme-page-dark.png`
6. `06-theme-page-light.png`

## QA Matrix
1. New install defaults to dark mode.
2. Existing saved theme and themeConfig values are preserved.
3. Sidebar section collapse state remains persisted.
4. Chat composer supports send, stop, queued, paste image, and file attach flows.
5. Route navigation and keyboard shortcuts remain unchanged.
