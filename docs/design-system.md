# Design System

Visual design system for Neptune SocialActiveApp, established March 2026.

## Overview

The interface follows a **dark-native, graph-first** design philosophy. Steel-blue tones replace the generic slate defaults. Inter provides clean geometric typography. The UI recedes to let the graph visualization dominate.

## Public Home Page Narrative

The unauthenticated home page presents Social Active App as an outdoor
community platform where members:

- register and build profiles with experience, gear, and interests
- create events for objectives like climbing, running, biking, skiing, and water sports
- invite trusted partners and grow long-term networks through repeat outings

The page emphasizes a practical journey: profile setup, event creation, and
trust-network growth, while preserving existing tokens, motion style, and theme
behavior from the broader design system.

Second pass (Aug 2026) shifts the voice from broad social activity language to
an alpine/expedition posture:

- objective briefs instead of generic events
- rope-team trust and route history as primary social proof
- weather-window and terrain-aware planning language

The background treatment was also updated from an abstract network style to an
alpine-inspired scene (topographic contour lines plus mountain ridgelines) to
better match the expedition narrative.

## Color Palette

All colors are defined as CSS custom properties in `app/web/src/index.css` using HSL values consumed via `hsl(var(--token))`.

### Light Mode

| Token | HSL | Notes |
|-------|-----|-------|
| `--background` | `210 20% 98%` | Cool off-white |
| `--foreground` | `215 25% 12%` | Dark navy text |
| `--primary` | `214 60% 45%` | Steel blue — buttons, links, active states |
| `--secondary` | `213 20% 93%` | Light blue-gray — panels, secondary surfaces |
| `--muted-foreground` | `215 14% 46%` | Mid-tone labels and captions |
| `--destructive` | `0 72% 51%` | Red — delete, stop actions |
| `--border` | `214 20% 88%` | Subtle blue-gray borders |

### Dark Mode (primary)

| Token | HSL | Notes |
|-------|-----|-------|
| `--background` | `220 25% 6%` | Deep navy-black |
| `--card` | `218 25% 8%` | Slightly lighter surface for cards |
| `--primary` | `213 55% 62%` | Ice blue — interactive elements |
| `--secondary` | `217 20% 14%` | Dark panel surface |
| `--muted-foreground` | `215 15% 55%` | Subdued labels |
| `--border` | `217 18% 16%` | Low-contrast borders |

### Sidebar

Dedicated tokens for the navigation sidebar:
- `--sidebar` / `--sidebar-foreground` / `--sidebar-border`
- Slightly darker than main background in dark mode for depth separation

## Typography

| Use | Font | Notes |
|-----|------|-------|
| UI text | **Inter** (400, 500, 600, 700) | Geometric sans-serif for headings, labels, body |
| Data values, IDs, code | **JetBrains Mono** (400, 500) | Monospaced for instance IDs, endpoints, etc. |

Loaded via Google Fonts in `app/web/index.html`. OpenType features `cv02`, `cv03`, `cv04`, `cv11` are enabled for Inter's alternate glyphs.

Tailwind classes: `font-sans` (Inter) and `font-mono` (JetBrains Mono).

## Sidebar Navigation

- Fixed left rail, `w-14`, icon-only with tooltips
- **Active route highlighting**: `bg-primary/10 text-primary` with bolder stroke weight
- Subtle hover state: `bg-sidebar-foreground/5`
- Icons use `h-[18px] w-[18px]` with `strokeWidth={1.75}` (2 when active)
- Implemented via `NavItem` component in `app/web/src/components/RootLayout.tsx`

## Sign-in Page

- Branded header with ScatterChart icon + "Neptune SocialActiveApp" wordmark
- Clean two-column layout (form left, graph image right on desktop)
- Graph image contained within a `bg-secondary/50` panel

## Design Principles

1. **Graph-first** — visualization dominates; UI chrome recedes
2. **Precision over polish** — data density over decoration
3. **Dark-native** — dark mode is primary; light mode equally intentional
4. **Technical credibility** — Inter + JetBrains Mono, tight spacing, steel-blue palette
5. **WCAG 2.1 AA** — 4.5:1 text contrast, 3:1 UI components, keyboard navigation

## Files Changed

| File | What changed |
|------|-------------|
| `app/web/src/index.css` | New steel-blue color tokens (light + dark), sidebar tokens, antialiasing, Inter OpenType features |
| `app/web/index.html` | Inter + JetBrains Mono font loading, `color-scheme` meta, title → "Neptune SocialActiveApp" |
| `app/web/tailwind.config.js` | `fontFamily.sans/mono`, `colors.sidebar.*` tokens |
| `app/web/src/App.css` | Removed Vite boilerplate CSS |
| `app/web/src/components/RootLayout.tsx` | `NavItem` component with active-route highlighting, sidebar tokens, refined spacing |
| `app/web/src/routes/_auth/signin.tsx` | Branded header, refined typography, image containment |
