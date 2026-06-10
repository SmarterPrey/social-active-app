# Social Active App

A social networking platform for outdoor athletes — runners, trail runners,
mountaineers, scramblers, kayakers, divers, and anyone who'd rather meet new
people on a trailhead than in a coffee shop. Members find each other, plan
trips, RSVP to outings, and share photos and stories from the field.

The architecture is graph-native (Amazon Neptune) so social and activity
relationships — friends-of-friends, "people who climbed this route", "anyone
within 30 minutes of this put-in" — are first-class queries rather than joins.

## Architecture overview

The stack is the same backend pattern that powers
`SmarterPrey/build-neptune-graphapp-cdk`: a CloudFront-fronted React SPA on
S3, AppSync GraphQL backed by Lambda resolvers, Cognito for identity, and an
Amazon Neptune Serverless cluster in a private VPC reachable from a bastion
EC2 instance via SSM port-forwarding.

```
CloudFront ──► S3 (React SPA)
       │
       └──► AppSync (GraphQL) ──► Lambda resolvers ──► Neptune (Gremlin)
                       │
                       └──► Cognito (User Pool + Identity Pool, SES invites)
```

CDK stacks (under `lib/`):

- `NeptuneNetworkStack` — VPC, Neptune Serverless cluster, bastion host
- `DnsStack` — Route 53 hosted zone + SES email identity
- `ApiStack` — AppSync API, Lambda resolvers, Cognito user/identity pools
- `WafCloudFrontStack` — WAF Web ACL for the CloudFront distribution
- `ObservabilityStack` — CloudWatch dashboards, alarms, IAM monitoring policies
- `WebappStack` (frontend deploy) — S3 bucket + CloudFront for the SPA

Domain docs live in `docs/`:

| Doc | What it covers |
|-----|----------------|
| `feed.md` | Activity feed: posts, comments, likes, system posts |
| `events.md` | Outings/events: creation, scheduling, attachments |
| `members.md` | Member profiles and the members directory |
| `rsvp.md` | RSVP token flow for event invitations |
| `vendors.md` | Outdoor vendor / partner directory |
| `roles.md` | Role-based access (member, organizer, admin) |
| `settings.md` | User settings and preferences |
| `dns.md` | DnsStack details and registrar handoff |
| `config.md` | `config.ts` reference |
| `design-system.md` | Frontend design tokens and component conventions |

## Prerequisites

- Node.js >= 22.x (LTS)
- AWS Account, AWS CLI configured
  ([config files reference](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html))
- Docker (for CDK Lambda bundling)
- A domain you control, with a Route 53 hosted zone you can attach to

## Deployment

### Option 1: Automated CI/CD (Recommended)

`.github/workflows/deploy.yml` deploys backend then frontend on push to `main`,
using AWS OIDC (no long-term credentials in GitHub).

#### One-time setup

1. **AWS OIDC provider + role**
   - Create an IAM OIDC identity provider for `token.actions.githubusercontent.com`
   - Create a role (default name `GitHubActionsDeployRole`) with a trust policy
     scoped to `repo:SmarterPrey/social-active-app:*`
   - Attach `PowerUserAccess` (or a tighter custom policy covering CloudFormation,
     Neptune, VPC, Lambda, AppSync, Cognito, S3, CloudFront, WAF, IAM)

2. **GitHub secret**
   - Add `AWS_ACCOUNT_ID` as a repository secret (used by both workflows)

3. **CDK bootstrap** (once per account/region):
   ```bash
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
   ```

4. **Configuration**: copy `config.sample.ts` → `config.ts` and fill in real values
   (domain, app URL, sender address, etc.). `config.ts` is gitignored.

### Option 2: Manual deployment

```bash
# Install
npm ci

# Bootstrap (first time, per account+region)
npm run cdk -- bootstrap --profile <YOUR_AWS_PROFILE>

# Deploy shared DNS (Route 53 hosted zone + SES identity) — once per account
npm run deployDns -- --profile <YOUR_AWS_PROFILE>

# After deploying, retrieve the Route 53 nameservers and update your domain registrar:
aws route53 list-hosted-zones-by-name \
  --dns-name mucker.io \
  --profile <YOUR_AWS_PROFILE> \
  --query "HostedZones[0].Id" \
  --output text | xargs -I{} \
  aws route53 get-hosted-zone --id {} --profile <YOUR_AWS_PROFILE> \
  --query "DelegationSet.NameServers" --output table
# Log in to your domain registrar and set the NS records to the four
# nameservers printed above. DNS changes propagate within minutes to 48 hours.
# SES DKIM verification completes automatically once NS records are live.

# Deploy backend for a specific stage (dev | qa | prod)
# Stack names are prefixed: dev-mucker-*, qa-mucker-*, pr-mucker-*
npm run deployBackend:dev  -- --profile <YOUR_AWS_PROFILE>
npm run deployBackend:qa   -- --profile <YOUR_AWS_PROFILE>
npm run deployBackend:prod -- --profile <YOUR_AWS_PROFILE>

# Generate the React .env from CDK outputs (run after each backend deploy)
npm run generateEnv

# Deploy frontend for a specific stage (S3 + CloudFront)
npm run deployFrontend:dev  -- --profile <YOUR_AWS_PROFILE>
npm run deployFrontend:qa   -- --profile <YOUR_AWS_PROFILE>
npm run deployFrontend:prod -- --profile <YOUR_AWS_PROFILE>
```

### Stage reference

| Stage  | Branch  | Stack prefix     | Commands                                              |
|--------|---------|------------------|-------------------------------------------------------|
| `dev`  | `dev`   | `dev-mucker-*`   | `deployBackend:dev`, `deployFrontend:dev`             |
| `qa`   | `qa`    | `qa-mucker-*`    | `deployBackend:qa`, `deployFrontend:qa`               |
| `prod` | `main`  | `pr-mucker-*`    | `deployBackend:prod`, `deployFrontend:prod`           |

**Shared resources** (deployed once, stage-agnostic):
- `mucker-DnsStack` — Route 53 hosted zone + SES identity for `mucker.io`

### Per-stage AWS account IDs

To pin each stage to a specific AWS account (without relying solely on
`--profile` resolution), copy `.env.sample` to `.env` and fill in:

```bash
cp .env.sample .env
# edit .env
DEV_ACCOUNT_ID=111111111111
QA_ACCOUNT_ID=222222222222
PROD_ACCOUNT_ID=333333333333
```

`bin/backend.ts`, `bin/frontend.ts`, and `bin/dns.ts` load `.env` at
startup and use `<STAGE>_ACCOUNT_ID` as the deployment account (overriding
`CDK_DEFAULT_ACCOUNT`). Optional `<STAGE>_REGION` overrides the region.
The `.env` file is gitignored.

The frontend URL is printed as `socialActiveApp-WebappStack.webappurl…` and will ultimately resolve at `app.mucker.io`.

## Bulk loading initial graph data

The `apiBulkLoadFn` Lambda function URL bulk-loads vertex/edge CSVs from S3
into Neptune. Place files at the S3 URIs configured in `config.ts → s3Uri`,
then invoke the function URL with SigV4-signed credentials:

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...
export FUNCTION_URL=...
curl "${FUNCTION_URL}" \
  -H "X-Amz-Security-Token: ${AWS_SESSION_TOKEN}" \
  --aws-sigv4 "aws:amz:us-east-1:lambda" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}"
```

## Useful commands

| Command | What it does |
|---------|--------------|
| `npm run deployDns` | Deploy shared Route 53 hosted zone + SES identity (once per account) |
| `npm run deployBackend:<stage>` | Deploy backend for a stage (`dev` → `dev-mucker-*`, `qa` → `qa-mucker-*`, `prod` → `pr-mucker-*`) |
| `npm run deployFrontend:<stage>` | Deploy frontend S3 + CloudFront SPA for a stage |
| `npm run destroyBackend:<stage>` | Tear down a stage's backend stacks (`dev`, `qa`, or `prod`) |
| `npm run destroyFrontend:<stage>` | Tear down a stage's frontend stack |
| `npm run generateEnv:<stage>` | Write `app/web/.env.<stage>` from CDK outputs |
| `npm run build` | Compile TypeScript |
| `npm test` | Run Jest tests |

## Tearing down a deployment

Each stage's destroy command passes `--all -c stage=<stage>` for you, so all
four backend stacks (or the single frontend stack) for that stage come down
together. The AWS account is selected by the profile/credentials you pass.

**Stack name → stage mapping:**

| CloudFormation stack prefix | Use this stage |
|------------------------------|----------------|
| `dev-mucker-*`               | `:dev`         |
| `qa-mucker-*`                | `:qa`          |
| `pr-mucker-*`                | `:prod`        |
| `mucker-DnsStack`            | shared — see below |

If a destroy command appears to do nothing, it's because no stacks for that
stage exist in the target account. Verify with:

```bash
aws cloudformation list-stacks --profile <YOUR_AWS_PROFILE> \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[?contains(StackName,`mucker`)].StackName' \
  --output table
```

```bash
# Destroy a single stage (backend = 4 stacks, frontend = 1 stack)
npm run destroyBackend:dev   -- --profile <YOUR_AWS_PROFILE>
npm run destroyFrontend:dev  -- --profile <YOUR_AWS_PROFILE>

npm run destroyBackend:qa    -- --profile <YOUR_AWS_PROFILE>
npm run destroyFrontend:qa   -- --profile <YOUR_AWS_PROFILE>

npm run destroyBackend:prod  -- --profile <YOUR_AWS_PROFILE>
npm run destroyFrontend:prod -- --profile <YOUR_AWS_PROFILE>
```

CDK will list the stacks it found and prompt:
`Are you sure you want to delete: ... (y/n)?` — answer `y`. Stacks delete one
at a time; Neptune Network typically takes the longest (~5–10 min).

**Neptune stopped-state gotcha:** Neptune instances cannot be deleted while
the cluster is in `stopped` state (the nightly cost-saving schedule in
`bin/backend.ts → neptuneSchedule` stops it automatically). The
`destroyBackend:<stage>` npm scripts use `scripts/safe-destroy-backend.sh`
which detects this and starts the cluster before running `cdk destroy`.
Manual recovery if you hit `DELETE_FAILED` on `NeptuneNetworkStack`:

```bash
# 1. Start the cluster
aws neptune start-db-cluster --db-cluster-identifier <cluster-id> \
  --profile <YOUR_AWS_PROFILE>

# 2. Wait until Status == "available" (roughly 5-10 min)
aws neptune describe-db-clusters --db-cluster-identifier <cluster-id> \
  --profile <YOUR_AWS_PROFILE> --query 'DBClusters[0].Status' --output text

# 3. Retry the destroy
npm run destroyBackend:prod -- --profile <YOUR_AWS_PROFILE>
```

**Order matters when fully removing a stage:** destroy the frontend first
(it consumes API/Cognito outputs), then the backend.

**Targeting a single stack** (e.g. just observability):

```bash
npm run destroyBackend -- -c stage=dev dev-mucker-ObservabilityStack \
  --profile <YOUR_AWS_PROFILE>
```

The `-c stage=<stage>` context flag is required so CDK constructs the same
stack names that were deployed.

### Removing the shared `mucker-DnsStack`

`destroyBackend:<stage>` and `destroyFrontend:<stage>` **do not** touch
`mucker-DnsStack`. It lives in a separate CDK app (`bin/dns.ts`) because all
stages share the same Route 53 hosted zone and SES identity for `mucker.io`.

To remove it explicitly:

```bash
cdk destroy --app "node -e \"require('./bin/dns.js')\"" mucker-DnsStack \
  --profile <YOUR_AWS_PROFILE>
```

⚠️ **Warnings before destroying DnsStack:**

- **Nameservers will change.** Route 53 assigns a new set of NS records
  every time the hosted zone is recreated. After redeploying you must update
  the NS records at your domain registrar (the four `ns-*.awsdns-*.{com,
  net,org,co.uk}` values printed by `npm run deployDns`).
- **Email delivery will break.** The SES domain identity and DKIM records
  go away with the zone. Cognito invitation emails and RSVP emails will
  fail to send until DnsStack is redeployed and DKIM verification completes
  (~5–15 min after redeploy).
- **DNS propagation lag.** Even after redeploying, browsers and resolvers
  may cache the old NS records for up to the previous TTL (typically 24–48
  hours). Consider lowering TTLs ahead of time if a planned migration.
- **Do not destroy DnsStack while any backend stack is still deployed** —
  Cognito's email config references the SES identity ARN computed from
  `${env.region}:${env.account}:identity/${config.domainName}`. Removing
  the identity invalidates that reference. Tear down all stages' backends
  first, then DnsStack.

### Stateful resources to clean up manually

(RemovalPolicy.RETAIN on prod, or resources CDK can't auto-empty):

- S3 buckets that contain objects (CloudFront logs, media uploads) — empty
  them in the console first, then re-run destroy
- Neptune cluster snapshots and CloudWatch log groups
- KMS CMKs (scheduled-deletion window applies)

## Neptune cluster cost control

The Neptune Serverless cluster is scheduled to stop at midnight Pacific and
start at 4 PM Pacific by default (see `bin/backend.ts → neptuneSchedule`).
You can also drive it on-demand via the **Neptune Cluster Control** workflow:

```bash
gh workflow run neptune-control.yml -f action=status
gh workflow run neptune-control.yml -f action=start
gh workflow run neptune-control.yml -f action=stop
```

## License

Apache-2.0. See [LICENSE](LICENSE).
