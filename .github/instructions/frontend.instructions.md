---
description: "Use when working on the React frontend — components, routes, state, styling, graph visualization."
applyTo: "app/web/**"
---

# Frontend Rules

## Stack

React 18 + TypeScript + Vite. Package manager is **pnpm** (not npm). Run from `app/web/`.

## Routing

TanStack Router with file-based routes. Route files live in `src/routes/_authenticated/_layout/`.
Pages: graph, chat, monitoring, projects, register, settings.
Route tree is auto-generated in `src/routeTree.gen.ts` — don't edit manually.

## Components

- shadcn/ui components in `src/components/ui/` (Radix primitives underneath).
- Add new shadcn components via `pnpx shadcn@latest add <component>`.
- Path aliases: `@/components`, `@/lib/utils` (configured in `components.json`).

## State

Zustand stores in `src/store/`. Keep store slices small and focused.

## Auth

AWS Amplify + Cognito. Config in `src/config/amplify.ts`.

## Styling

- Tailwind CSS with CSS custom properties for theming (defined in `src/index.css`).
- Design tokens and color palette documented in `docs/design-system.md`.
- `font-sans` = Inter (UI text), `font-mono` = JetBrains Mono (data values, IDs, code only).
- Dark mode is the primary experience. Both themes must feel intentional.
- Accent hue ~210-220 (steel/ice blue). Avoid vivid/saturated or neon blues.

## Design Principles (from `CLAUDE.md`)

1. **Graph-first** — the 3D visualization (`react-force-graph-3d`) is the primary interface. UI chrome recedes.
2. **Precision over polish** — data density and clarity over decoration.
3. **Dark-native** — design for dark mode first; light mode equally intentional.
4. **WCAG 2.1 AA** — 4.5:1 text contrast, 3:1 UI contrast, keyboard navigation, `prefers-reduced-motion`.
5. **Minimal motion** — page transitions and modal open/close only. The 3D graph provides dynamism.
