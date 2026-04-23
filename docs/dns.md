# DNS Configuration

The `DnsStack` manages the Route 53 public hosted zone for **mucker.io** and any associated DNS records.

## Stack: `socialActiveApp-DnsStack`

Defined in [`lib/dns-stack.ts`](../lib/dns-stack.ts) and instantiated in [`bin/backend.ts`](../bin/backend.ts).

## What It Creates

| Resource | Description |
|----------|-------------|
| **Public Hosted Zone** | `mucker.io` — the authoritative zone for the domain |
| **MX Records** (optional) | Mail exchange records for email routing |
| **TXT Records** (optional) | SPF, domain verification, and other TXT entries |

## Configuration

The domain name is set in [`config.ts`](../config.ts) via the `domainName` property:

```ts
domainName: "mucker.io",
```

### Adding MX Records

Pass `mxRecords` when instantiating the stack:

```ts
new DnsStack(app, `${appName}-DnsStack`, {
  domainName: deployConfig.domainName,
  mxRecords: [
    { hostName: "mail.mucker.io", priority: 10 },
  ],
  env,
});
```

### Adding TXT Records

Pass `txtRecords` for SPF, DKIM verification, etc.:

```ts
new DnsStack(app, `${appName}-DnsStack`, {
  domainName: deployConfig.domainName,
  txtRecords: [
    { values: ["v=spf1 include:_spf.google.com ~all"] },
    { name: "_dmarc", values: ["v=DMARC1; p=quarantine; rua=mailto:admin@mucker.io"] },
  ],
  env,
});
```

## Post-Deploy: Update Domain Registrar

After deploying the stack, copy the NS (name server) records from the Route 53 hosted zone and update your domain registrar to point to them. You can find the NS records in the AWS Console under **Route 53 → Hosted zones → mucker.io**, or via:

```bash
aws route53 list-hosted-zones-by-name --dns-name mucker.io \
  --query "HostedZones[0].Id" --output text | xargs -I {} \
  aws route53 get-hosted-zone --id {} --query "DelegationSet.NameServers"
```
