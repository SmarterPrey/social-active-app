# AGENTS.md

Guidance for AI coding agents working in `SmarterPrey/social-active-app`.

## Project at a glance

- Product: social network for outdoor athletes
- Architecture: React SPA (S3/CloudFront) → AppSync GraphQL → Lambda → Amazon Neptune
- Infrastructure: AWS CDK v2 in TypeScript
- Core docs: `README.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `docs/`

## Repository layout

- `app/web/` — React 18 + TypeScript + Vite frontend (pnpm)
- `api/` — GraphQL schema and Lambda resolvers
- `lib/`, `bin/`, `nag/` — CDK stacks, constructs, and nag setup
- `docs/` — feature and operational documentation

## Setup and validation commands

### Root (CDK/backend)

```bash
npm ci
npm run build
npm test
```

### Frontend

```bash
cd app/web
pnpm install
pnpm lint
pnpm build
```

## Agent workflow expectations

1. Keep changes small and scoped to the requested task.
2. Prefer existing patterns and libraries already used in the repo.
3. Update relevant documentation in `docs/` when behavior or configuration changes.
4. Validate affected areas with existing lint/build/test commands.
5. Avoid unrelated refactors.

## Important project constraints

- Frontend package manager is **pnpm** (not npm).
- `config.ts` is gitignored; use `config.sample.ts` as the template.
- Backend and frontend are separate CDK apps (`bin/backend.ts`, `bin/frontend.ts`).
- Run `npm run generateEnv` after backend deploy and before frontend deploy.
- For AWS CLI commands, use `--no-cli-pager` and `AWS_PAGER=""`.

## Coding conventions

### Frontend (`app/web/**`)

- TanStack Router file-based routes
- shadcn/ui + Radix components under `src/components/ui/`
- Zustand state under `src/store/`
- Follow design and accessibility guidance in `CLAUDE.md` and `docs/design-system.md`

### CDK/Infrastructure (`lib/**`, `bin/**`, `nag/**`)

- TypeScript only
- Prefer CDK L2 constructs over L1 where possible
- Use `grant*` IAM helpers when available
- Set explicit removal policies on stateful resources
- Keep CDK Nag compliance intact

## Security and safety checks

- Do not commit secrets, credentials, or private keys.
- Preserve least-privilege IAM posture.
- Keep encryption-at-rest defaults for stateful AWS resources.
- Do not bypass CI/security workflows.

## Pull requests and issues

- Keep PRs focused with clear summaries and verification steps.
- If creating GitHub issues via AI, title must start with `AI Created:`.

