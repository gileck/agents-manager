# UX Design Reference Kit

Design reference material for the **UX Designer agent** to produce HTML/CSS/JS mocks
that visually match the Agents Manager app.

## Contents

| File                          | Purpose                                                      |
|-------------------------------|--------------------------------------------------------------|
| `tokens.css`                  | CSS custom properties: colors, fonts, spacing, radii, shadows, motion |
| `patterns.html`               | Live-rendered component snippets (buttons, cards, tables, etc.) |
| `layout-template.html`        | Base HTML shell with sidebar + header + tabs + content area  |
| `screenshots/`                | Reference screenshots of key app pages (see capture guide)   |
| `screenshots/CAPTURE-GUIDE.md`| Instructions for taking consistent screenshots               |

## Quick start (for UX Designer agent)

1. **Copy `layout-template.html`** as the starting point for a new mock.
2. **Import `tokens.css`** via `<link rel="stylesheet" href="tokens.css">`.
3. **Reference `patterns.html`** for component HTML/CSS to copy-paste.
4. **Check `screenshots/`** for visual density, whitespace, and overall feel.

## Design system overview

- **Theme**: Dark-first (`.dark` class on `<html>`), with light mode support.
- **Colors**: HSL-based tokens. Use `hsl(var(--primary))` or the resolved `var(--color-primary)`.
- **Typography**: SF Pro Text / system sans-serif, SF Mono for code.
- **Borders**: Rounded (`0.75rem` buttons, `1rem` cards), semi-transparent borders (`/0.7`).
- **Surfaces**: Glass-morphism via `backdrop-filter: blur()` + semi-transparent backgrounds.
- **Motion**: Fast transitions (`120ms`), standard easing (`cubic-bezier(0.22, 1, 0.36, 1)`).

## Maintenance

This kit is extracted from `src/renderer/styles/globals.css` and `src/renderer/components/ui/`.
If the app's design system changes, re-extract tokens and update this kit.
