---
description: "Walk through the full deploy sequence: build, deploy backend, generate env, deploy frontend. Catches common ordering mistakes."
agent: "agent"
argument-hint: "AWS profile name and optional flags (e.g. --all)"
---

Run the full deployment sequence for this CDK project. The order matters — skipping steps causes failures.

## Steps

1. **Compile TypeScript** — `npm run build` at the repo root. Fix any type errors before proceeding.
2. **Deploy backend** — `npm run deployBackend -- --all --profile {{profile}}`. Wait for completion and capture outputs from `cdk-infra.json`.
3. **Generate frontend env** — `npm run generateEnv`. This reads `cdk-infra.json` and writes `.env` for the React app. Must run after backend deploy.
4. **Deploy frontend** — `npm run deployFrontend -- --all --profile {{profile}}`. Deploys the React SPA to S3 + CloudFront.

## Rules

- NEVER deploy frontend before running `generateEnv` — it will use stale or missing env vars.
- NEVER skip `npm run build` — the deploy scripts use compiled `.js` files.
- If any step fails, stop and diagnose before continuing.
- Report the CloudFront URL from the `WebappStack` output when complete.
