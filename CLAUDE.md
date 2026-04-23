# CLAUDE.md

Project-level guidance for Claude Code.

## Project Overview

**Social Active App** is a social network for outdoor athletes — runners, trail
runners, mountaineers, scramblers, kayakers, divers, and anyone organizing
group outings outside. The product is graph-native: members, activities,
locations, gear, and trips are vertices in an Amazon Neptune cluster, so
"friends-of-friends who climbed this route" or "people within 30 minutes of
this put-in next Saturday" are first-class queries.

The architecture is forked from `SmarterPrey/build-neptune-graphapp-cdk`:
React SPA on CloudFront/S3, AppSync GraphQL with Lambda resolvers, Cognito
identity, Neptune Serverless in a private VPC.

**Tech stack**: React 18 + TypeScript, Vite, TanStack Router, Radix UI,
Tailwind CSS, AWS Amplify, AppSync (GraphQL), Amazon Neptune (Gremlin), AWS
CDK (TypeScript) for infra.

---

## Design Context

### Users
Outdoor athletes and trip organizers. They reach for the app between sessions
— planning a Saturday scramble, posting photos from yesterday's paddle,
checking who else is heading to a particular crag. They're outdoors-literate
and care about specifics (route grade, water level, snowpack, depth) but
don't want a database UI. The app should feel friendly and mobile-first, not
like enterprise software.

**Emotional goal**: "These are my people." — welcoming, specific, energizing.

### Brand Personality
**Warm, capable, outside.** Confident without being macho. Specific without
being gatekeepy. The interface should feel like a well-organized trip plan:
clear, prepared, and ready for weather. Avoid generic fitness-app gloss.

### Aesthetic Direction
- **Reference**: Strava's information density meets AllTrails' approachability,
  with a feed surface closer to LinkedIn (in structure) than Instagram.
- **Anti-reference**: Avoid hyper-saturated fitness-tracker aesthetics
  (electric magenta/lime gradients), generic SaaS blues, and gamification
  chrome (badges, XP bars). Avoid anything that feels like enterprise admin.
- **Theme**: System-adaptive; both light and dark modes are first-class.
  Light mode is the natural home (people use this outside, on phones).
- **Visual tone**: Earthy and atmospheric. Backgrounds should feel like
  paper, granite, or open sky — not flat slate. Photography is hero content.
- **Color direction**: Mountain palette — slate, stone, moss, alpine sky.
  Reserved warm accents (sunrise orange, kelp gold) for status and CTAs.
  Avoid neon and vivid synthetic colors.
- **Typography**: Geometric sans-serif (Inter or Geist Sans) for UI; a
  reserved serif (Source Serif, Newsreader) for long-form posts and event
  descriptions. Monospace only for coordinates, IDs, and code.
- **Motion**: Purposeful — feed transitions, RSVP confirmations, photo
  parallax. No decorative loops. Respect `prefers-reduced-motion`.

### Accessibility
- Target **WCAG 2.1 AA** compliance
- 4.5:1 contrast for text, 3:1 for UI components
- Full keyboard navigation; visible focus rings
- Touch targets ≥ 44pt (mobile-first)
- Respect `prefers-reduced-motion`

### Design Principles
1. **Mobile-first, glove-friendly.** People use this outdoors. Big tap
   targets, high contrast, no precise gestures required.
2. **People before data.** Avatars, names, faces lead. The graph is the
   substrate, not the surface.
3. **Specific over generic.** "Friday 6am · Mt. Si · 5 going" beats a
   timestamp and a count. Use the right unit (mi/km, ft/m, °F/°C, depth).
4. **Earn the post.** No decorative animations, no notification spam. The
   feed is opt-in attention; reward it with substance.
5. **Trust the place.** Map and location data should be precise and current.
   When data is stale, say so.

### Implementation Tokens
Concrete values that guide design decisions:

| Token | Value | Notes |
|-------|-------|-------|
| Accent (primary) | ~25-35 (sunrise orange) | Warm, reserved for CTAs/status |
| Accent (secondary) | ~150-170 (moss/alpine) | Trail/water cues |
| Neutral palette | Stone/slate range | Avoid pure black/white |
| Font family (UI) | `Inter`, `Geist Sans`, system sans | |
| Font family (prose) | `Source Serif`, `Newsreader`, system serif | Long-form posts |
| Font family (data) | `JetBrains Mono`, `Fira Code`, system mono | Coords, IDs |
| Motion | Purposeful | Page transitions, RSVP, photo parallax |
| WCAG target | AA (2.1) | 4.5:1 text, 3:1 UI |
| Border radius | `0.5rem` base | Current `--radius` value |
| Touch target | ≥ 44pt | Mobile-first |
