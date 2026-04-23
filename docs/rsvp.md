# RSVP pipeline

Events send one-click RSVP emails. Recipients never need to sign in — the
token in the link is itself proof of identity.

## Components

- [`lib/constructs/rsvp.ts`](../lib/constructs/rsvp.ts) — SQS queue, DLQ,
  Secrets Manager secret for HMAC signing, and the `rsvpEmailerFn` Lambda
  that consumes the queue.
- [`lib/constructs/media.ts`](../lib/constructs/media.ts) — KMS-encrypted
  S3 bucket + CloudFront (used to host event videos referenced from the
  RSVP emails).
- [`api/lambda/rsvpEmailer.ts`](../api/lambda/rsvpEmailer.ts) — SQS consumer
  that renders the invite HTML and calls SES v2 `SendEmail`.
- `signRsvpToken` / `verifyRsvpToken` in
  [`api/lambda/social.ts`](../api/lambda/social.ts) — HMAC-SHA256, base64url,
  timing-safe compare.

## Token format

```
<base64url(JSON { eventId, memberId, exp })>.<base64url(HMAC-SHA256)>
```

The secret is stored in Secrets Manager; the mutation and query Lambdas
fetch it on cold start (`RSVP_SIGNING_SECRET_ARN` env var) and cache the
plaintext in memory for the life of the container.

## Authorization

The `submitRsvp` / `getRsvpByToken` fields are exposed via an AppSync
**API key** auth provider in addition to Cognito — so invitees without a
member account can respond. All other queries/mutations remain Cognito-only.
Rate-limiting is expected to be added via WAF at the AppSync edge.

## Flow

1. Admin checks "send invites now" on
   [`/admin/events/new`](../app/web/src/routes/_authenticated/_layout/admin/events/new.tsx).
2. `sendEventRsvpEmails` mutation iterates `Member` vertices, signs one
   token per member, and enqueues an SQS message.
3. `rsvpEmailerFn` consumes the queue and sends an SES email with
   Attend / Can't / Maybe buttons that all link to
   `${RSVP_BASE_URL}/rsvp?token=…&r=yes|no|maybe`.
4. The RSVP page calls `submitRsvp(token, response)`; the Lambda verifies
   the signature and upserts a singleton `Rsvp` vertex per `(member, event)`.

## Operational notes

- SES from-address must be verified in the deployment region.
- DLQ retention is 14 days — alarm on `ApproximateNumberOfMessagesVisible`.
- Rotate the RSVP signing secret by creating a new Secrets Manager version;
  existing tokens will fail verification and need re-issuing.
