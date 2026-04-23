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

# Deploy backend (Neptune, VPC, AppSync, Cognito, observability)
npm run deployBackend -- --all --profile <YOUR_AWS_PROFILE>

# Generate the React .env from CDK outputs
npm run generateEnv

# Deploy frontend (S3 + CloudFront)
npm run deployFrontend -- --all --profile <YOUR_AWS_PROFILE>
```

The frontend URL is printed as `socialActiveApp-WebappStack.webappurl…`.

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
| `npm run deployBackend` | Deploy Neptune + API + Cognito stacks |
| `npm run deployFrontend` | Deploy S3 + CloudFront SPA |
| `npm run destroyBackend` | Tear down backend stacks |
| `npm run destroyFrontend` | Tear down frontend stacks |
| `npm run generateEnv` | Write `app/web/.env` from CDK outputs |
| `npm run build` | Compile TypeScript |
| `npm test` | Run Jest tests |

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
