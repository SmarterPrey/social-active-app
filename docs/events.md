# Events

Events are created by Admins and can feature one or more `Vendor`s. Members
RSVP via a signed one-click link sent from the RSVP pipeline.

## Data model

Vertices: `Event { id, title, description, startsAt, endsAt, venue, city,
videoUrl? }`, `Rsvp { status: yes | no | maybe, respondedAt }`.

Edges: `RSVPD: Member → Rsvp` + `FOR: Rsvp → Event`,
`FEATURES: Event → Vendor`.

## Admin workflow

1. Admin visits [`/admin/events/new`](../app/web/src/routes/_authenticated/_layout/admin/events/new.tsx),
   fills in title/description/dates/venue and picks vendors from chips.
2. On save, backend creates the `Event` vertex and `FEATURES` edges.
3. If "send invites now" is checked, the backend iterates all `Member`s,
   signs a per-member HMAC token with the RSVP secret, and enqueues one SQS
   message per member. See [rsvp.md](./rsvp.md).

## Event video

Admins upload a video file via a presigned S3 PUT URL returned by
`requestEventVideoUpload`. After the upload completes, the client calls
`attachEventVideo(eventId, videoUrl)` which:

1. Sets `videoUrl` on the `Event` vertex.
2. Creates a system `Post` (kind=`video`) that surfaces in the feed.

## Public RSVP endpoints

`submitRsvp(token, response)` and `getRsvpByToken(token)` are authorized via
an AppSync **API key** (see
[lib/constructs/api.ts](../lib/constructs/api.ts)) — the token itself is the
secret. The Lambda verifies the HMAC signature before writing the `Rsvp`
vertex.
