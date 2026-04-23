# Config doc

These properties in details are as follows.

| Property                | Description                                                                               | Type                           | Default value                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------- |
| appName                 | Application name for stack                                                                | string                         | `dev`                                           |
| region                  | Deployment AWS resouces the to region                                                     | string                         | `us-east-1`                                     |
| adminEmail              | Send the temporary password to this email for signing graph application                   | string                         | `your_email@acme.com`                           |
| allowedIps              | AWS WAF allowed this ips to access to the graph application. e.g.) [`"192.0.3.0/24"`]     | string[]                       | `[]`                                            |
| wafParamName            | The name of Paramater store in AWS Systems Manager which stores the web acl id of AWS WAF | string                         | `socialActiveAppWafWebACLID`                           |
| webBucketsRemovalPolicy | Removal policy for S3 buckets                                                             | `RemovalPolicy`                | `RemovalPolicy.DESTROY`                         |
| s3Uri                   | S3 URI of `vertex.csv` and `edge.csv` which you stored in.                                | { edge: string,vertex: string} | `{edge: "EDGE_S3_URI",vertex: "VERTEX_S3_URI"}` |

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
