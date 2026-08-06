# Config doc

These properties in details are as follows.

| Property                | Description                                                                               | Type                           | Default value                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------- |
| appName                 | Application name for stack                                                                | string                         | `dev`                                           |
| region                  | Deployment AWS resouces the to region                                                     | string                         | `us-east-1`                                     |
| adminEmail              | Send the temporary password to this email for signing graph application                   | string                         | `your_email@acme.com`                           |
| allowedIps              | AWS WAF allowed this ips to access to the graph application. e.g.) [`"192.0.3.0/24"`]     | string[]                       | `[]`                                            |
| wafParamName            | The name of Paramater store in AWS Systems Manager which stores the web acl id of AWS WAF | string                         | `socialActiveAppWafWebACLID`                           |
| webDomainNames          | Custom domain names served by the webapp's CloudFront distribution. All names must belong to the Route 53 hosted zone identified by `domainName`. Leave empty/undefined to skip cert + alias wiring and serve only on the default `*.cloudfront.net` URL. | string[] (optional)            | `["mucker.io", "www.mucker.io"]` (prod)         |
| webBucketsRemovalPolicy | Removal policy for S3 buckets                                                             | `RemovalPolicy`                | `RemovalPolicy.DESTROY`                         |
| s3Uri                   | S3 URI of `vertex.csv` and `edge.csv` which you stored in.                                | { edge: string,vertex: string} | `{edge: "EDGE_S3_URI",vertex: "VERTEX_S3_URI"}` |

## Webapp Custom Domain

## Generated Frontend Env

Run `npm run generateEnv` after backend deploy. It writes `app/web/.env` from `cdk-infra.json` outputs.

- `VITE_APP_NAME` — deployment prefix used by monitoring SSM paths (for example, `pr-mucker`)
- `VITE_COGNITO_USERPOOLID`
- `VITE_COGNITO_USERPOLL_CLIENTID`
- `VITE_COGNITO_IDENTITYPOOLID`
- `VITE_COGNITO_REGION`
- `VITE_GRAPHQL_URL`

When `webDomainNames` is non-empty, the `WebappStack` will:

1. Look up the Route 53 hosted zone identified by `domainName` (must exist — created by `DnsStack`).
2. Issue a DNS-validated ACM certificate in the deployment region (must be `us-east-1` for CloudFront) covering all `webDomainNames`. The first entry is the cert's primary CN; the rest are SANs.
3. Attach the certificate and alias names to the CloudFront distribution.
4. Create A and AAAA alias records in Route 53 for each name → CloudFront.

**Important:** If a manual record (CNAME, A, AAAA) already exists in the hosted zone for any of the configured `webDomainNames`, the stack deployment will fail. Delete the manual record first via `aws route53 change-resource-record-sets` or the console.

## Neptune Serverless Capacity

The Neptune Serverless cluster scales between `minCapacity` (1 NCU) and `maxCapacity` (8 NCU) by default. Override via `neptuneServerlssCapacity` in the backend stack props.

| Setting | Default | Notes |
|---------|---------|-------|
| `minCapacity` | `1` NCU | Minimum Neptune Capacity Units |
| `maxCapacity` | `8` NCU | Maximum Neptune Capacity Units (raised from 2.5 after capacity alarm — March 2026) |

The **NeptuneCapacityAlarm** fires when `ServerlessDatabaseCapacity` averages ≥ **6 NCU** (75% of max) across 3 consecutive 5-minute periods. If the alarm triggers again, consider raising `maxCapacity` to the next Neptune Serverless tier (32 NCU).

## Parameter Store Configuration

### Neptune Notification Emails

**Parameter Path:** `/global-app-params/rdsnotificationemails`

**Description:** Comma-separated list of email addresses that will receive Neptune cluster event notifications (failover, failure, maintenance, notification events).

**Format:** `email1@example.com,email2@example.com,email3@example.com`

**Example:**
```
admin@example.com,admin@example.com,ops@example.com
```

**Important Notes:**
- Email addresses must be confirmed via SNS subscription confirmation emails sent by AWS
- Whitespace around emails is automatically trimmed
- Empty or malformed parameter values will be handled gracefully without breaking deployment
- If the parameter doesn't exist, deployment will fail with a clear error message
- Changes to the parameter value require a stack update to take effect

**Manual Setup (before deployment):**
1. Create the parameter in AWS Systems Manager Parameter Store:
   ```bash
   aws ssm put-parameter \
     --name "/global-app-params/rdsnotificationemails" \
     --value "your-email@example.com" \
     --type String \
     --description "Comma-separated list of emails for Neptune notifications"
   ```

2. After deployment, confirm subscriptions by clicking links in confirmation emails sent by AWS SNS
