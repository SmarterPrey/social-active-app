---
description: "Use when writing or modifying CDK infrastructure code — stacks, constructs, IAM, Neptune, or any aws-cdk-lib usage."
applyTo: "lib/**,bin/**,nag/**"
---

# CDK Infrastructure Rules

## Stack Architecture

Backend (`bin/backend.ts`): NeptuneNetworkStack → ApiStack → WafCloudFrontStack → ObservabilityStack → DnsStack
Frontend (`bin/frontend.ts`): WebappStack

Reusable constructs live in `lib/constructs/`. Create new constructs there — not inline in stacks.

## Code Rules

- Import from `aws-cdk-lib` (v2). Use `constructs.Construct` as base class.
- Prefer L2 constructs. Use L1 (`Cfn*`) only when L2 doesn't expose what you need.
- Use `grant*()` methods for IAM — never write inline policy statements unless grants don't exist.
- Set `removalPolicy` explicitly on stateful resources (S3, DynamoDB, Neptune, SNS).
- Tag resources: `Tags.of(construct).add('key', 'value')`.
- Encrypt at rest with KMS CMKs + key rotation for stateful resources.

## Configuration

All environment-specific values come from `config.ts` (`deployConfig` object). See `docs/config.md`.
`config.ts` is git-ignored — copy from `config.sample.ts` for local setup.

## CDK Nag Compliance

`AwsSolutionsChecks` runs on every stack (see `nag/NagLogger.ts`). New resources must pass Nag validation.
If a suppression is genuinely needed, add it with a clear `reason` string — never suppress without justification.

## Neptune

- Neptune uses RDS service primitives for events — don't confuse with actual RDS.
- Serverless cluster config in `lib/constructs/neptune.ts`.
- Auto-scheduling (stop/start) configured in the NeptuneNetworkStack.
