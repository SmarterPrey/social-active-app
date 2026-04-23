# GitHub Copilot Instructions for social-active-app

## Project Overview

AWS-native graph exploration tool: React 18 frontend → AppSync (GraphQL) → Lambda → Amazon Neptune. Built and deployed with CDK v2 in TypeScript. Design context and brand guidelines live in `CLAUDE.md`.

## Build and Test

### CDK (root)
```bash
npm ci                    # Install dependencies
npm run build             # Compile TypeScript (tsc) — required before deploy
npm test                  # Jest tests (test/**/*.test.ts)
npm run deployBackend -- --all --profile <PROFILE>
npm run deployFrontend -- --all --profile <PROFILE>
npm run generateEnv       # Generate .env for frontend from cdk-infra.json
```

### Frontend (`app/web/`)
```bash
pnpm install              # Frontend uses pnpm, not npm
pnpm dev                  # Vite dev server
pnpm build                # TypeScript + Vite production build
pnpm lint                 # ESLint
```

### Pitfalls
- `config.ts` is git-ignored — copy from `config.sample.ts` for local setup
- Backend and frontend are **separate CDK apps** with separate entry points (`bin/backend.ts`, `bin/frontend.ts`)
- Run `npm run generateEnv` after backend deploy, before frontend deploy
- Neptune uses RDS service primitives for event subscriptions — don't confuse with actual RDS

## Architecture

### CDK Stacks (backend entry: `bin/backend.ts`)
| Stack | Purpose |
|-------|---------|
| `NeptuneNetworkStack` | VPC, Neptune serverless cluster, bastion, scheduling |
| `ApiStack` | AppSync GraphQL API, Lambda resolvers, Cognito auth |
| `WafCloudFrontStack` | WAF rules (us-east-1 for CloudFront) |
| `ObservabilityStack` | Monitoring and alarms |
| `DnsStack` | Route 53 DNS records |

### CDK Stacks (frontend entry: `bin/frontend.ts`)
| Stack | Purpose |
|-------|---------|
| `WebappStack` | S3 + CloudFront for React SPA |

### Reusable constructs: `lib/constructs/`
All custom L2-style constructs (neptune, cognito, bastion, network, waf, web, etc.)

### Frontend (`app/web/src/`)
- **Router**: TanStack Router with file-based routes in `routes/`
- **UI components**: shadcn/ui (Radix primitives) in `components/ui/`
- **State**: Zustand (`store/`)
- **Auth**: AWS Amplify + Cognito (`config/amplify.ts`)
- **Graph visualization**: `react-force-graph-3d` (3D force-directed graph)
- **Pages**: graph, chat, monitoring, projects, register, settings

### API Layer (`api/`)
- GraphQL schema: `api/graphql/schema.graphql`
- Lambda resolvers: `api/lambda/` — `queryGraph.ts`, `mutationGraph.ts`, `aiQuery.ts`
- Function URL for bulk load: `api/lambda/functionUrl/`

## CDK Conventions

- **ALL infrastructure code MUST be TypeScript** (`.ts` files)
- Import from `aws-cdk-lib` (v2), use `constructs` for base class
- Use L2 constructs when available; L1 (`Cfn*`) only when necessary
- Use grants (`grant*`) for IAM instead of manual policy statements
- Set removal policies explicitly for stateful resources
- Tag resources with `Tags.of()`
- Configuration via `config.ts` (`deployConfig` object) — see `docs/config.md`
- CDK Nag (`AwsSolutionsChecks`) runs on all stacks — see `nag/NagLogger.ts`

## GitHub Issue Creation

- **ALL AI-created issues MUST start with "AI Created:" in the title**
  - Example: `AI Created: migrate from sms notifications to e-mail in paramstore`
- Include file paths as markdown links, verification steps, and relevant code references

## Security and Compliance

- Encryption at rest for stateful resources (S3, SNS, Neptune) with KMS CMKs + rotation
- CDK Nag compliance (`AwsSolutionsChecks`) — all stacks validated automatically
- Least-privilege IAM via CDK grants
- WAF rules in `lib/waf-stack.ts`

## Frontend Code Style

- React + TypeScript + Vite; pnpm as package manager
- TanStack Router with file-based routing (`routes/_authenticated/_layout/`)
- shadcn/ui components from `components/ui/`; Radix primitives underneath
- Zustand for state management
- Design tokens and aesthetic direction defined in `CLAUDE.md`

## Documentation

- **ALL changes MUST be documented in `docs/`** — see existing docs:
  - `docs/config.md` — configuration properties
  - `docs/design-system.md` — design tokens and theming
  - `docs/dns.md` — DNS setup
  - `docs/graph-explorer.md` — graph visualization
  - `docs/roles.md` — IAM roles and permissions
  - `docs/settings.md` — application settings
- Deployment instructions in `README.md`; contribution guidelines in `CONTRIBUTING.md`

## CI/CD

- GitHub Actions workflows in `.github/workflows/`
- `deploy.yml` — automated deploy on push to `main` (OIDC auth, no stored credentials)
- `neptune-control.yml` — manual start/stop/status for Neptune cluster
- `security-scan.yml` — security scanning
- Neptune cluster auto-stops at midnight Pacific, starts at 4pm Pacific to save costs