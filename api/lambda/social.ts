// Social / member-networking resolvers — Gremlin traversals against Neptune.
//
// Invoked from queryGraph.ts + mutationGraph.ts when `event.field` matches
// one of the networking operations. The calling handlers pass an active
// traversal source `g` plus the AppSync identity context.
//
// Graph data model (see docs/feed.md, docs/members.md, etc.):
//   Vertices: Member, Event, Vendor, VendorContact, Post, Comment, Feedback,
//             Rsvp
//   Edges:    POSTED (Member -> Post)
//             COMMENTED (Member -> Comment), ON (Comment -> Post|Event|Vendor)
//             LIKED (Member -> Post)
//             RSVPD (Member -> Rsvp), FOR (Rsvp -> Event)
//             FEATURES (Event -> Vendor)
//             HAS_CONTACT (Vendor -> VendorContact)
//             CONNECTED_WITH (Member <-> Member; status on edge)
//             LEFT_FEEDBACK (Member -> Feedback), ABOUT (Feedback -> Event|Vendor)

import * as crypto from "crypto";
import * as gremlin from "gremlin";
const { P, TextP, order, t: T } = gremlin.process;
const __ = gremlin.process.statics;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type G = any;
interface Ctx {
  g: G | null;
  identity: { sub?: string; username?: string; groups?: string[] } | null;
}

// T.id and similar enum values aren't valid index keys in strict TS;
// use the string forms used by Neptune's elementMap output.
const idKey = T.id as unknown as string;

const nowIso = () => new Date().toISOString();

// ---------- RSVP token signing -----------------------------------------------

let _cachedSecret: string | null = null;
let _secretPromise: Promise<string> | null = null;

async function resolveRsvpSecret(): Promise<string> {
  if (_cachedSecret) return _cachedSecret;
  const inline = process.env.RSVP_SIGNING_SECRET;
  if (inline) {
    _cachedSecret = inline;
    return inline;
  }
  const arn = process.env.RSVP_SIGNING_SECRET_ARN;
  if (!arn) {
    throw new Error(
      "Neither RSVP_SIGNING_SECRET nor RSVP_SIGNING_SECRET_ARN is set",
    );
  }
  if (!_secretPromise) {
    _secretPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(
        /* webpackIgnore: true */ "@aws-sdk/client-secrets-manager" as string
      );
      const client = new mod.SecretsManagerClient({
        region: process.env.AWS_REGION,
      });
      const out = await client.send(
        new mod.GetSecretValueCommand({ SecretId: arn }),
      );
      const value = (out.SecretString as string) ?? "";
      if (!value) throw new Error("RSVP signing secret is empty");
      _cachedSecret = value;
      return value;
    })();
  }
  return _secretPromise;
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export async function signRsvpToken(payload: {
  eventId: string;
  memberId: string;
  exp?: number;
}): Promise<string> {
  const secret = await resolveRsvpSecret();
  const body = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = base64url(
    crypto.createHmac("sha256", secret).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export async function verifyRsvpToken(
  token: string,
): Promise<{ eventId: string; memberId: string; exp?: number } | null> {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) return null;
  const secret = await resolveRsvpSecret();
  const expected = base64url(
    crypto.createHmac("sha256", secret).update(body).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(
        body.replace(/-/g, "+").replace(/_/g, "/") +
          "=".repeat((4 - (body.length % 4)) % 4),
        "base64",
      ).toString("utf-8"),
    );
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- shared element map → domain object helpers -----------------------

// Neptune elementMap keys come back as JS Maps under gremlin-v2; normalize.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlain(m: any): Record<string, unknown> {
  if (!m) return {};
  if (m instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of m.entries()) {
      const key = typeof k === "symbol" ? String(k) : String(k);
      obj[key] = v instanceof Map ? toPlain(v) : v;
    }
    return obj;
  }
  return m as Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asId(v: any): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMember(m: any): unknown {
  const p = toPlain(m);
  return {
    id: asId(p[idKey] ?? p["id"]),
    name: p.name ?? "",
    title: p.title ?? null,
    company: p.company ?? null,
    bio: p.bio ?? null,
    avatarUrl: p.avatarUrl ?? null,
    email: null, // hidden by default; revealed by getMember when connected
    phone: null,
    connectionStatus: "none",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapVendor(m: any): unknown {
  const p = toPlain(m);
  return {
    id: asId(p[idKey] ?? p["id"]),
    name: p.name ?? "",
    tagline: p.tagline ?? null,
    description: p.description ?? null,
    logoUrl: p.logoUrl ?? null,
    website: p.website ?? null,
    tags: ((p.tags as string) ?? "").split("|").filter(Boolean),
    presentationVideoUrl: p.presentationVideoUrl ?? null,
    contacts: [],
    comments: [],
    createdAt: p.createdAt ?? nowIso(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvent(m: any, counts?: { rsvp?: number; guests?: number }): unknown {
  const p = toPlain(m);
  const startsAt = p.startsAt as string | undefined;
  const status: "upcoming" | "past" =
    startsAt && new Date(startsAt).getTime() >= Date.now() ? "upcoming" : "past";
  return {
    id: asId(p[idKey] ?? p["id"]),
    title: p.title ?? "",
    description: p.description ?? null,
    startsAt: startsAt ?? nowIso(),
    endsAt: p.endsAt ?? null,
    venue: p.venue ?? "",
    city: p.city ?? null,
    status,
    rsvpCount: counts?.rsvp ?? 0,
    guestCount: counts?.guests ?? 0,
    videoUrl: p.videoUrl ?? null,
    vendors: [],
    comments: [],
    createdAt: p.createdAt ?? nowIso(),
  };
}

// ---------------- queries ----------------------------------------------------

export const SOCIAL_QUERY_FIELDS = new Set([
  "listFeed",
  "getPost",
  "listEvents",
  "getEvent",
  "listVendors",
  "getVendor",
  "listMembers",
  "getMember",
  "getRsvpByToken",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dispatchSocialQuery(field: string, args: any, ctx: Ctx): Promise<any> {
  const { g, identity } = ctx;
  const me = identity?.sub ?? null;

  if (!g) throw new Error("dispatchSocialQuery requires an active Gremlin traversal source");

  switch (field) {
    case "listFeed": {
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
      const rows = await g
        .V()
        .hasLabel("Post")
        .order()
        .by("createdAt", order.desc)
        .limit(limit)
        .project("post", "author", "likes", "comments", "likedByMe")
        .by(__.elementMap())
        .by(__.in_("POSTED").hasLabel("Member").elementMap().fold())
        .by(__.in_("LIKED").count())
        .by(__.in_("ON").hasLabel("Comment").count())
        .by(
          me
            ? __.in_("LIKED").has("Member", "id", me).count()
            : __.constant(0),
        )
        .toList();

      const items = rows.map((r: any) => {
        const row = toPlain(r);
        const post = toPlain(row.post);
        const author = Array.isArray(row.author) && row.author[0] ? toPlain(row.author[0]) : {};
        return {
          id: asId(post[idKey] ?? post["id"]),
          kind: post.kind ?? "member_post",
          authorId: asId(author[idKey] ?? author["id"]),
          authorName: author.name ?? null,
          authorAvatarUrl: author.avatarUrl ?? null,
          body: post.body ?? "",
          createdAt: post.createdAt ?? nowIso(),
          commentCount: Number(row.comments ?? 0),
          likeCount: Number(row.likes ?? 0),
          likedByMe: Number(row.likedByMe ?? 0) > 0,
          linkedVendorId: post.linkedVendorId ?? null,
          linkedEventId: post.linkedEventId ?? null,
        };
      });
      return { items, nextCursor: null };
    }

    case "getPost": {
      const row = await g
        .V(args.id)
        .hasLabel("Post")
        .project("post", "author", "likes", "comments")
        .by(__.elementMap())
        .by(__.in_("POSTED").hasLabel("Member").elementMap().fold())
        .by(__.in_("LIKED").count())
        .by(
          __.in_("ON")
            .hasLabel("Comment")
            .order()
            .by("createdAt", order.asc)
            .project("comment", "author")
            .by(__.elementMap())
            .by(__.in_("COMMENTED").hasLabel("Member").elementMap().fold())
            .fold(),
        )
        .next();
      if (!row?.value) return null;
      const r = toPlain(row.value);
      const post = toPlain(r.post);
      const author = Array.isArray(r.author) && r.author[0] ? toPlain(r.author[0]) : {};
      const comments = ((r.comments as unknown[]) ?? []).map((c) => {
        const cr = toPlain(c);
        const cm = toPlain(cr.comment);
        const ca = Array.isArray(cr.author) && cr.author[0] ? toPlain(cr.author[0]) : {};
        return {
          id: asId(cm[idKey] ?? cm["id"]),
          authorId: asId(ca[idKey] ?? ca["id"]),
          authorName: ca.name ?? "Member",
          authorAvatarUrl: ca.avatarUrl ?? null,
          body: cm.body ?? "",
          createdAt: cm.createdAt ?? nowIso(),
        };
      });
      return {
        id: asId(post[idKey] ?? post["id"]),
        kind: post.kind ?? "member_post",
        authorId: asId(author[idKey] ?? author["id"]),
        authorName: author.name ?? null,
        authorAvatarUrl: author.avatarUrl ?? null,
        body: post.body ?? "",
        createdAt: post.createdAt ?? nowIso(),
        commentCount: comments.length,
        likeCount: Number(r.likes ?? 0),
        likedByMe: false,
        linkedVendorId: post.linkedVendorId ?? null,
        linkedEventId: post.linkedEventId ?? null,
        comments,
      };
    }

    case "listEvents": {
      const rows = await g
        .V()
        .hasLabel("Event")
        .order()
        .by("startsAt", order.asc)
        .project("evt", "rsvps", "guests", "vendors")
        .by(__.elementMap())
        .by(__.in_("FOR").hasLabel("Rsvp").has("status", "yes").count())
        .by(
          __.in_("FOR")
            .hasLabel("Rsvp")
            .has("status", "yes")
            .values("guests")
            .sum(),
        )
        .by(
          __.out("FEATURES")
            .hasLabel("Vendor")
            .project("id", "name", "tagline", "logoUrl")
            .by(__.id())
            .by(__.coalesce(__.values("name"), __.constant("")))
            .by(__.coalesce(__.values("tagline"), __.constant("")))
            .by(__.coalesce(__.values("logoUrl"), __.constant("")))
            .fold(),
        )
        .toList();

      const events = rows
        .map((r: any) => {
          const row = toPlain(r);
          const e = mapEvent(row.evt, {
            rsvp: Number(row.rsvps ?? 0),
            guests: Number(row.guests ?? 0),
          }) as Record<string, unknown>;
          e.vendors = ((row.vendors as unknown[]) ?? []).map((v) => {
            const vp = toPlain(v);
            return {
              id: asId(vp.id),
              name: vp.name,
              tagline: vp.tagline || null,
              logoUrl: vp.logoUrl || null,
            };
          });
          return e;
        })
        .filter((e: any) =>
          args.status ? e.status === args.status : true,
        );
      return events;
    }

    case "getEvent": {
      const row = await g
        .V(args.id)
        .hasLabel("Event")
        .project("evt", "rsvps", "guests", "vendors")
        .by(__.elementMap())
        .by(__.in_("FOR").hasLabel("Rsvp").has("status", "yes").count())
        .by(
          __.in_("FOR")
            .hasLabel("Rsvp")
            .has("status", "yes")
            .values("guests")
            .sum(),
        )
        .by(
          __.out("FEATURES")
            .hasLabel("Vendor")
            .project("id", "name", "tagline", "logoUrl")
            .by(__.id())
            .by(__.coalesce(__.values("name"), __.constant("")))
            .by(__.coalesce(__.values("tagline"), __.constant("")))
            .by(__.coalesce(__.values("logoUrl"), __.constant("")))
            .fold(),
        )
        .next();
      if (!row?.value) return null;
      const r = toPlain(row.value);
      const evt = mapEvent(r.evt, {
        rsvp: Number(r.rsvps ?? 0),
        guests: Number(r.guests ?? 0),
      }) as Record<string, unknown>;
      evt.vendors = ((r.vendors as unknown[]) ?? []).map((v) => {
        const vp = toPlain(v);
        return {
          id: asId(vp.id),
          name: vp.name,
          tagline: vp.tagline || null,
          logoUrl: vp.logoUrl || null,
        };
      });
      return evt;
    }

    case "listVendors": {
      const rows = await g
        .V()
        .hasLabel("Vendor")
        .order()
        .by("name", order.asc)
        .elementMap()
        .toList();
      return rows.map(mapVendor);
    }

    case "getVendor": {
      const row = await g
        .V(args.id)
        .hasLabel("Vendor")
        .project("vendor", "contacts")
        .by(__.elementMap())
        .by(
          __.out("HAS_CONTACT")
            .hasLabel("VendorContact")
            .elementMap()
            .fold(),
        )
        .next();
      if (!row?.value) return null;
      const r = toPlain(row.value);
      const vendor = mapVendor(r.vendor) as Record<string, unknown>;
      vendor.contacts = ((r.contacts as unknown[]) ?? []).map((c) => {
        const cp = toPlain(c);
        return {
          id: asId(cp[idKey] ?? cp["id"]),
          name: cp.name,
          role: cp.role,
          email: cp.email,
          phone: cp.phone ?? null,
        };
      });
      return vendor;
    }

    case "listMembers": {
      const search = (args.search ?? "").trim();
      let q = g.V().hasLabel("Member");
      if (search) {
        q = q.or(
          __.has("name", TextP.containing(search)),
          __.has("title", TextP.containing(search)),
          __.has("company", TextP.containing(search)),
        );
      }
      const rows = await q
        .order()
        .by("name", order.asc)
        .project("member", "connection")
        .by(__.elementMap())
        .by(
          me
            ? __.bothE("CONNECTED_WITH")
                .where(__.otherV().has("id", me))
                .values("status")
                .limit(1)
                .fold()
            : __.constant([]),
        )
        .toList();
      return rows.map((r: any) => {
        const row = toPlain(r);
        const base = mapMember(row.member) as Record<string, unknown>;
        const status = Array.isArray(row.connection) ? row.connection[0] : null;
        base.connectionStatus = status ?? "none";
        return base;
      });
    }

    case "getMember": {
      const row = await g
        .V(args.id)
        .hasLabel("Member")
        .project("member", "connection")
        .by(__.elementMap())
        .by(
          me
            ? __.bothE("CONNECTED_WITH")
                .where(__.otherV().has("id", me))
                .values("status")
                .limit(1)
                .fold()
            : __.constant([]),
        )
        .next();
      if (!row?.value) return null;
      const r = toPlain(row.value);
      const member = mapMember(r.member) as Record<string, unknown>;
      const status = Array.isArray(r.connection) ? r.connection[0] : null;
      member.connectionStatus = status ?? "none";
      // Reveal contact info only once connected (or for the member themselves)
      if (status === "connected" || args.id === me) {
        const src = toPlain(r.member);
        member.email = src.email ?? null;
        member.phone = src.phone ?? null;
      }
      return member;
    }

    case "getRsvpByToken": {
      const payload = await verifyRsvpToken(args.token);
      if (!payload) return null;
      const { eventId, memberId } = payload;

      const evtRow = await g.V(eventId).hasLabel("Event").elementMap().next();
      const memRow = await g.V(memberId).hasLabel("Member").elementMap().next();
      if (!evtRow?.value || !memRow?.value) return null;

      const rsvpRow = await g
        .V(memberId)
        .out("RSVPD")
        .hasLabel("Rsvp")
        .where(__.out("FOR").hasId(eventId))
        .elementMap()
        .fold()
        .next();
      const existing =
        Array.isArray(rsvpRow?.value) && rsvpRow.value[0]
          ? toPlain(rsvpRow.value[0])
          : null;

      return {
        event: mapEvent(evtRow.value),
        member: mapMember(memRow.value),
        rsvp: existing
          ? {
              id: asId(existing[idKey] ?? existing["id"]),
              eventId,
              memberId,
              status: existing.status ?? "pending",
              guests: Number(existing.guests ?? 0),
            }
          : {
              id: "",
              eventId,
              memberId,
              status: "pending",
              guests: 0,
            },
      };
    }

    default:
      return undefined;
  }
}

// ---------------- mutations --------------------------------------------------

export const SOCIAL_MUTATION_FIELDS = new Set([
  "createPost",
  "createComment",
  "toggleLike",
  "submitFeedback",
  "requestConnection",
  "respondToConnection",
  "updateMemberProfile",
  "createEvent",
  "updateEvent",
  "requestEventVideoUpload",
  "attachEventVideo",
  "sendEventRsvpEmails",
  "createVendor",
  "updateVendor",
  "submitRsvp",
  "inviteMember",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dispatchSocialMutation(field: string, args: any, ctx: Ctx): Promise<any> {
  const { g, identity } = ctx;
  const me = identity?.sub ?? "unknown";
  const username = identity?.username ?? "Member";

  if (!g) throw new Error("dispatchSocialMutation requires an active Gremlin traversal source");

  switch (field) {
    case "createPost": {
      const id = `post-${crypto.randomUUID()}`;
      await g
        .addV("Post")
        .property(T.id, id)
        .property("kind", "member_post")
        .property("body", args.body)
        .property("createdAt", nowIso())
        .as("p")
        .V(me)
        .addE("POSTED")
        .to("p")
        .iterate();
      return {
        id,
        kind: "member_post",
        authorId: me,
        authorName: username,
        body: args.body,
        createdAt: nowIso(),
        commentCount: 0,
        likeCount: 0,
        likedByMe: false,
      };
    }

    case "createComment": {
      const { input } = args;
      const id = `cm-${crypto.randomUUID()}`;
      await g
        .addV("Comment")
        .property(T.id, id)
        .property("body", input.body)
        .property("createdAt", nowIso())
        .as("c")
        .V(me)
        .addE("COMMENTED")
        .to("c")
        .V(input.targetId)
        .addE("ON")
        .from_("c")
        .iterate();
      return {
        id,
        authorId: me,
        authorName: username,
        body: input.body,
        createdAt: nowIso(),
      };
    }

    case "toggleLike": {
      const existing = await g
        .V(me)
        .outE("LIKED")
        .where(__.inV().hasId(args.postId))
        .fold()
        .next();
      const hasLike = Array.isArray(existing?.value) && existing.value.length > 0;
      if (hasLike) {
        await g.V(me).outE("LIKED").where(__.inV().hasId(args.postId)).drop().iterate();
      } else {
        await g.V(me).addE("LIKED").to(__.V(args.postId)).iterate();
      }
      const count = await g.V(args.postId).in_("LIKED").count().next();
      return {
        id: args.postId,
        likeCount: Number(count.value ?? 0),
        likedByMe: !hasLike,
      };
    }

    case "submitFeedback": {
      const { input } = args;
      const id = `fb-${crypto.randomUUID()}`;
      await g
        .addV("Feedback")
        .property(T.id, id)
        .property("rating", input.rating)
        .property("comment", input.comment ?? "")
        .property("createdAt", nowIso())
        .as("f")
        .V(me)
        .addE("LEFT_FEEDBACK")
        .to("f")
        .V(input.eventId)
        .addE("ABOUT")
        .from_("f")
        .iterate();
      return { id };
    }

    case "requestConnection": {
      const target = args.targetMemberId;
      if (target === me) throw new Error("Cannot connect to yourself");

      // Existing edge either direction?
      const existing = await g
        .V(me)
        .bothE("CONNECTED_WITH")
        .where(__.otherV().hasId(target))
        .elementMap()
        .fold()
        .next();
      if (Array.isArray(existing?.value) && existing.value.length > 0) {
        return { targetMemberId: target, connectionStatus: "pending_outgoing" };
      }

      await g
        .V(me)
        .addE("CONNECTED_WITH")
        .to(__.V(target))
        .property("status", "pending")
        .property("requestedAt", nowIso())
        .iterate();
      return { targetMemberId: target, connectionStatus: "pending_outgoing" };
    }

    case "respondToConnection": {
      const requester = args.requesterId;
      if (args.accept) {
        await g
          .V(requester)
          .outE("CONNECTED_WITH")
          .where(__.inV().hasId(me))
          .property("status", "accepted")
          .property("acceptedAt", nowIso())
          .iterate();
        // mirror edge so bidirectional queries work
        await g
          .V(me)
          .addE("CONNECTED_WITH")
          .to(__.V(requester))
          .property("status", "accepted")
          .property("acceptedAt", nowIso())
          .iterate();
        return { targetMemberId: requester, connectionStatus: "connected" };
      }
      await g
        .V(requester)
        .outE("CONNECTED_WITH")
        .where(__.inV().hasId(me))
        .drop()
        .iterate();
      return { targetMemberId: requester, connectionStatus: "none" };
    }

    case "updateMemberProfile": {
      const { input } = args;
      let q = g.V(me).hasLabel("Member");
      for (const [k, v] of Object.entries(input)) {
        if (v === undefined || v === null) continue;
        q = q.property(k, v as string);
      }
      await q.iterate();
      return { id: me, ...input };
    }

    case "createEvent": {
      const { input } = args;
      const id = `evt-${crypto.randomUUID()}`;
      await g
        .addV("Event")
        .property(T.id, id)
        .property("title", input.title)
        .property("description", input.description)
        .property("startsAt", input.startsAt)
        .property("endsAt", input.endsAt ?? "")
        .property("venue", input.venue)
        .property("city", input.city ?? "")
        .property("createdAt", nowIso())
        .iterate();
      for (const vid of input.vendorIds ?? []) {
        await g.V(id).addE("FEATURES").to(__.V(vid)).iterate();
      }
      return {
        id,
        title: input.title,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        venue: input.venue,
        city: input.city,
        status: new Date(input.startsAt).getTime() >= Date.now() ? "upcoming" : "past",
        rsvpCount: 0,
        guestCount: 0,
        vendors: [],
        createdAt: nowIso(),
      };
    }

    case "updateEvent": {
      const { input } = args;
      let q = g.V(input.id).hasLabel("Event");
      for (const [k, v] of Object.entries(input)) {
        if (k === "id" || k === "vendorIds" || v === undefined || v === null) continue;
        q = q.property(k, v as string);
      }
      await q.iterate();
      if (input.vendorIds) {
        await g.V(input.id).outE("FEATURES").drop().iterate();
        for (const vid of input.vendorIds) {
          await g.V(input.id).addE("FEATURES").to(__.V(vid)).iterate();
        }
      }
      return { id: input.id, title: input.title ?? "" };
    }

    case "requestEventVideoUpload": {
      const bucket = process.env.MEDIA_BUCKET;
      if (!bucket) throw new Error("MEDIA_BUCKET env not set");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { S3Client, PutObjectCommand } = (await import(
        /* webpackIgnore: true */ "@aws-sdk/client-s3" as string
      )) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { getSignedUrl } = (await import(
        /* webpackIgnore: true */ "@aws-sdk/s3-request-presigner" as string
      )) as any;
      const s3 = new S3Client({ region: process.env.AWS_REGION });
      const key = `events/${args.eventId}/video.mp4`;
      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: "video/mp4",
        }),
        { expiresIn: 900 },
      );
      return { uploadUrl, key };
    }

    case "attachEventVideo": {
      await g
        .V(args.eventId)
        .hasLabel("Event")
        .property("videoKey", args.key)
        .iterate();
      // Emit system feed entry
      const postId = `post-${crypto.randomUUID()}`;
      await g
        .addV("Post")
        .property(T.id, postId)
        .property("kind", "system_new_event_video")
        .property("body", "A new event recording is available.")
        .property("linkedEventId", args.eventId)
        .property("createdAt", nowIso())
        .iterate();
      return { id: args.eventId, videoUrl: null };
    }

    case "sendEventRsvpEmails": {
      const queueUrl = process.env.RSVP_QUEUE_URL;
      if (!queueUrl) throw new Error("RSVP_QUEUE_URL env not set");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { SQSClient, SendMessageCommand } = (await import(
        /* webpackIgnore: true */ "@aws-sdk/client-sqs" as string
      )) as any;
      const sqs = new SQSClient({ region: process.env.AWS_REGION });

      const members = await g.V().hasLabel("Member").id().toList();
      let sent = 0;
      let skipped = 0;
      for (const memberId of members) {
        if (!memberId) {
          skipped++;
          continue;
        }
        const token = await signRsvpToken({
          eventId: args.eventId,
          memberId: String(memberId),
          exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days
        });
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({
              eventId: args.eventId,
              memberId: String(memberId),
              token,
            }),
          }),
        );
        sent++;
      }
      return { sent, skipped };
    }

    case "createVendor": {
      const { input } = args;
      const id = `vnd-${crypto.randomUUID()}`;
      await g
        .addV("Vendor")
        .property(T.id, id)
        .property("name", input.name)
        .property("tagline", input.tagline ?? "")
        .property("description", input.description ?? "")
        .property("logoUrl", input.logoUrl ?? "")
        .property("website", input.website ?? "")
        .property("tags", (input.tags ?? []).join("|"))
        .property("createdAt", nowIso())
        .iterate();
      const contacts: unknown[] = [];
      for (const c of input.contacts ?? []) {
        const cid = `vc-${crypto.randomUUID()}`;
        await g
          .addV("VendorContact")
          .property(T.id, cid)
          .property("name", c.name)
          .property("role", c.role)
          .property("email", c.email)
          .property("phone", c.phone ?? "")
          .as("vc")
          .V(id)
          .addE("HAS_CONTACT")
          .to("vc")
          .iterate();
        contacts.push({ id: cid, ...c });
      }
      return {
        id,
        name: input.name,
        tagline: input.tagline,
        description: input.description,
        logoUrl: input.logoUrl,
        website: input.website,
        tags: input.tags,
        contacts,
        createdAt: nowIso(),
      };
    }

    case "updateVendor": {
      const { input } = args;
      let q = g.V(input.id).hasLabel("Vendor");
      for (const [k, v] of Object.entries(input)) {
        if (k === "id" || k === "contacts" || v === undefined || v === null) continue;
        if (k === "tags") q = q.property("tags", (v as string[]).join("|"));
        else q = q.property(k, v as string);
      }
      await q.iterate();
      return { id: input.id, name: input.name ?? "" };
    }

    case "submitRsvp": {
      const payload = await verifyRsvpToken(args.token);
      if (!payload) throw new Error("Invalid or expired RSVP token");
      const { eventId, memberId } = payload;

      // Upsert Rsvp vertex
      const existing = await g
        .V(memberId)
        .out("RSVPD")
        .hasLabel("Rsvp")
        .where(__.out("FOR").hasId(eventId))
        .id()
        .fold()
        .next();
      const existingId =
        Array.isArray(existing?.value) && existing.value[0]
          ? String(existing.value[0])
          : null;

      const statusStr = args.attending ? "yes" : "no";
      if (existingId) {
        await g
          .V(existingId)
          .property("status", statusStr)
          .property("guests", args.guests)
          .property("updatedAt", nowIso())
          .iterate();
        return {
          id: existingId,
          eventId,
          memberId,
          status: statusStr,
          guests: args.guests,
        };
      }
      const newId = `rsvp-${crypto.randomUUID()}`;
      await g
        .addV("Rsvp")
        .property(T.id, newId)
        .property("status", statusStr)
        .property("guests", args.guests)
        .property("createdAt", nowIso())
        .as("r")
        .V(memberId)
        .addE("RSVPD")
        .to("r")
        .V(eventId)
        .addE("FOR")
        .from_("r")
        .iterate();
      return {
        id: newId,
        eventId,
        memberId,
        status: statusStr,
        guests: args.guests,
      };
    }

    case "inviteMember": {
      const caller = identity;
      const groups = caller?.groups ?? [];
      if (!groups.includes("Admin") && !groups.includes("MembershipAdmin")) {
        throw new Error("Not authorized to invite members");
      }
      const name = String(args?.name ?? "").trim();
      const email = String(args?.email ?? "").trim().toLowerCase();
      if (!name) throw new Error("name is required");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("A valid email address is required");
      }
      const userPoolId = process.env.USER_POOL_ID;
      if (!userPoolId) throw new Error("USER_POOL_ID is not configured");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(
        /* webpackIgnore: true */ "@aws-sdk/client-cognito-identity-provider" as string
      );
      const client = new mod.CognitoIdentityProviderClient({
        region: process.env.AWS_REGION,
      });

      // Use the email as the username so the invitation email template's
      // {username} placeholder is meaningful and the user signs in with
      // their address.
      const username = email;

      try {
        await client.send(
          new mod.AdminCreateUserCommand({
            UserPoolId: userPoolId,
            Username: username,
            DesiredDeliveryMediums: ["EMAIL"],
            ForceAliasCreation: false,
            UserAttributes: [
              { Name: "email", Value: email },
              { Name: "email_verified", Value: "true" },
              { Name: "name", Value: name },
            ],
          }),
        );
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = err as any;
        if (e?.name === "UsernameExistsException") {
          // Resend the invitation for the existing (unconfirmed) user.
          await client.send(
            new mod.AdminCreateUserCommand({
              UserPoolId: userPoolId,
              Username: username,
              MessageAction: "RESEND",
              DesiredDeliveryMediums: ["EMAIL"],
            }),
          );
        } else {
          throw err;
        }
      }

      // Add the user to the Member group so their token carries the role.
      try {
        await client.send(
          new mod.AdminAddUserToGroupCommand({
            UserPoolId: userPoolId,
            Username: username,
            GroupName: "Member",
          }),
        );
      } catch (err) {
        // Idempotent — ignore "already in group" errors.
        console.warn("AdminAddUserToGroup failed (continuing)", err);
      }

      return { email, username, status: "invited" };
    }

    default:
      return undefined;
  }
}

// Silence unused-import warnings for exports consumed by the Lambdas only.
void P;
