# Members

The members directory lists everyone with a Cognito `Member` group
membership. Email and phone are gated by the connection state — see below.

## Data model

- `Member { id (= Cognito sub), name, title, company, photoUrl, email?, phone? }`
- Edge `CONNECTED_WITH { status: "requested" | "connected" | "declined" }`
  between two `Member` vertices. Mirror edges are written on accept so the
  relationship is symmetric.

## Queries

- `listMembers` — directory, includes `connectionStatus` per row computed
  relative to the caller.
- `getMember(id)` — full profile. `email` / `phone` are redacted (`null`)
  unless the caller is the subject or they are `connected`.

## Mutations

- `requestConnection(toMemberId)` — creates a `CONNECTED_WITH(requested)`
  edge.
- `respondToConnection(fromMemberId, accept)` — flips the edge to
  `connected` or `declined`; on accept also writes the mirror edge so
  subsequent reads are symmetric without a second hop.
- `updateMemberProfile(input)` — member edits their own profile.

## Auto-provisioning

Today: an admin invites a user to Cognito; the user accepts, signs in, and
on first sign-in the frontend calls `updateMemberProfile` which creates the
`Member` vertex. A future improvement is a Cognito PostConfirmation trigger
that creates the vertex server-side.
