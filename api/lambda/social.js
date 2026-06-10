"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchSocialMutation = exports.SOCIAL_MUTATION_FIELDS = exports.dispatchSocialQuery = exports.SOCIAL_QUERY_FIELDS = exports.verifyRsvpToken = exports.signRsvpToken = void 0;
const crypto = require("crypto");
const gremlin = require("gremlin");
const { P, TextP, order, t: T } = gremlin.process;
const __ = gremlin.process.statics;
// T.id and similar enum values aren't valid index keys in strict TS;
// use the string forms used by Neptune's elementMap output.
const idKey = T.id;
const nowIso = () => new Date().toISOString();
// ---------- RSVP token signing -----------------------------------------------
let _cachedSecret = null;
let _secretPromise = null;
async function resolveRsvpSecret() {
    if (_cachedSecret)
        return _cachedSecret;
    const inline = process.env.RSVP_SIGNING_SECRET;
    if (inline) {
        _cachedSecret = inline;
        return inline;
    }
    const arn = process.env.RSVP_SIGNING_SECRET_ARN;
    if (!arn) {
        throw new Error("Neither RSVP_SIGNING_SECRET nor RSVP_SIGNING_SECRET_ARN is set");
    }
    if (!_secretPromise) {
        _secretPromise = (async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mod = await Promise.resolve(`${
            /* webpackIgnore: true */ "@aws-sdk/client-secrets-manager"}`).then(s => require(s));
            const client = new mod.SecretsManagerClient({
                region: process.env.AWS_REGION,
            });
            const out = await client.send(new mod.GetSecretValueCommand({ SecretId: arn }));
            const value = out.SecretString ?? "";
            if (!value)
                throw new Error("RSVP signing secret is empty");
            _cachedSecret = value;
            return value;
        })();
    }
    return _secretPromise;
}
function base64url(buf) {
    return buf
        .toString("base64")
        .replace(/=+$/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}
async function signRsvpToken(payload) {
    const secret = await resolveRsvpSecret();
    const body = base64url(Buffer.from(JSON.stringify(payload)));
    const sig = base64url(crypto.createHmac("sha256", secret).update(body).digest());
    return `${body}.${sig}`;
}
exports.signRsvpToken = signRsvpToken;
async function verifyRsvpToken(token) {
    const [body, sig] = (token ?? "").split(".");
    if (!body || !sig)
        return null;
    const secret = await resolveRsvpSecret();
    const expected = base64url(crypto.createHmac("sha256", secret).update(body).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
        return null;
    try {
        const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/") +
            "=".repeat((4 - (body.length % 4)) % 4), "base64").toString("utf-8"));
        if (payload.exp && Date.now() / 1000 > payload.exp)
            return null;
        return payload;
    }
    catch {
        return null;
    }
}
exports.verifyRsvpToken = verifyRsvpToken;
// ---------- shared element map → domain object helpers -----------------------
// Neptune elementMap keys come back as JS Maps under gremlin-v2; normalize.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlain(m) {
    if (!m)
        return {};
    if (m instanceof Map) {
        const obj = {};
        for (const [k, v] of m.entries()) {
            const key = typeof k === "symbol" ? String(k) : String(k);
            obj[key] = v instanceof Map ? toPlain(v) : v;
        }
        return obj;
    }
    return m;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asId(v) {
    if (v === undefined || v === null)
        return "";
    return String(v);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMember(m) {
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
function mapVendor(m) {
    const p = toPlain(m);
    return {
        id: asId(p[idKey] ?? p["id"]),
        name: p.name ?? "",
        tagline: p.tagline ?? null,
        description: p.description ?? null,
        logoUrl: p.logoUrl ?? null,
        website: p.website ?? null,
        tags: (p.tags ?? "").split("|").filter(Boolean),
        presentationVideoUrl: p.presentationVideoUrl ?? null,
        contacts: [],
        comments: [],
        createdAt: p.createdAt ?? nowIso(),
    };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvent(m, counts) {
    const p = toPlain(m);
    const startsAt = p.startsAt;
    const status = startsAt && new Date(startsAt).getTime() >= Date.now() ? "upcoming" : "past";
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
exports.SOCIAL_QUERY_FIELDS = new Set([
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
async function dispatchSocialQuery(field, args, ctx) {
    const { g, identity } = ctx;
    const me = identity?.sub ?? null;
    if (!g)
        throw new Error("dispatchSocialQuery requires an active Gremlin traversal source");
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
                .by(me
                ? __.in_("LIKED").has("Member", "id", me).count()
                : __.constant(0))
                .toList();
            const items = rows.map((r) => {
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
                .by(__.in_("ON")
                .hasLabel("Comment")
                .order()
                .by("createdAt", order.asc)
                .project("comment", "author")
                .by(__.elementMap())
                .by(__.in_("COMMENTED").hasLabel("Member").elementMap().fold())
                .fold())
                .next();
            if (!row?.value)
                return null;
            const r = toPlain(row.value);
            const post = toPlain(r.post);
            const author = Array.isArray(r.author) && r.author[0] ? toPlain(r.author[0]) : {};
            const comments = (r.comments ?? []).map((c) => {
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
                .by(__.in_("FOR")
                .hasLabel("Rsvp")
                .has("status", "yes")
                .values("guests")
                .sum())
                .by(__.out("FEATURES")
                .hasLabel("Vendor")
                .project("id", "name", "tagline", "logoUrl")
                .by(__.id())
                .by(__.coalesce(__.values("name"), __.constant("")))
                .by(__.coalesce(__.values("tagline"), __.constant("")))
                .by(__.coalesce(__.values("logoUrl"), __.constant("")))
                .fold())
                .toList();
            const events = rows
                .map((r) => {
                const row = toPlain(r);
                const e = mapEvent(row.evt, {
                    rsvp: Number(row.rsvps ?? 0),
                    guests: Number(row.guests ?? 0),
                });
                e.vendors = (row.vendors ?? []).map((v) => {
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
                .filter((e) => args.status ? e.status === args.status : true);
            return events;
        }
        case "getEvent": {
            const row = await g
                .V(args.id)
                .hasLabel("Event")
                .project("evt", "rsvps", "guests", "vendors")
                .by(__.elementMap())
                .by(__.in_("FOR").hasLabel("Rsvp").has("status", "yes").count())
                .by(__.in_("FOR")
                .hasLabel("Rsvp")
                .has("status", "yes")
                .values("guests")
                .sum())
                .by(__.out("FEATURES")
                .hasLabel("Vendor")
                .project("id", "name", "tagline", "logoUrl")
                .by(__.id())
                .by(__.coalesce(__.values("name"), __.constant("")))
                .by(__.coalesce(__.values("tagline"), __.constant("")))
                .by(__.coalesce(__.values("logoUrl"), __.constant("")))
                .fold())
                .next();
            if (!row?.value)
                return null;
            const r = toPlain(row.value);
            const evt = mapEvent(r.evt, {
                rsvp: Number(r.rsvps ?? 0),
                guests: Number(r.guests ?? 0),
            });
            evt.vendors = (r.vendors ?? []).map((v) => {
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
                .by(__.out("HAS_CONTACT")
                .hasLabel("VendorContact")
                .elementMap()
                .fold())
                .next();
            if (!row?.value)
                return null;
            const r = toPlain(row.value);
            const vendor = mapVendor(r.vendor);
            vendor.contacts = (r.contacts ?? []).map((c) => {
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
                q = q.or(__.has("name", TextP.containing(search)), __.has("title", TextP.containing(search)), __.has("company", TextP.containing(search)));
            }
            const rows = await q
                .order()
                .by("name", order.asc)
                .project("member", "connection")
                .by(__.elementMap())
                .by(me
                ? __.bothE("CONNECTED_WITH")
                    .where(__.otherV().has("id", me))
                    .values("status")
                    .limit(1)
                    .fold()
                : __.constant([]))
                .toList();
            return rows.map((r) => {
                const row = toPlain(r);
                const base = mapMember(row.member);
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
                .by(me
                ? __.bothE("CONNECTED_WITH")
                    .where(__.otherV().has("id", me))
                    .values("status")
                    .limit(1)
                    .fold()
                : __.constant([]))
                .next();
            if (!row?.value)
                return null;
            const r = toPlain(row.value);
            const member = mapMember(r.member);
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
            if (!payload)
                return null;
            const { eventId, memberId } = payload;
            const evtRow = await g.V(eventId).hasLabel("Event").elementMap().next();
            const memRow = await g.V(memberId).hasLabel("Member").elementMap().next();
            if (!evtRow?.value || !memRow?.value)
                return null;
            const rsvpRow = await g
                .V(memberId)
                .out("RSVPD")
                .hasLabel("Rsvp")
                .where(__.out("FOR").hasId(eventId))
                .elementMap()
                .fold()
                .next();
            const existing = Array.isArray(rsvpRow?.value) && rsvpRow.value[0]
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
exports.dispatchSocialQuery = dispatchSocialQuery;
// ---------------- mutations --------------------------------------------------
exports.SOCIAL_MUTATION_FIELDS = new Set([
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
async function dispatchSocialMutation(field, args, ctx) {
    const { g, identity } = ctx;
    const me = identity?.sub ?? "unknown";
    const username = identity?.username ?? "Member";
    if (!g)
        throw new Error("dispatchSocialMutation requires an active Gremlin traversal source");
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
            }
            else {
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
            if (target === me)
                throw new Error("Cannot connect to yourself");
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
                if (v === undefined || v === null)
                    continue;
                q = q.property(k, v);
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
                if (k === "id" || k === "vendorIds" || v === undefined || v === null)
                    continue;
                q = q.property(k, v);
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
            if (!bucket)
                throw new Error("MEDIA_BUCKET env not set");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { S3Client, PutObjectCommand } = (await Promise.resolve(`${
            /* webpackIgnore: true */ "@aws-sdk/client-s3"}`).then(s => require(s)));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { getSignedUrl } = (await Promise.resolve(`${
            /* webpackIgnore: true */ "@aws-sdk/s3-request-presigner"}`).then(s => require(s)));
            const s3 = new S3Client({ region: process.env.AWS_REGION });
            const key = `events/${args.eventId}/video.mp4`;
            const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                ContentType: "video/mp4",
            }), { expiresIn: 900 });
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
            if (!queueUrl)
                throw new Error("RSVP_QUEUE_URL env not set");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { SQSClient, SendMessageCommand } = (await Promise.resolve(`${
            /* webpackIgnore: true */ "@aws-sdk/client-sqs"}`).then(s => require(s)));
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
                await sqs.send(new SendMessageCommand({
                    QueueUrl: queueUrl,
                    MessageBody: JSON.stringify({
                        eventId: args.eventId,
                        memberId: String(memberId),
                        token,
                    }),
                }));
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
            const contacts = [];
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
                if (k === "id" || k === "contacts" || v === undefined || v === null)
                    continue;
                if (k === "tags")
                    q = q.property("tags", v.join("|"));
                else
                    q = q.property(k, v);
            }
            await q.iterate();
            return { id: input.id, name: input.name ?? "" };
        }
        case "submitRsvp": {
            const payload = await verifyRsvpToken(args.token);
            if (!payload)
                throw new Error("Invalid or expired RSVP token");
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
            const existingId = Array.isArray(existing?.value) && existing.value[0]
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
            if (!name)
                throw new Error("name is required");
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw new Error("A valid email address is required");
            }
            const userPoolId = process.env.USER_POOL_ID;
            if (!userPoolId)
                throw new Error("USER_POOL_ID is not configured");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mod = await Promise.resolve(`${
            /* webpackIgnore: true */ "@aws-sdk/client-cognito-identity-provider"}`).then(s => require(s));
            const client = new mod.CognitoIdentityProviderClient({
                region: process.env.AWS_REGION,
            });
            // Use the email as the username so the invitation email template's
            // {username} placeholder is meaningful and the user signs in with
            // their address.
            const username = email;
            try {
                await client.send(new mod.AdminCreateUserCommand({
                    UserPoolId: userPoolId,
                    Username: username,
                    DesiredDeliveryMediums: ["EMAIL"],
                    ForceAliasCreation: false,
                    UserAttributes: [
                        { Name: "email", Value: email },
                        { Name: "email_verified", Value: "true" },
                        { Name: "name", Value: name },
                    ],
                }));
            }
            catch (err) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const e = err;
                if (e?.name === "UsernameExistsException") {
                    // Resend the invitation for the existing (unconfirmed) user.
                    await client.send(new mod.AdminCreateUserCommand({
                        UserPoolId: userPoolId,
                        Username: username,
                        MessageAction: "RESEND",
                        DesiredDeliveryMediums: ["EMAIL"],
                    }));
                }
                else {
                    throw err;
                }
            }
            // Add the user to the Member group so their token carries the role.
            try {
                await client.send(new mod.AdminAddUserToGroupCommand({
                    UserPoolId: userPoolId,
                    Username: username,
                    GroupName: "Member",
                }));
            }
            catch (err) {
                // Idempotent — ignore "already in group" errors.
                console.warn("AdminAddUserToGroup failed (continuing)", err);
            }
            return { email, username, status: "invited" };
        }
        default:
            return undefined;
    }
}
exports.dispatchSocialMutation = dispatchSocialMutation;
// Silence unused-import warnings for exports consumed by the Lambdas only.
void P;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic29jaWFsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsic29jaWFsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSw2RUFBNkU7QUFDN0UsRUFBRTtBQUNGLDJFQUEyRTtBQUMzRSx3RUFBd0U7QUFDeEUsMERBQTBEO0FBQzFELEVBQUU7QUFDRiw4REFBOEQ7QUFDOUQsNkVBQTZFO0FBQzdFLG1CQUFtQjtBQUNuQixzQ0FBc0M7QUFDdEMsK0VBQStFO0FBQy9FLHFDQUFxQztBQUNyQywwREFBMEQ7QUFDMUQseUNBQXlDO0FBQ3pDLG9EQUFvRDtBQUNwRCxpRUFBaUU7QUFDakUsbUZBQW1GOzs7QUFFbkYsaUNBQWlDO0FBQ2pDLG1DQUFtQztBQUNuQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUM7QUFDbEQsTUFBTSxFQUFFLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUM7QUFTbkMscUVBQXFFO0FBQ3JFLDREQUE0RDtBQUM1RCxNQUFNLEtBQUssR0FBRyxDQUFDLENBQUMsRUFBdUIsQ0FBQztBQUV4QyxNQUFNLE1BQU0sR0FBRyxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDO0FBRTlDLGdGQUFnRjtBQUVoRixJQUFJLGFBQWEsR0FBa0IsSUFBSSxDQUFDO0FBQ3hDLElBQUksY0FBYyxHQUEyQixJQUFJLENBQUM7QUFFbEQsS0FBSyxVQUFVLGlCQUFpQjtJQUM5QixJQUFJLGFBQWE7UUFBRSxPQUFPLGFBQWEsQ0FBQztJQUN4QyxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDO0lBQy9DLElBQUksTUFBTSxFQUFFLENBQUM7UUFDWCxhQUFhLEdBQUcsTUFBTSxDQUFDO1FBQ3ZCLE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFDRCxNQUFN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QU8sR0FBRyxFQUFFLENBQUM7Z0JBQ2IsOERBQThEO2dCQUM5RCxNQUFNLENBQUMsR0FBRyxHQUFVLENBQUM7Z0JBQ3JCLElBQUksQ0FBQyxFQUFFLElBQUksS0FBSyx5QkFBeUIsRUFBRSxDQUFDO29CQUMxQyw2REFBNkQ7b0JBQzdELE1BQU0sTUFBTSxDQUFDLElBQUksQ0FDZixJQUFJLEdBQUcsQ0FBQyxzQkFBc0IsQ0FBQzt3QkFDN0IsVUFBVSxFQUFFLFVBQVU7d0JBQ3RCLFFBQVEsRUFBRSxRQUFRO3dCQUNsQixhQUFhLEVBQUUsUUFBUTt3QkFDdkIsc0JBQXNCLEVBQUUsQ0FBQyxPQUFPLENBQUM7cUJBQ2xDLENBQUMsQ0FDSCxDQUFDO2dCQUNKLENBQUM7cUJBQU0sQ0FBQztvQkFDTixNQUFNLEdBQUcsQ0FBQztnQkFDWixDQUFDO1lBQ0gsQ0FBQztZQUVELG9FQUFvRTtZQUNwRSxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxNQUFNLENBQUMsSUFBSSxDQUNmLElBQUksR0FBRyxDQUFDLDBCQUEwQixDQUFDO29CQUNqQyxVQUFVLEVBQUUsVUFBVTtvQkFDdEIsUUFBUSxFQUFFLFFBQVE7b0JBQ2xCLFNBQVMsRUFBRSxRQUFRO2lCQUNwQixDQUFDLENBQ0gsQ0FBQztZQUNKLENBQUM7WUFBQyxPQUFPLEdBQUcsRUFBRSxDQUFDO2dCQUNiLGlEQUFpRDtnQkFDakQsT0FBTyxDQUFDLElBQUksQ0FBQyx5Q0FBeUMsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUMvRCxDQUFDO1lBRUQsT0FBTyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxDQUFDO1FBQ2hELENBQUM7UUFFRDtZQUNFLE9BQU8sU0FBUyxDQUFDO0lBQ3JCLENBQUM7QUFDSCxDQUFDO0FBNWVELHdEQTRlQztBQUVELDJFQUEyRTtBQUMzRSxLQUFLLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIFNvY2lhbCAvIG1lbWJlci1uZXR3b3JraW5nIHJlc29sdmVycyDigJQgR3JlbWxpbiB0cmF2ZXJzYWxzIGFnYWluc3QgTmVwdHVuZS5cbi8vXG4vLyBJbnZva2VkIGZyb20gcXVlcnlHcmFwaC50cyArIG11dGF0aW9uR3JhcGgudHMgd2hlbiBgZXZlbnQuZmllbGRgIG1hdGNoZXNcbi8vIG9uZSBvZiB0aGUgbmV0d29ya2luZyBvcGVyYXRpb25zLiBUaGUgY2FsbGluZyBoYW5kbGVycyBwYXNzIGFuIGFjdGl2ZVxuLy8gdHJhdmVyc2FsIHNvdXJjZSBgZ2AgcGx1cyB0aGUgQXBwU3luYyBpZGVudGl0eSBjb250ZXh0LlxuLy9cbi8vIEdyYXBoIGRhdGEgbW9kZWwgKHNlZSBkb2NzL2ZlZWQubWQsIGRvY3MvbWVtYmVycy5tZCwgZXRjLik6XG4vLyAgIFZlcnRpY2VzOiBNZW1iZXIsIEV2ZW50LCBWZW5kb3IsIFZlbmRvckNvbnRhY3QsIFBvc3QsIENvbW1lbnQsIEZlZWRiYWNrLFxuLy8gICAgICAgICAgICAgUnN2cFxuLy8gICBFZGdlczogICAgUE9TVEVEIChNZW1iZXIgLT4gUG9zdClcbi8vICAgICAgICAgICAgIENPTU1FTlRFRCAoTWVtYmVyIC0+IENvbW1lbnQpLCBPTiAoQ29tbWVudCAtPiBQb3N0fEV2ZW50fFZlbmRvcilcbi8vICAgICAgICAgICAgIExJS0VEIChNZW1iZXIgLT4gUG9zdClcbi8vICAgICAgICAgICAgIFJTVlBEIChNZW1iZXIgLT4gUnN2cCksIEZPUiAoUnN2cCAtPiBFdmVudClcbi8vICAgICAgICAgICAgIEZFQVRVUkVTIChFdmVudCAtPiBWZW5kb3IpXG4vLyAgICAgICAgICAgICBIQVNfQ09OVEFDVCAoVmVuZG9yIC0+IFZlbmRvckNvbnRhY3QpXG4vLyAgICAgICAgICAgICBDT05ORUNURURfV0lUSCAoTWVtYmVyIDwtPiBNZW1iZXI7IHN0YXR1cyBvbiBlZGdlKVxuLy8gICAgICAgICAgICAgTEVGVF9GRUVEQkFDSyAoTWVtYmVyIC0+IEZlZWRiYWNrKSwgQUJPVVQgKEZlZWRiYWNrIC0+IEV2ZW50fFZlbmRvcilcblxuaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gXCJjcnlwdG9cIjtcbmltcG9ydCAqIGFzIGdyZW1saW4gZnJvbSBcImdyZW1saW5cIjtcbmNvbnN0IHsgUCwgVGV4dFAsIG9yZGVyLCB0OiBUIH0gPSBncmVtbGluLnByb2Nlc3M7XG5jb25zdCBfXyA9IGdyZW1saW4ucHJvY2Vzcy5zdGF0aWNzO1xuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxudHlwZSBHID0gYW55O1xuaW50ZXJmYWNlIEN0eCB7XG4gIGc6IEcgfCBudWxsO1xuICBpZGVudGl0eTogeyBzdWI/OiBzdHJpbmc7IHVzZXJuYW1lPzogc3RyaW5nOyBncm91cHM/OiBzdHJpbmdbXSB9IHwgbnVsbDtcbn1cblxuLy8gVC5pZCBhbmQgc2ltaWxhciBlbnVtIHZhbHVlcyBhcmVuJ3QgdmFsaWQgaW5kZXgga2V5cyBpbiBzdHJpY3QgVFM7XG4vLyB1c2UgdGhlIHN0cmluZyBmb3JtcyB1c2VkIGJ5IE5lcHR1bmUncyBlbGVtZW50TWFwIG91dHB1dC5cbmNvbnN0IGlkS2V5ID0gVC5pZCBhcyB1bmtub3duIGFzIHN0cmluZztcblxuY29uc3Qgbm93SXNvID0gKCkgPT4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuXG4vLyAtLS0tLS0tLS0tIFJTVlAgdG9rZW4gc2lnbmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5sZXQgX2NhY2hlZFNlY3JldDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5sZXQgX3NlY3JldFByb21pc2U6IFByb21pc2U8c3RyaW5nPiB8IG51bGwgPSBudWxsO1xuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUnN2cFNlY3JldCgpOiBQcm9taXNlPHN0cmluZz4ge1xuICBpZiAoX2NhY2hlZFNlY3JldCkgcmV0dXJuIF9jYWNoZWRTZWNyZXQ7XG4gIGNvbnN0IGlubGluZSA9IHByb2Nlc3MuZW52LlJTVlBfU0lHTklOR19TRUNSRVQ7XG4gIGlmIChpbmxpbmUpIHtcbiAgICBfY2FjaGVkU2VjcmV0ID0gaW5saW5lO1xuICAgIHJldHVybiBpbmxpbmU7XG4gIH1cbiAgY29uc3QgYXJuID0gcHJvY2Vzcy5lbnYuUlNWUF9TSUdOSU5HX1NFQ1JFVF9BUk47XG4gIGlmICghYXJuKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJOZWl0aGVyIFJTVlBfU0lHTklOR19TRUNSRVQgbm9yIFJTVlBfU0lHTklOR19TRUNSRVRfQVJOIGlzIHNldFwiLFxuICAgICk7XG4gIH1cbiAgaWYgKCFfc2VjcmV0UHJvbWlzZSkge1xuICAgIF9zZWNyZXRQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG4gICAgICBjb25zdCBtb2Q6IGFueSA9IGF3YWl0IGltcG9ydChcbiAgICAgICAgLyogd2VicGFja0lnbm9yZTogdHJ1ZSAqLyBcIkBhd3Mtc2RrL2NsaWVudC1zZWNyZXRzLW1hbmFnZXJcIiBhcyBzdHJpbmdcbiAgICAgICk7XG4gICAgICBjb25zdCBjbGllbnQgPSBuZXcgbW9kLlNlY3JldHNNYW5hZ2VyQ2xpZW50KHtcbiAgICAgICAgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OLFxuICAgICAgfSk7XG4gICAgICBjb25zdCBvdXQgPSBhd2FpdCBjbGllbnQuc2VuZChcbiAgICAgICAgbmV3IG1vZC5HZXRTZWNyZXRWYWx1ZUNvbW1hbmQoeyBTZWNyZXRJZDogYXJuIH0pLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IHZhbHVlID0gKG91dC5TZWNyZXRTdHJpbmcgYXMgc3RyaW5nKSA/PyBcIlwiO1xuICAgICAgaWYgKCF2YWx1ZSkgdGhyb3cgbmV3IEVycm9yKFwiUlNWUCBzaWduaW5nIHNlY3JldCBpcyBlbXB0eVwiKTtcbiAgICAgIF9jYWNoZWRTZWNyZXQgPSB2YWx1ZTtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9KSgpO1xuICB9XG4gIHJldHVybiBfc2VjcmV0UHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gYmFzZTY0dXJsKGJ1ZjogQnVmZmVyKTogc3RyaW5nIHtcbiAgcmV0dXJuIGJ1ZlxuICAgIC50b1N0cmluZyhcImJhc2U2NFwiKVxuICAgIC5yZXBsYWNlKC89KyQvZywgXCJcIilcbiAgICAucmVwbGFjZSgvXFwrL2csIFwiLVwiKVxuICAgIC5yZXBsYWNlKC9cXC8vZywgXCJfXCIpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2lnblJzdnBUb2tlbihwYXlsb2FkOiB7XG4gIGV2ZW50SWQ6IHN0cmluZztcbiAgbWVtYmVySWQ6IHN0cmluZztcbiAgZXhwPzogbnVtYmVyO1xufSk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHNlY3JldCA9IGF3YWl0IHJlc29sdmVSc3ZwU2VjcmV0KCk7XG4gIGNvbnN0IGJvZHkgPSBiYXNlNjR1cmwoQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkocGF5bG9hZCkpKTtcbiAgY29uc3Qgc2lnID0gYmFzZTY0dXJsKFxuICAgIGNyeXB0by5jcmVhdGVIbWFjKFwic2hhMjU2XCIsIHNlY3JldCkudXBkYXRlKGJvZHkpLmRpZ2VzdCgpLFxuICApO1xuICByZXR1cm4gYCR7Ym9keX0uJHtzaWd9YDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeVJzdnBUb2tlbihcbiAgdG9rZW46IHN0cmluZyxcbik6IFByb21pc2U8eyBldmVudElkOiBzdHJpbmc7IG1lbWJlcklkOiBzdHJpbmc7IGV4cD86IG51bWJlciB9IHwgbnVsbD4ge1xuICBjb25zdCBbYm9keSwgc2lnXSA9ICh0b2tlbiA/PyBcIlwiKS5zcGxpdChcIi5cIik7XG4gIGlmICghYm9keSB8fCAhc2lnKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc2VjcmV0ID0gYXdhaXQgcmVzb2x2ZVJzdnBTZWNyZXQoKTtcbiAgY29uc3QgZXhwZWN0ZWQgPSBiYXNlNjR1cmwoXG4gICAgY3J5cHRvLmNyZWF0ZUhtYWMoXCJzaGEyNTZcIiwgc2VjcmV0KS51cGRhdGUoYm9keSkuZGlnZXN0KCksXG4gICk7XG4gIGNvbnN0IGEgPSBCdWZmZXIuZnJvbShzaWcpO1xuICBjb25zdCBiID0gQnVmZmVyLmZyb20oZXhwZWN0ZWQpO1xuICBpZiAoYS5sZW5ndGggIT09IGIubGVuZ3RoIHx8ICFjcnlwdG8udGltaW5nU2FmZUVxdWFsKGEsIGIpKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXlsb2FkID0gSlNPTi5wYXJzZShcbiAgICAgIEJ1ZmZlci5mcm9tKFxuICAgICAgICBib2R5LnJlcGxhY2UoLy0vZywgXCIrXCIpLnJlcGxhY2UoL18vZywgXCIvXCIpICtcbiAgICAgICAgICBcIj1cIi5yZXBlYXQoKDQgLSAoYm9keS5sZW5ndGggJSA0KSkgJSA0KSxcbiAgICAgICAgXCJiYXNlNjRcIixcbiAgICAgICkudG9TdHJpbmcoXCJ1dGYtOFwiKSxcbiAgICApO1xuICAgIGlmIChwYXlsb2FkLmV4cCAmJiBEYXRlLm5vdygpIC8gMTAwMCA+IHBheWxvYWQuZXhwKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gcGF5bG9hZDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLSBzaGFyZWQgZWxlbWVudCBtYXAg4oaSIGRvbWFpbiBvYmplY3QgaGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBOZXB0dW5lIGVsZW1lbnRNYXAga2V5cyBjb21lIGJhY2sgYXMgSlMgTWFwcyB1bmRlciBncmVtbGluLXYyOyBub3JtYWxpemUuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxuZnVuY3Rpb24gdG9QbGFpbihtOiBhbnkpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIGlmICghbSkgcmV0dXJuIHt9O1xuICBpZiAobSBpbnN0YW5jZW9mIE1hcCkge1xuICAgIGNvbnN0IG9iajogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBtLmVudHJpZXMoKSkge1xuICAgICAgY29uc3Qga2V5ID0gdHlwZW9mIGsgPT09IFwic3ltYm9sXCIgPyBTdHJpbmcoaykgOiBTdHJpbmcoayk7XG4gICAgICBvYmpba2V5XSA9IHYgaW5zdGFuY2VvZiBNYXAgPyB0b1BsYWluKHYpIDogdjtcbiAgICB9XG4gICAgcmV0dXJuIG9iajtcbiAgfVxuICByZXR1cm4gbSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn1cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbmZ1bmN0aW9uIGFzSWQodjogYW55KTogc3RyaW5nIHtcbiAgaWYgKHYgPT09IHVuZGVmaW5lZCB8fCB2ID09PSBudWxsKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIFN0cmluZyh2KTtcbn1cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbmZ1bmN0aW9uIG1hcE1lbWJlcihtOiBhbnkpOiB1bmtub3duIHtcbiAgY29uc3QgcCA9IHRvUGxhaW4obSk7XG4gIHJldHVybiB7XG4gICAgaWQ6IGFzSWQocFtpZEtleV0gPz8gcFtcImlkXCJdKSxcbiAgICBuYW1lOiBwLm5hbWUgPz8gXCJcIixcbiAgICB0aXRsZTogcC50aXRsZSA/PyBudWxsLFxuICAgIGNvbXBhbnk6IHAuY29tcGFueSA/PyBudWxsLFxuICAgIGJpbzogcC5iaW8gPz8gbnVsbCxcbiAgICBhdmF0YXJVcmw6IHAuYXZhdGFyVXJsID8/IG51bGwsXG4gICAgZW1haWw6IG51bGwsIC8vIGhpZGRlbiBieSBkZWZhdWx0OyByZXZlYWxlZCBieSBnZXRNZW1iZXIgd2hlbiBjb25uZWN0ZWRcbiAgICBwaG9uZTogbnVsbCxcbiAgICBjb25uZWN0aW9uU3RhdHVzOiBcIm5vbmVcIixcbiAgfTtcbn1cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbmZ1bmN0aW9uIG1hcFZlbmRvcihtOiBhbnkpOiB1bmtub3duIHtcbiAgY29uc3QgcCA9IHRvUGxhaW4obSk7XG4gIHJldHVybiB7XG4gICAgaWQ6IGFzSWQocFtpZEtleV0gPz8gcFtcImlkXCJdKSxcbiAgICBuYW1lOiBwLm5hbWUgPz8gXCJcIixcbiAgICB0YWdsaW5lOiBwLnRhZ2xpbmUgPz8gbnVsbCxcbiAgICBkZXNjcmlwdGlvbjogcC5kZXNjcmlwdGlvbiA/PyBudWxsLFxuICAgIGxvZ29Vcmw6IHAubG9nb1VybCA/PyBudWxsLFxuICAgIHdlYnNpdGU6IHAud2Vic2l0ZSA/PyBudWxsLFxuICAgIHRhZ3M6ICgocC50YWdzIGFzIHN0cmluZykgPz8gXCJcIikuc3BsaXQoXCJ8XCIpLmZpbHRlcihCb29sZWFuKSxcbiAgICBwcmVzZW50YXRpb25WaWRlb1VybDogcC5wcmVzZW50YXRpb25WaWRlb1VybCA/PyBudWxsLFxuICAgIGNvbnRhY3RzOiBbXSxcbiAgICBjb21tZW50czogW10sXG4gICAgY3JlYXRlZEF0OiBwLmNyZWF0ZWRBdCA/PyBub3dJc28oKSxcbiAgfTtcbn1cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbmZ1bmN0aW9uIG1hcEV2ZW50KG06IGFueSwgY291bnRzPzogeyByc3ZwPzogbnVtYmVyOyBndWVzdHM/OiBudW1iZXIgfSk6IHVua25vd24ge1xuICBjb25zdCBwID0gdG9QbGFpbihtKTtcbiAgY29uc3Qgc3RhcnRzQXQgPSBwLnN0YXJ0c0F0IGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgY29uc3Qgc3RhdHVzOiBcInVwY29taW5nXCIgfCBcInBhc3RcIiA9XG4gICAgc3RhcnRzQXQgJiYgbmV3IERhdGUoc3RhcnRzQXQpLmdldFRpbWUoKSA+PSBEYXRlLm5vdygpID8gXCJ1cGNvbWluZ1wiIDogXCJwYXN0XCI7XG4gIHJldHVybiB7XG4gICAgaWQ6IGFzSWQocFtpZEtleV0gPz8gcFtcImlkXCJdKSxcbiAgICB0aXRsZTogcC50aXRsZSA/PyBcIlwiLFxuICAgIGRlc2NyaXB0aW9uOiBwLmRlc2NyaXB0aW9uID8/IG51bGwsXG4gICAgc3RhcnRzQXQ6IHN0YXJ0c0F0ID8/IG5vd0lzbygpLFxuICAgIGVuZHNBdDogcC5lbmRzQXQgPz8gbnVsbCxcbiAgICB2ZW51ZTogcC52ZW51ZSA/PyBcIlwiLFxuICAgIGNpdHk6IHAuY2l0eSA/PyBudWxsLFxuICAgIHN0YXR1cyxcbiAgICByc3ZwQ291bnQ6IGNvdW50cz8ucnN2cCA/PyAwLFxuICAgIGd1ZXN0Q291bnQ6IGNvdW50cz8uZ3Vlc3RzID8/IDAsXG4gICAgdmlkZW9Vcmw6IHAudmlkZW9VcmwgPz8gbnVsbCxcbiAgICB2ZW5kb3JzOiBbXSxcbiAgICBjb21tZW50czogW10sXG4gICAgY3JlYXRlZEF0OiBwLmNyZWF0ZWRBdCA/PyBub3dJc28oKSxcbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLSBxdWVyaWVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGNvbnN0IFNPQ0lBTF9RVUVSWV9GSUVMRFMgPSBuZXcgU2V0KFtcbiAgXCJsaXN0RmVlZFwiLFxuICBcImdldFBvc3RcIixcbiAgXCJsaXN0RXZlbnRzXCIsXG4gIFwiZ2V0RXZlbnRcIixcbiAgXCJsaXN0VmVuZG9yc1wiLFxuICBcImdldFZlbmRvclwiLFxuICBcImxpc3RNZW1iZXJzXCIsXG4gIFwiZ2V0TWVtYmVyXCIsXG4gIFwiZ2V0UnN2cEJ5VG9rZW5cIixcbl0pO1xuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRpc3BhdGNoU29jaWFsUXVlcnkoZmllbGQ6IHN0cmluZywgYXJnczogYW55LCBjdHg6IEN0eCk6IFByb21pc2U8YW55PiB7XG4gIGNvbnN0IHsgZywgaWRlbnRpdHkgfSA9IGN0eDtcbiAgY29uc3QgbWUgPSBpZGVudGl0eT8uc3ViID8/IG51bGw7XG5cbiAgaWYgKCFnKSB0aHJvdyBuZXcgRXJyb3IoXCJkaXNwYXRjaFNvY2lhbFF1ZXJ5IHJlcXVpcmVzIGFuIGFjdGl2ZSBHcmVtbGluIHRyYXZlcnNhbCBzb3VyY2VcIik7XG5cbiAgc3dpdGNoIChmaWVsZCkge1xuICAgIGNhc2UgXCJsaXN0RmVlZFwiOiB7XG4gICAgICBjb25zdCBsaW1pdCA9IE1hdGgubWluKE1hdGgubWF4KGFyZ3MubGltaXQgPz8gMjAsIDEpLCA1MCk7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZ1xuICAgICAgICAuVigpXG4gICAgICAgIC5oYXNMYWJlbChcIlBvc3RcIilcbiAgICAgICAgLm9yZGVyKClcbiAgICAgICAgLmJ5KFwiY3JlYXRlZEF0XCIsIG9yZGVyLmRlc2MpXG4gICAgICAgIC5saW1pdChsaW1pdClcbiAgICAgICAgLnByb2plY3QoXCJwb3N0XCIsIFwiYXV0aG9yXCIsIFwibGlrZXNcIiwgXCJjb21tZW50c1wiLCBcImxpa2VkQnlNZVwiKVxuICAgICAgICAuYnkoX18uZWxlbWVudE1hcCgpKVxuICAgICAgICAuYnkoX18uaW5fKFwiUE9TVEVEXCIpLmhhc0xhYmVsKFwiTWVtYmVyXCIpLmVsZW1lbnRNYXAoKS5mb2xkKCkpXG4gICAgICAgIC5ieShfXy5pbl8oXCJMSUtFRFwiKS5jb3VudCgpKVxuICAgICAgICAuYnkoX18uaW5fKFwiT05cIikuaGFzTGFiZWwoXCJDb21tZW50XCIpLmNvdW50KCkpXG4gICAgICAgIC5ieShcbiAgICAgICAgICBtZVxuICAgICAgICAgICAgPyBfXy5pbl8oXCJMSUtFRFwiKS5oYXMoXCJNZW1iZXJcIiwgXCJpZFwiLCBtZSkuY291bnQoKVxuICAgICAgICAgICAgOiBfXy5jb25zdGFudCgwKSxcbiAgICAgICAgKVxuICAgICAgICAudG9MaXN0KCk7XG5cbiAgICAgIGNvbnN0IGl0ZW1zID0gcm93cy5tYXAoKHI6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCByb3cgPSB0b1BsYWluKHIpO1xuICAgICAgICBjb25zdCBwb3N0ID0gdG9QbGFpbihyb3cucG9zdCk7XG4gICAgICAgIGNvbnN0IGF1dGhvciA9IEFycmF5LmlzQXJyYXkocm93LmF1dGhvcikgJiYgcm93LmF1dGhvclswXSA/IHRvUGxhaW4ocm93LmF1dGhvclswXSkgOiB7fTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBpZDogYXNJZChwb3N0W2lkS2V5XSA/PyBwb3N0W1wiaWRcIl0pLFxuICAgICAgICAgIGtpbmQ6IHBvc3Qua2luZCA/PyBcIm1lbWJlcl9wb3N0XCIsXG4gICAgICAgICAgYXV0aG9ySWQ6IGFzSWQoYXV0aG9yW2lkS2V5XSA/PyBhdXRob3JbXCJpZFwiXSksXG4gICAgICAgICAgYXV0aG9yTmFtZTogYXV0aG9yLm5hbWUgPz8gbnVsbCxcbiAgICAgICAgICBhdXRob3JBdmF0YXJVcmw6IGF1dGhvci5hdmF0YXJVcmwgPz8gbnVsbCxcbiAgICAgICAgICBib2R5OiBwb3N0LmJvZHkgPz8gXCJcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IHBvc3QuY3JlYXRlZEF0ID8/IG5vd0lzbygpLFxuICAgICAgICAgIGNvbW1lbnRDb3VudDogTnVtYmVyKHJvdy5jb21tZW50cyA/PyAwKSxcbiAgICAgICAgICBsaWtlQ291bnQ6IE51bWJlcihyb3cubGlrZXMgPz8gMCksXG4gICAgICAgICAgbGlrZWRCeU1lOiBOdW1iZXIocm93Lmxpa2VkQnlNZSA/PyAwKSA+IDAsXG4gICAgICAgICAgbGlua2VkVmVuZG9ySWQ6IHBvc3QubGlua2VkVmVuZG9ySWQgPz8gbnVsbCxcbiAgICAgICAgICBsaW5rZWRFdmVudElkOiBwb3N0LmxpbmtlZEV2ZW50SWQgPz8gbnVsbCxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHsgaXRlbXMsIG5leHRDdXJzb3I6IG51bGwgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiZ2V0UG9zdFwiOiB7XG4gICAgICBjb25zdCByb3cgPSBhd2FpdCBnXG4gICAgICAgIC5WKGFyZ3MuaWQpXG4gICAgICAgIC5oYXNMYWJlbChcIlBvc3RcIilcbiAgICAgICAgLnByb2plY3QoXCJwb3N0XCIsIFwiYXV0aG9yXCIsIFwibGlrZXNcIiwgXCJjb21tZW50c1wiKVxuICAgICAgICAuYnkoX18uZWxlbWVudE1hcCgpKVxuICAgICAgICAuYnkoX18uaW5fKFwiUE9TVEVEXCIpLmhhc0xhYmVsKFwiTWVtYmVyXCIpLmVsZW1lbnRNYXAoKS5mb2xkKCkpXG4gICAgICAgIC5ieShfXy5pbl8oXCJMSUtFRFwiKS5jb3VudCgpKVxuICAgICAgICAuYnkoXG4gICAgICAgICAgX18uaW5fKFwiT05cIilcbiAgICAgICAgICAgIC5oYXNMYWJlbChcIkNvbW1lbnRcIilcbiAgICAgICAgICAgIC5vcmRlcigpXG4gICAgICAgICAgICAuYnkoXCJjcmVhdGVkQXRcIiwgb3JkZXIuYXNjKVxuICAgICAgICAgICAgLnByb2plY3QoXCJjb21tZW50XCIsIFwiYXV0aG9yXCIpXG4gICAgICAgICAgICAuYnkoX18uZWxlbWVudE1hcCgpKVxuICAgICAgICAgICAgLmJ5KF9fLmluXyhcIkNPTU1FTlRFRFwiKS5oYXNMYWJlbChcIk1lbWJlclwiKS5lbGVtZW50TWFwKCkuZm9sZCgpKVxuICAgICAgICAgICAgLmZvbGQoKSxcbiAgICAgICAgKVxuICAgICAgICAubmV4dCgpO1xuICAgICAgaWYgKCFyb3c/LnZhbHVlKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IHIgPSB0b1BsYWluKHJvdy52YWx1ZSk7XG4gICAgICBjb25zdCBwb3N0ID0gdG9QbGFpbihyLnBvc3QpO1xuICAgICAgY29uc3QgYXV0aG9yID0gQXJyYXkuaXNBcnJheShyLmF1dGhvcikgJiYgci5hdXRob3JbMF0gPyB0b1BsYWluKHIuYXV0aG9yWzBdKSA6IHt9O1xuICAgICAgY29uc3QgY29tbWVudHMgPSAoKHIuY29tbWVudHMgYXMgdW5rbm93bltdKSA/PyBbXSkubWFwKChjKSA9PiB7XG4gICAgICAgIGNvbnN0IGNyID0gdG9QbGFpbihjKTtcbiAgICAgICAgY29uc3QgY20gPSB0b1BsYWluKGNyLmNvbW1lbnQpO1xuICAgICAgICBjb25zdCBjYSA9IEFycmF5LmlzQXJyYXkoY3IuYXV0aG9yKSAmJiBjci5hdXRob3JbMF0gPyB0b1BsYWluKGNyLmF1dGhvclswXSkgOiB7fTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBpZDogYXNJZChjbVtpZEtleV0gPz8gY21bXCJpZFwiXSksXG4gICAgICAgICAgYXV0aG9ySWQ6IGFzSWQoY2FbaWRLZXldID8/IGNhW1wiaWRcIl0pLFxuICAgICAgICAgIGF1dGhvck5hbWU6IGNhLm5hbWUgPz8gXCJNZW1iZXJcIixcbiAgICAgICAgICBhdXRob3JBdmF0YXJVcmw6IGNhLmF2YXRhclVybCA/PyBudWxsLFxuICAgICAgICAgIGJvZHk6IGNtLmJvZHkgPz8gXCJcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IGNtLmNyZWF0ZWRBdCA/PyBub3dJc28oKSxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaWQ6IGFzSWQocG9zdFtpZEtleV0gPz8gcG9zdFtcImlkXCJdKSxcbiAgICAgICAga2luZDogcG9zdC5raW5kID8/IFwibWVtYmVyX3Bvc3RcIixcbiAgICAgICAgYXV0aG9ySWQ6IGFzSWQoYXV0aG9yW2lkS2V5XSA/PyBhdXRob3JbXCJpZFwiXSksXG4gICAgICAgIGF1dGhvck5hbWU6IGF1dGhvci5uYW1lID8/IG51bGwsXG4gICAgICAgIGF1dGhvckF2YXRhclVybDogYXV0aG9yLmF2YXRhclVybCA/PyBudWxsLFxuICAgICAgICBib2R5OiBwb3N0LmJvZHkgPz8gXCJcIixcbiAgICAgICAgY3JlYXRlZEF0OiBwb3N0LmNyZWF0ZWRBdCA/PyBub3dJc28oKSxcbiAgICAgICAgY29tbWVudENvdW50OiBjb21tZW50cy5sZW5ndGgsXG4gICAgICAgIGxpa2VDb3VudDogTnVtYmVyKHIubGlrZXMgPz8gMCksXG4gICAgICAgIGxpa2VkQnlNZTogZmFsc2UsXG4gICAgICAgIGxpbmtlZFZlbmRvcklkOiBwb3N0LmxpbmtlZFZlbmRvcklkID8/IG51bGwsXG4gICAgICAgIGxpbmtlZEV2ZW50SWQ6IHBvc3QubGlua2VkRXZlbnRJZCA/PyBudWxsLFxuICAgICAgICBjb21tZW50cyxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY2FzZSBcImxpc3RFdmVudHNcIjoge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGdcbiAgICAgICAgLlYoKVxuICAgICAgICAuaGFzTGFiZWwoXCJFdmVudFwiKVxuICAgICAgICAub3JkZXIoKVxuICAgICAgICAuYnkoXCJzdGFydHNBdFwiLCBvcmRlci5hc2MpXG4gICAgICAgIC5wcm9qZWN0KFwiZXZ0XCIsIFwicnN2cHNcIiwgXCJndWVzdHNcIiwgXCJ2ZW5kb3JzXCIpXG4gICAgICAgIC5ieShfXy5lbGVtZW50TWFwKCkpXG4gICAgICAgIC5ieShfXy5pbl8oXCJGT1JcIikuaGFzTGFiZWwoXCJSc3ZwXCIpLmhhcyhcInN0YXR1c1wiLCBcInllc1wiKS5jb3VudCgpKVxuICAgICAgICAuYnkoXG4gICAgICAgICAgX18uaW5fKFwiRk9SXCIpXG4gICAgICAgICAgICAuaGFzTGFiZWwoXCJSc3ZwXCIpXG4gICAgICAgICAgICAuaGFzKFwic3RhdHVzXCIsIFwieWVzXCIpXG4gICAgICAgICAgICAudmFsdWVzKFwiZ3Vlc3RzXCIpXG4gICAgICAgICAgICAuc3VtKCksXG4gICAgICAgIClcbiAgICAgICAgLmJ5KFxuICAgICAgICAgIF9fLm91dChcIkZFQVRVUkVTXCIpXG4gICAgICAgICAgICAuaGFzTGFiZWwoXCJWZW5kb3JcIilcbiAgICAgICAgICAgIC5wcm9qZWN0KFwiaWRcIiwgXCJuYW1lXCIsIFwidGFnbGluZVwiLCBcImxvZ29VcmxcIilcbiAgICAgICAgICAgIC5ieShfXy5pZCgpKVxuICAgICAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcyhcIm5hbWVcIiksIF9fLmNvbnN0YW50KFwiXCIpKSlcbiAgICAgICAgICAgIC5ieShfXy5jb2FsZXNjZShfXy52YWx1ZXMoXCJ0YWdsaW5lXCIpLCBfXy5jb25zdGFudChcIlwiKSkpXG4gICAgICAgICAgICAuYnkoX18uY29hbGVzY2UoX18udmFsdWVzKFwibG9nb1VybFwiKSwgX18uY29uc3RhbnQoXCJcIikpKVxuICAgICAgICAgICAgLmZvbGQoKSxcbiAgICAgICAgKVxuICAgICAgICAudG9MaXN0KCk7XG5cbiAgICAgIGNvbnN0IGV2ZW50cyA9IHJvd3NcbiAgICAgICAgLm1hcCgocjogYW55KSA9PiB7XG4gICAgICAgICAgY29uc3Qgcm93ID0gdG9QbGFpbihyKTtcbiAgICAgICAgICBjb25zdCBlID0gbWFwRXZlbnQocm93LmV2dCwge1xuICAgICAgICAgICAgcnN2cDogTnVtYmVyKHJvdy5yc3ZwcyA/PyAwKSxcbiAgICAgICAgICAgIGd1ZXN0czogTnVtYmVyKHJvdy5ndWVzdHMgPz8gMCksXG4gICAgICAgICAgfSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICAgICAgZS52ZW5kb3JzID0gKChyb3cudmVuZG9ycyBhcyB1bmtub3duW10pID8/IFtdKS5tYXAoKHYpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHZwID0gdG9QbGFpbih2KTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIGlkOiBhc0lkKHZwLmlkKSxcbiAgICAgICAgICAgICAgbmFtZTogdnAubmFtZSxcbiAgICAgICAgICAgICAgdGFnbGluZTogdnAudGFnbGluZSB8fCBudWxsLFxuICAgICAgICAgICAgICBsb2dvVXJsOiB2cC5sb2dvVXJsIHx8IG51bGwsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybiBlO1xuICAgICAgICB9KVxuICAgICAgICAuZmlsdGVyKChlOiBhbnkpID0+XG4gICAgICAgICAgYXJncy5zdGF0dXMgPyBlLnN0YXR1cyA9PT0gYXJncy5zdGF0dXMgOiB0cnVlLFxuICAgICAgICApO1xuICAgICAgcmV0dXJuIGV2ZW50cztcbiAgICB9XG5cbiAgICBjYXNlIFwiZ2V0RXZlbnRcIjoge1xuICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZ1xuICAgICAgICAuVihhcmdzLmlkKVxuICAgICAgICAuaGFzTGFiZWwoXCJFdmVudFwiKVxuICAgICAgICAucHJvamVjdChcImV2dFwiLCBcInJzdnBzXCIsIFwiZ3Vlc3RzXCIsIFwidmVuZG9yc1wiKVxuICAgICAgICAuYnkoX18uZWxlbWVudE1hcCgpKVxuICAgICAgICAuYnkoX18uaW5fKFwiRk9SXCIpLmhhc0xhYmVsKFwiUnN2cFwiKS5oYXMoXCJzdGF0dXNcIiwgXCJ5ZXNcIikuY291bnQoKSlcbiAgICAgICAgLmJ5KFxuICAgICAgICAgIF9fLmluXyhcIkZPUlwiKVxuICAgICAgICAgICAgLmhhc0xhYmVsKFwiUnN2cFwiKVxuICAgICAgICAgICAgLmhhcyhcInN0YXR1c1wiLCBcInllc1wiKVxuICAgICAgICAgICAgLnZhbHVlcyhcImd1ZXN0c1wiKVxuICAgICAgICAgICAgLnN1bSgpLFxuICAgICAgICApXG4gICAgICAgIC5ieShcbiAgICAgICAgICBfXy5vdXQoXCJGRUFUVVJFU1wiKVxuICAgICAgICAgICAgLmhhc0xhYmVsKFwiVmVuZG9yXCIpXG4gICAgICAgICAgICAucHJvamVjdChcImlkXCIsIFwibmFtZVwiLCBcInRhZ2xpbmVcIiwgXCJsb2dvVXJsXCIpXG4gICAgICAgICAgICAuYnkoX18uaWQoKSlcbiAgICAgICAgICAgIC5ieShfXy5jb2FsZXNjZShfXy52YWx1ZXMoXCJuYW1lXCIpLCBfXy5jb25zdGFudChcIlwiKSkpXG4gICAgICAgICAgICAuYnkoX18uY29hbGVzY2UoX18udmFsdWVzKFwidGFnbGluZVwiKSwgX18uY29uc3RhbnQoXCJcIikpKVxuICAgICAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcyhcImxvZ29VcmxcIiksIF9fLmNvbnN0YW50KFwiXCIpKSlcbiAgICAgICAgICAgIC5mb2xkKCksXG4gICAgICAgIClcbiAgICAgICAgLm5leHQoKTtcbiAgICAgIGlmICghcm93Py52YWx1ZSkgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCByID0gdG9QbGFpbihyb3cudmFsdWUpO1xuICAgICAgY29uc3QgZXZ0ID0gbWFwRXZlbnQoci5ldnQsIHtcbiAgICAgICAgcnN2cDogTnVtYmVyKHIucnN2cHMgPz8gMCksXG4gICAgICAgIGd1ZXN0czogTnVtYmVyKHIuZ3Vlc3RzID8/IDApLFxuICAgICAgfSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBldnQudmVuZG9ycyA9ICgoci52ZW5kb3JzIGFzIHVua25vd25bXSkgPz8gW10pLm1hcCgodikgPT4ge1xuICAgICAgICBjb25zdCB2cCA9IHRvUGxhaW4odik7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgaWQ6IGFzSWQodnAuaWQpLFxuICAgICAgICAgIG5hbWU6IHZwLm5hbWUsXG4gICAgICAgICAgdGFnbGluZTogdnAudGFnbGluZSB8fCBudWxsLFxuICAgICAgICAgIGxvZ29Vcmw6IHZwLmxvZ29VcmwgfHwgbnVsbCxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGV2dDtcbiAgICB9XG5cbiAgICBjYXNlIFwibGlzdFZlbmRvcnNcIjoge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGdcbiAgICAgICAgLlYoKVxuICAgICAgICAuaGFzTGFiZWwoXCJWZW5kb3JcIilcbiAgICAgICAgLm9yZGVyKClcbiAgICAgICAgLmJ5KFwibmFtZVwiLCBvcmRlci5hc2MpXG4gICAgICAgIC5lbGVtZW50TWFwKClcbiAgICAgICAgLnRvTGlzdCgpO1xuICAgICAgcmV0dXJuIHJvd3MubWFwKG1hcFZlbmRvcik7XG4gICAgfVxuXG4gICAgY2FzZSBcImdldFZlbmRvclwiOiB7XG4gICAgICBjb25zdCByb3cgPSBhd2FpdCBnXG4gICAgICAgIC5WKGFyZ3MuaWQpXG4gICAgICAgIC5oYXNMYWJlbChcIlZlbmRvclwiKVxuICAgICAgICAucHJvamVjdChcInZlbmRvclwiLCBcImNvbnRhY3RzXCIpXG4gICAgICAgIC5ieShfXy5lbGVtZW50TWFwKCkpXG4gICAgICAgIC5ieShcbiAgICAgICAgICBfXy5vdXQoXCJIQVNfQ09OVEFDVFwiKVxuICAgICAgICAgICAgLmhhc0xhYmVsKFwiVmVuZG9yQ29udGFjdFwiKVxuICAgICAgICAgICAgLmVsZW1lbnRNYXAoKVxuICAgICAgICAgICAgLmZvbGQoKSxcbiAgICAgICAgKVxuICAgICAgICAubmV4dCgpO1xuICAgICAgaWYgKCFyb3c/LnZhbHVlKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IHIgPSB0b1BsYWluKHJvdy52YWx1ZSk7XG4gICAgICBjb25zdCB2ZW5kb3IgPSBtYXBWZW5kb3Ioci52ZW5kb3IpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgdmVuZG9yLmNvbnRhY3RzID0gKChyLmNvbnRhY3RzIGFzIHVua25vd25bXSkgPz8gW10pLm1hcCgoYykgPT4ge1xuICAgICAgICBjb25zdCBjcCA9IHRvUGxhaW4oYyk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgaWQ6IGFzSWQoY3BbaWRLZXldID8/IGNwW1wiaWRcIl0pLFxuICAgICAgICAgIG5hbWU6IGNwLm5hbWUsXG4gICAgICAgICAgcm9sZTogY3Aucm9sZSxcbiAgICAgICAgICBlbWFpbDogY3AuZW1haWwsXG4gICAgICAgICAgcGhvbmU6IGNwLnBob25lID8/IG51bGwsXG4gICAgICAgIH07XG4gICAgICB9KTtcbiAgICAgIHJldHVybiB2ZW5kb3I7XG4gICAgfVxuXG4gICAgY2FzZSBcImxpc3RNZW1iZXJzXCI6IHtcbiAgICAgIGNvbnN0IHNlYXJjaCA9IChhcmdzLnNlYXJjaCA/PyBcIlwiKS50cmltKCk7XG4gICAgICBsZXQgcSA9IGcuVigpLmhhc0xhYmVsKFwiTWVtYmVyXCIpO1xuICAgICAgaWYgKHNlYXJjaCkge1xuICAgICAgICBxID0gcS5vcihcbiAgICAgICAgICBfXy5oYXMoXCJuYW1lXCIsIFRleHRQLmNvbnRhaW5pbmcoc2VhcmNoKSksXG4gICAgICAgICAgX18uaGFzKFwidGl0bGVcIiwgVGV4dFAuY29udGFpbmluZyhzZWFyY2gpKSxcbiAgICAgICAgICBfXy5oYXMoXCJjb21wYW55XCIsIFRleHRQLmNvbnRhaW5pbmcoc2VhcmNoKSksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcVxuICAgICAgICAub3JkZXIoKVxuICAgICAgICAuYnkoXCJuYW1lXCIsIG9yZGVyLmFzYylcbiAgICAgICAgLnByb2plY3QoXCJtZW1iZXJcIiwgXCJjb25uZWN0aW9uXCIpXG4gICAgICAgIC5ieShfXy5lbGVtZW50TWFwKCkpXG4gICAgICAgIC5ieShcbiAgICAgICAgICBtZVxuICAgICAgICAgICAgPyBfXy5ib3RoRShcIkNPTk5FQ1RFRF9XSVRIXCIpXG4gICAgICAgICAgICAgICAgLndoZXJlKF9fLm90aGVyVigpLmhhcyhcImlkXCIsIG1lKSlcbiAgICAgICAgICAgICAgICAudmFsdWVzKFwic3RhdHVzXCIpXG4gICAgICAgICAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgICAgICAgICAgLmZvbGQoKVxuICAgICAgICAgICAgOiBfXy5jb25zdGFudChbXSksXG4gICAgICAgIClcbiAgICAgICAgLnRvTGlzdCgpO1xuICAgICAgcmV0dXJuIHJvd3MubWFwKChyOiBhbnkpID0+IHtcbiAgICAgICAgY29uc3Qgcm93ID0gdG9QbGFpbihyKTtcbiAgICAgICAgY29uc3QgYmFzZSA9IG1hcE1lbWJlcihyb3cubWVtYmVyKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gQXJyYXkuaXNBcnJheShyb3cuY29ubmVjdGlvbikgPyByb3cuY29ubmVjdGlvblswXSA6IG51bGw7XG4gICAgICAgIGJhc2UuY29ubmVjdGlvblN0YXR1cyA9IHN0YXR1cyA/PyBcIm5vbmVcIjtcbiAgICAgICAgcmV0dXJuIGJhc2U7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjYXNlIFwiZ2V0TWVtYmVyXCI6IHtcbiAgICAgIGNvbnN0IHJvdyA9IGF3YWl0IGdcbiAgICAgICAgLlYoYXJncy5pZClcbiAgICAgICAgLmhhc0xhYmVsKFwiTWVtYmVyXCIpXG4gICAgICAgIC5wcm9qZWN0KFwibWVtYmVyXCIsIFwiY29ubmVjdGlvblwiKVxuICAgICAgICAuYnkoX18uZWxlbWVudE1hcCgpKVxuICAgICAgICAuYnkoXG4gICAgICAgICAgbWVcbiAgICAgICAgICAgID8gX18uYm90aEUoXCJDT05ORUNURURfV0lUSFwiKVxuICAgICAgICAgICAgICAgIC53aGVyZShfXy5vdGhlclYoKS5oYXMoXCJpZFwiLCBtZSkpXG4gICAgICAgICAgICAgICAgLnZhbHVlcyhcInN0YXR1c1wiKVxuICAgICAgICAgICAgICAgIC5saW1pdCgxKVxuICAgICAgICAgICAgICAgIC5mb2xkKClcbiAgICAgICAgICAgIDogX18uY29uc3RhbnQoW10pLFxuICAgICAgICApXG4gICAgICAgIC5uZXh0KCk7XG4gICAgICBpZiAoIXJvdz8udmFsdWUpIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgciA9IHRvUGxhaW4ocm93LnZhbHVlKTtcbiAgICAgIGNvbnN0IG1lbWJlciA9IG1hcE1lbWJlcihyLm1lbWJlcikgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBjb25zdCBzdGF0dXMgPSBBcnJheS5pc0FycmF5KHIuY29ubmVjdGlvbikgPyByLmNvbm5lY3Rpb25bMF0gOiBudWxsO1xuICAgICAgbWVtYmVyLmNvbm5lY3Rpb25TdGF0dXMgPSBzdGF0dXMgPz8gXCJub25lXCI7XG4gICAgICAvLyBSZXZlYWwgY29udGFjdCBpbmZvIG9ubHkgb25jZSBjb25uZWN0ZWQgKG9yIGZvciB0aGUgbWVtYmVyIHRoZW1zZWx2ZXMpXG4gICAgICBpZiAoc3RhdHVzID09PSBcImNvbm5lY3RlZFwiIHx8IGFyZ3MuaWQgPT09IG1lKSB7XG4gICAgICAgIGNvbnN0IHNyYyA9IHRvUGxhaW4oci5tZW1iZXIpO1xuICAgICAgICBtZW1iZXIuZW1haWwgPSBzcmMuZW1haWwgPz8gbnVsbDtcbiAgICAgICAgbWVtYmVyLnBob25lID0gc3JjLnBob25lID8/IG51bGw7XG4gICAgICB9XG4gICAgICByZXR1cm4gbWVtYmVyO1xuICAgIH1cblxuICAgIGNhc2UgXCJnZXRSc3ZwQnlUb2tlblwiOiB7XG4gICAgICBjb25zdCBwYXlsb2FkID0gYXdhaXQgdmVyaWZ5UnN2cFRva2VuKGFyZ3MudG9rZW4pO1xuICAgICAgaWYgKCFwYXlsb2FkKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IHsgZXZlbnRJZCwgbWVtYmVySWQgfSA9IHBheWxvYWQ7XG5cbiAgICAgIGNvbnN0IGV2dFJvdyA9IGF3YWl0IGcuVihldmVudElkKS5oYXNMYWJlbChcIkV2ZW50XCIpLmVsZW1lbnRNYXAoKS5uZXh0KCk7XG4gICAgICBjb25zdCBtZW1Sb3cgPSBhd2FpdCBnLlYobWVtYmVySWQpLmhhc0xhYmVsKFwiTWVtYmVyXCIpLmVsZW1lbnRNYXAoKS5uZXh0KCk7XG4gICAgICBpZiAoIWV2dFJvdz8udmFsdWUgfHwgIW1lbVJvdz8udmFsdWUpIHJldHVybiBudWxsO1xuXG4gICAgICBjb25zdCByc3ZwUm93ID0gYXdhaXQgZ1xuICAgICAgICAuVihtZW1iZXJJZClcbiAgICAgICAgLm91dChcIlJTVlBEXCIpXG4gICAgICAgIC5oYXNMYWJlbChcIlJzdnBcIilcbiAgICAgICAgLndoZXJlKF9fLm91dChcIkZPUlwiKS5oYXNJZChldmVudElkKSlcbiAgICAgICAgLmVsZW1lbnRNYXAoKVxuICAgICAgICAuZm9sZCgpXG4gICAgICAgIC5uZXh0KCk7XG4gICAgICBjb25zdCBleGlzdGluZyA9XG4gICAgICAgIEFycmF5LmlzQXJyYXkocnN2cFJvdz8udmFsdWUpICYmIHJzdnBSb3cudmFsdWVbMF1cbiAgICAgICAgICA/IHRvUGxhaW4ocnN2cFJvdy52YWx1ZVswXSlcbiAgICAgICAgICA6IG51bGw7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGV2ZW50OiBtYXBFdmVudChldnRSb3cudmFsdWUpLFxuICAgICAgICBtZW1iZXI6IG1hcE1lbWJlcihtZW1Sb3cudmFsdWUpLFxuICAgICAgICByc3ZwOiBleGlzdGluZ1xuICAgICAgICAgID8ge1xuICAgICAgICAgICAgICBpZDogYXNJZChleGlzdGluZ1tpZEtleV0gPz8gZXhpc3RpbmdbXCJpZFwiXSksXG4gICAgICAgICAgICAgIGV2ZW50SWQsXG4gICAgICAgICAgICAgIG1lbWJlcklkLFxuICAgICAgICAgICAgICBzdGF0dXM6IGV4aXN0aW5nLnN0YXR1cyA/PyBcInBlbmRpbmdcIixcbiAgICAgICAgICAgICAgZ3Vlc3RzOiBOdW1iZXIoZXhpc3RpbmcuZ3Vlc3RzID8/IDApLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIDoge1xuICAgICAgICAgICAgICBpZDogXCJcIixcbiAgICAgICAgICAgICAgZXZlbnRJZCxcbiAgICAgICAgICAgICAgbWVtYmVySWQsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgICAgIGd1ZXN0czogMCxcbiAgICAgICAgICAgIH0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0gbXV0YXRpb25zIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBjb25zdCBTT0NJQUxfTVVUQVRJT05fRklFTERTID0gbmV3IFNldChbXG4gIFwiY3JlYXRlUG9zdFwiLFxuICBcImNyZWF0ZUNvbW1lbnRcIixcbiAgXCJ0b2dnbGVMaWtlXCIsXG4gIFwic3VibWl0RmVlZGJhY2tcIixcbiAgXCJyZXF1ZXN0Q29ubmVjdGlvblwiLFxuICBcInJlc3BvbmRUb0Nvbm5lY3Rpb25cIixcbiAgXCJ1cGRhdGVNZW1iZXJQcm9maWxlXCIsXG4gIFwiY3JlYXRlRXZlbnRcIixcbiAgXCJ1cGRhdGVFdmVudFwiLFxuICBcInJlcXVlc3RFdmVudFZpZGVvVXBsb2FkXCIsXG4gIFwiYXR0YWNoRXZlbnRWaWRlb1wiLFxuICBcInNlbmRFdmVudFJzdnBFbWFpbHNcIixcbiAgXCJjcmVhdGVWZW5kb3JcIixcbiAgXCJ1cGRhdGVWZW5kb3JcIixcbiAgXCJzdWJtaXRSc3ZwXCIsXG4gIFwiaW52aXRlTWVtYmVyXCIsXG5dKTtcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkaXNwYXRjaFNvY2lhbE11dGF0aW9uKGZpZWxkOiBzdHJpbmcsIGFyZ3M6IGFueSwgY3R4OiBDdHgpOiBQcm9taXNlPGFueT4ge1xuICBjb25zdCB7IGcsIGlkZW50aXR5IH0gPSBjdHg7XG4gIGNvbnN0IG1lID0gaWRlbnRpdHk/LnN1YiA/PyBcInVua25vd25cIjtcbiAgY29uc3QgdXNlcm5hbWUgPSBpZGVudGl0eT8udXNlcm5hbWUgPz8gXCJNZW1iZXJcIjtcblxuICBpZiAoIWcpIHRocm93IG5ldyBFcnJvcihcImRpc3BhdGNoU29jaWFsTXV0YXRpb24gcmVxdWlyZXMgYW4gYWN0aXZlIEdyZW1saW4gdHJhdmVyc2FsIHNvdXJjZVwiKTtcblxuICBzd2l0Y2ggKGZpZWxkKSB7XG4gICAgY2FzZSBcImNyZWF0ZVBvc3RcIjoge1xuICAgICAgY29uc3QgaWQgPSBgcG9zdC0ke2NyeXB0by5yYW5kb21VVUlEKCl9YDtcbiAgICAgIGF3YWl0IGdcbiAgICAgICAgLmFkZFYoXCJQb3N0XCIpXG4gICAgICAgIC5wcm9wZXJ0eShULmlkLCBpZClcbiAgICAgICAgLnByb3BlcnR5KFwia2luZFwiLCBcIm1lbWJlcl9wb3N0XCIpXG4gICAgICAgIC5wcm9wZXJ0eShcImJvZHlcIiwgYXJncy5ib2R5KVxuICAgICAgICAucHJvcGVydHkoXCJjcmVhdGVkQXRcIiwgbm93SXNvKCkpXG4gICAgICAgIC5hcyhcInBcIilcbiAgICAgICAgLlYobWUpXG4gICAgICAgIC5hZGRFKFwiUE9TVEVEXCIpXG4gICAgICAgIC50byhcInBcIilcbiAgICAgICAgLml0ZXJhdGUoKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGlkLFxuICAgICAgICBraW5kOiBcIm1lbWJlcl9wb3N0XCIsXG4gICAgICAgIGF1dGhvcklkOiBtZSxcbiAgICAgICAgYXV0aG9yTmFtZTogdXNlcm5hbWUsXG4gICAgICAgIGJvZHk6IGFyZ3MuYm9keSxcbiAgICAgICAgY3JlYXRlZEF0OiBub3dJc28oKSxcbiAgICAgICAgY29tbWVudENvdW50OiAwLFxuICAgICAgICBsaWtlQ291bnQ6IDAsXG4gICAgICAgIGxpa2VkQnlNZTogZmFsc2UsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJjcmVhdGVDb21tZW50XCI6IHtcbiAgICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgICBjb25zdCBpZCA9IGBjbS0ke2NyeXB0by5yYW5kb21VVUlEKCl9YDtcbiAgICAgIGF3YWl0IGdcbiAgICAgICAgLmFkZFYoXCJDb21tZW50XCIpXG4gICAgICAgIC5wcm9wZXJ0eShULmlkLCBpZClcbiAgICAgICAgLnByb3BlcnR5KFwiYm9keVwiLCBpbnB1dC5ib2R5KVxuICAgICAgICAucHJvcGVydHkoXCJjcmVhdGVkQXRcIiwgbm93SXNvKCkpXG4gICAgICAgIC5hcyhcImNcIilcbiAgICAgICAgLlYobWUpXG4gICAgICAgIC5hZGRFKFwiQ09NTUVOVEVEXCIpXG4gICAgICAgIC50byhcImNcIilcbiAgICAgICAgLlYoaW5wdXQudGFyZ2V0SWQpXG4gICAgICAgIC5hZGRFKFwiT05cIilcbiAgICAgICAgLmZyb21fKFwiY1wiKVxuICAgICAgICAuaXRlcmF0ZSgpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaWQsXG4gICAgICAgIGF1dGhvcklkOiBtZSxcbiAgICAgICAgYXV0aG9yTmFtZTogdXNlcm5hbWUsXG4gICAgICAgIGJvZHk6IGlucHV0LmJvZHksXG4gICAgICAgIGNyZWF0ZWRBdDogbm93SXNvKCksXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJ0b2dnbGVMaWtlXCI6IHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZ1xuICAgICAgICAuVihtZSlcbiAgICAgICAgLm91dEUoXCJMSUtFRFwiKVxuICAgICAgICAud2hlcmUoX18uaW5WKCkuaGFzSWQoYXJncy5wb3N0SWQpKVxuICAgICAgICAuZm9sZCgpXG4gICAgICAgIC5uZXh0KCk7XG4gICAgICBjb25zdCBoYXNMaWtlID0gQXJyYXkuaXNBcnJheShleGlzdGluZz8udmFsdWUpICYmIGV4aXN0aW5nLnZhbHVlLmxlbmd0aCA+IDA7XG4gICAgICBpZiAoaGFzTGlrZSkge1xuICAgICAgICBhd2FpdCBnLlYobWUpLm91dEUoXCJMSUtFRFwiKS53aGVyZShfXy5pblYoKS5oYXNJZChhcmdzLnBvc3RJZCkpLmRyb3AoKS5pdGVyYXRlKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBnLlYobWUpLmFkZEUoXCJMSUtFRFwiKS50byhfXy5WKGFyZ3MucG9zdElkKSkuaXRlcmF0ZSgpO1xuICAgICAgfVxuICAgICAgY29uc3QgY291bnQgPSBhd2FpdCBnLlYoYXJncy5wb3N0SWQpLmluXyhcIkxJS0VEXCIpLmNvdW50KCkubmV4dCgpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaWQ6IGFyZ3MucG9zdElkLFxuICAgICAgICBsaWtlQ291bnQ6IE51bWJlcihjb3VudC52YWx1ZSA/PyAwKSxcbiAgICAgICAgbGlrZWRCeU1lOiAhaGFzTGlrZSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY2FzZSBcInN1Ym1pdEZlZWRiYWNrXCI6IHtcbiAgICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgICBjb25zdCBpZCA9IGBmYi0ke2NyeXB0by5yYW5kb21VVUlEKCl9YDtcbiAgICAgIGF3YWl0IGdcbiAgICAgICAgLmFkZFYoXCJGZWVkYmFja1wiKVxuICAgICAgICAucHJvcGVydHkoVC5pZCwgaWQpXG4gICAgICAgIC5wcm9wZXJ0eShcInJhdGluZ1wiLCBpbnB1dC5yYXRpbmcpXG4gICAgICAgIC5wcm9wZXJ0eShcImNvbW1lbnRcIiwgaW5wdXQuY29tbWVudCA/PyBcIlwiKVxuICAgICAgICAucHJvcGVydHkoXCJjcmVhdGVkQXRcIiwgbm93SXNvKCkpXG4gICAgICAgIC5hcyhcImZcIilcbiAgICAgICAgLlYobWUpXG4gICAgICAgIC5hZGRFKFwiTEVGVF9GRUVEQkFDS1wiKVxuICAgICAgICAudG8oXCJmXCIpXG4gICAgICAgIC5WKGlucHV0LmV2ZW50SWQpXG4gICAgICAgIC5hZGRFKFwiQUJPVVRcIilcbiAgICAgICAgLmZyb21fKFwiZlwiKVxuICAgICAgICAuaXRlcmF0ZSgpO1xuICAgICAgcmV0dXJuIHsgaWQgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwicmVxdWVzdENvbm5lY3Rpb25cIjoge1xuICAgICAgY29uc3QgdGFyZ2V0ID0gYXJncy50YXJnZXRNZW1iZXJJZDtcbiAgICAgIGlmICh0YXJnZXQgPT09IG1lKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgY29ubmVjdCB0byB5b3Vyc2VsZlwiKTtcblxuICAgICAgLy8gRXhpc3RpbmcgZWRnZSBlaXRoZXIgZGlyZWN0aW9uP1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBnXG4gICAgICAgIC5WKG1lKVxuICAgICAgICAuYm90aEUoXCJDT05ORUNURURfV0lUSFwiKVxuICAgICAgICAud2hlcmUoX18ub3RoZXJWKCkuaGFzSWQodGFyZ2V0KSlcbiAgICAgICAgLmVsZW1lbnRNYXAoKVxuICAgICAgICAuZm9sZCgpXG4gICAgICAgIC5uZXh0KCk7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShleGlzdGluZz8udmFsdWUpICYmIGV4aXN0aW5nLnZhbHVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIHsgdGFyZ2V0TWVtYmVySWQ6IHRhcmdldCwgY29ubmVjdGlvblN0YXR1czogXCJwZW5kaW5nX291dGdvaW5nXCIgfTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgZ1xuICAgICAgICAuVihtZSlcbiAgICAgICAgLmFkZEUoXCJDT05ORUNURURfV0lUSFwiKVxuICAgICAgICAudG8oX18uVih0YXJnZXQpKVxuICAgICAgICAucHJvcGVydHkoXCJzdGF0dXNcIiwgXCJwZW5kaW5nXCIpXG4gICAgICAgIC5wcm9wZXJ0eShcInJlcXVlc3RlZEF0XCIsIG5vd0lzbygpKVxuICAgICAgICAuaXRlcmF0ZSgpO1xuICAgICAgcmV0dXJuIHsgdGFyZ2V0TWVtYmVySWQ6IHRhcmdldCwgY29ubmVjdGlvblN0YXR1czogXCJwZW5kaW5nX291dGdvaW5nXCIgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwicmVzcG9uZFRvQ29ubmVjdGlvblwiOiB7XG4gICAgICBjb25zdCByZXF1ZXN0ZXIgPSBhcmdzLnJlcXVlc3RlcklkO1xuICAgICAgaWYgKGFyZ3MuYWNjZXB0KSB7XG4gICAgICAgIGF3YWl0IGdcbiAgICAgICAgICAuVihyZXF1ZXN0ZXIpXG4gICAgICAgICAgLm91dEUoXCJDT05ORUNURURfV0lUSFwiKVxuICAgICAgICAgIC53aGVyZShfXy5pblYoKS5oYXNJZChtZSkpXG4gICAgICAgICAgLnByb3BlcnR5KFwic3RhdHVzXCIsIFwiYWNjZXB0ZWRcIilcbiAgICAgICAgICAucHJvcGVydHkoXCJhY2NlcHRlZEF0XCIsIG5vd0lzbygpKVxuICAgICAgICAgIC5pdGVyYXRlKCk7XG4gICAgICAgIC8vIG1pcnJvciBlZGdlIHNvIGJpZGlyZWN0aW9uYWwgcXVlcmllcyB3b3JrXG4gICAgICAgIGF3YWl0IGdcbiAgICAgICAgICAuVihtZSlcbiAgICAgICAgICAuYWRkRShcIkNPTk5FQ1RFRF9XSVRIXCIpXG4gICAgICAgICAgLnRvKF9fLlYocmVxdWVzdGVyKSlcbiAgICAgICAgICAucHJvcGVydHkoXCJzdGF0dXNcIiwgXCJhY2NlcHRlZFwiKVxuICAgICAgICAgIC5wcm9wZXJ0eShcImFjY2VwdGVkQXRcIiwgbm93SXNvKCkpXG4gICAgICAgICAgLml0ZXJhdGUoKTtcbiAgICAgICAgcmV0dXJuIHsgdGFyZ2V0TWVtYmVySWQ6IHJlcXVlc3RlciwgY29ubmVjdGlvblN0YXR1czogXCJjb25uZWN0ZWRcIiB9O1xuICAgICAgfVxuICAgICAgYXdhaXQgZ1xuICAgICAgICAuVihyZXF1ZXN0ZXIpXG4gICAgICAgIC5vdXRFKFwiQ09OTkVDVEVEX1dJVEhcIilcbiAgICAgICAgLndoZXJlKF9fLmluVigpLmhhc0lkKG1lKSlcbiAgICAgICAgLmRyb3AoKVxuICAgICAgICAuaXRlcmF0ZSgpO1xuICAgICAgcmV0dXJuIHsgdGFyZ2V0TWVtYmVySWQ6IHJlcXVlc3RlciwgY29ubmVjdGlvblN0YXR1czogXCJub25lXCIgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwidXBkYXRlTWVtYmVyUHJvZmlsZVwiOiB7XG4gICAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgICAgbGV0IHEgPSBnLlYobWUpLmhhc0xhYmVsKFwiTWVtYmVyXCIpO1xuICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMoaW5wdXQpKSB7XG4gICAgICAgIGlmICh2ID09PSB1bmRlZmluZWQgfHwgdiA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICAgIHEgPSBxLnByb3BlcnR5KGssIHYgYXMgc3RyaW5nKTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHEuaXRlcmF0ZSgpO1xuICAgICAgcmV0dXJuIHsgaWQ6IG1lLCAuLi5pbnB1dCB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJjcmVhdGVFdmVudFwiOiB7XG4gICAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgICAgY29uc3QgaWQgPSBgZXZ0LSR7Y3J5cHRvLnJhbmRvbVVVSUQoKX1gO1xuICAgICAgYXdhaXQgZ1xuICAgICAgICAuYWRkVihcIkV2ZW50XCIpXG4gICAgICAgIC5wcm9wZXJ0eShULmlkLCBpZClcbiAgICAgICAgLnByb3BlcnR5KFwidGl0bGVcIiwgaW5wdXQudGl0bGUpXG4gICAgICAgIC5wcm9wZXJ0eShcImRlc2NyaXB0aW9uXCIsIGlucHV0LmRlc2NyaXB0aW9uKVxuICAgICAgICAucHJvcGVydHkoXCJzdGFydHNBdFwiLCBpbnB1dC5zdGFydHNBdClcbiAgICAgICAgLnByb3BlcnR5KFwiZW5kc0F0XCIsIGlucHV0LmVuZHNBdCA/PyBcIlwiKVxuICAgICAgICAucHJvcGVydHkoXCJ2ZW51ZVwiLCBpbnB1dC52ZW51ZSlcbiAgICAgICAgLnByb3BlcnR5KFwiY2l0eVwiLCBpbnB1dC5jaXR5ID8/IFwiXCIpXG4gICAgICAgIC5wcm9wZXJ0eShcImNyZWF0ZWRBdFwiLCBub3dJc28oKSlcbiAgICAgICAgLml0ZXJhdGUoKTtcbiAgICAgIGZvciAoY29uc3QgdmlkIG9mIGlucHV0LnZlbmRvcklkcyA/PyBbXSkge1xuICAgICAgICBhd2FpdCBnLlYoaWQpLmFkZEUoXCJGRUFUVVJFU1wiKS50byhfXy5WKHZpZCkpLml0ZXJhdGUoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGlkLFxuICAgICAgICB0aXRsZTogaW5wdXQudGl0bGUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbixcbiAgICAgICAgc3RhcnRzQXQ6IGlucHV0LnN0YXJ0c0F0LFxuICAgICAgICBlbmRzQXQ6IGlucHV0LmVuZHNBdCxcbiAgICAgICAgdmVudWU6IGlucHV0LnZlbnVlLFxuICAgICAgICBjaXR5OiBpbnB1dC5jaXR5LFxuICAgICAgICBzdGF0dXM6IG5ldyBEYXRlKGlucHV0LnN0YXJ0c0F0KS5nZXRUaW1lKCkgPj0gRGF0ZS5ub3coKSA/IFwidXBjb21pbmdcIiA6IFwicGFzdFwiLFxuICAgICAgICByc3ZwQ291bnQ6IDAsXG4gICAgICAgIGd1ZXN0Q291bnQ6IDAsXG4gICAgICAgIHZlbmRvcnM6IFtdLFxuICAgICAgICBjcmVhdGVkQXQ6IG5vd0lzbygpLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwidXBkYXRlRXZlbnRcIjoge1xuICAgICAgY29uc3QgeyBpbnB1dCB9ID0gYXJncztcbiAgICAgIGxldCBxID0gZy5WKGlucHV0LmlkKS5oYXNMYWJlbChcIkV2ZW50XCIpO1xuICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMoaW5wdXQpKSB7XG4gICAgICAgIGlmIChrID09PSBcImlkXCIgfHwgayA9PT0gXCJ2ZW5kb3JJZHNcIiB8fCB2ID09PSB1bmRlZmluZWQgfHwgdiA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICAgIHEgPSBxLnByb3BlcnR5KGssIHYgYXMgc3RyaW5nKTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHEuaXRlcmF0ZSgpO1xuICAgICAgaWYgKGlucHV0LnZlbmRvcklkcykge1xuICAgICAgICBhd2FpdCBnLlYoaW5wdXQuaWQpLm91dEUoXCJGRUFUVVJFU1wiKS5kcm9wKCkuaXRlcmF0ZSgpO1xuICAgICAgICBmb3IgKGNvbnN0IHZpZCBvZiBpbnB1dC52ZW5kb3JJZHMpIHtcbiAgICAgICAgICBhd2FpdCBnLlYoaW5wdXQuaWQpLmFkZEUoXCJGRUFUVVJFU1wiKS50byhfXy5WKHZpZCkpLml0ZXJhdGUoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHsgaWQ6IGlucHV0LmlkLCB0aXRsZTogaW5wdXQudGl0bGUgPz8gXCJcIiB9O1xuICAgIH1cblxuICAgIGNhc2UgXCJyZXF1ZXN0RXZlbnRWaWRlb1VwbG9hZFwiOiB7XG4gICAgICBjb25zdCBidWNrZXQgPSBwcm9jZXNzLmVudi5NRURJQV9CVUNLRVQ7XG4gICAgICBpZiAoIWJ1Y2tldCkgdGhyb3cgbmV3IEVycm9yKFwiTUVESUFfQlVDS0VUIGVudiBub3Qgc2V0XCIpO1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbiAgICAgIGNvbnN0IHsgUzNDbGllbnQsIFB1dE9iamVjdENvbW1hbmQgfSA9IChhd2FpdCBpbXBvcnQoXG4gICAgICAgIC8qIHdlYnBhY2tJZ25vcmU6IHRydWUgKi8gXCJAYXdzLXNkay9jbGllbnQtczNcIiBhcyBzdHJpbmdcbiAgICAgICkpIGFzIGFueTtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG4gICAgICBjb25zdCB7IGdldFNpZ25lZFVybCB9ID0gKGF3YWl0IGltcG9ydChcbiAgICAgICAgLyogd2VicGFja0lnbm9yZTogdHJ1ZSAqLyBcIkBhd3Mtc2RrL3MzLXJlcXVlc3QtcHJlc2lnbmVyXCIgYXMgc3RyaW5nXG4gICAgICApKSBhcyBhbnk7XG4gICAgICBjb25zdCBzMyA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcbiAgICAgIGNvbnN0IGtleSA9IGBldmVudHMvJHthcmdzLmV2ZW50SWR9L3ZpZGVvLm1wNGA7XG4gICAgICBjb25zdCB1cGxvYWRVcmwgPSBhd2FpdCBnZXRTaWduZWRVcmwoXG4gICAgICAgIHMzLFxuICAgICAgICBuZXcgUHV0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgQnVja2V0OiBidWNrZXQsXG4gICAgICAgICAgS2V5OiBrZXksXG4gICAgICAgICAgQ29udGVudFR5cGU6IFwidmlkZW8vbXA0XCIsXG4gICAgICAgIH0pLFxuICAgICAgICB7IGV4cGlyZXNJbjogOTAwIH0sXG4gICAgICApO1xuICAgICAgcmV0dXJuIHsgdXBsb2FkVXJsLCBrZXkgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiYXR0YWNoRXZlbnRWaWRlb1wiOiB7XG4gICAgICBhd2FpdCBnXG4gICAgICAgIC5WKGFyZ3MuZXZlbnRJZClcbiAgICAgICAgLmhhc0xhYmVsKFwiRXZlbnRcIilcbiAgICAgICAgLnByb3BlcnR5KFwidmlkZW9LZXlcIiwgYXJncy5rZXkpXG4gICAgICAgIC5pdGVyYXRlKCk7XG4gICAgICAvLyBFbWl0IHN5c3RlbSBmZWVkIGVudHJ5XG4gICAgICBjb25zdCBwb3N0SWQgPSBgcG9zdC0ke2NyeXB0by5yYW5kb21VVUlEKCl9YDtcbiAgICAgIGF3YWl0IGdcbiAgICAgICAgLmFkZFYoXCJQb3N0XCIpXG4gICAgICAgIC5wcm9wZXJ0eShULmlkLCBwb3N0SWQpXG4gICAgICAgIC5wcm9wZXJ0eShcImtpbmRcIiwgXCJzeXN0ZW1fbmV3X2V2ZW50X3ZpZGVvXCIpXG4gICAgICAgIC5wcm9wZXJ0eShcImJvZHlcIiwgXCJBIG5ldyBldmVudCByZWNvcmRpbmcgaXMgYXZhaWxhYmxlLlwiKVxuICAgICAgICAucHJvcGVydHkoXCJsaW5rZWRFdmVudElkXCIsIGFyZ3MuZXZlbnRJZClcbiAgICAgICAgLnByb3BlcnR5KFwiY3JlYXRlZEF0XCIsIG5vd0lzbygpKVxuICAgICAgICAuaXRlcmF0ZSgpO1xuICAgICAgcmV0dXJuIHsgaWQ6IGFyZ3MuZXZlbnRJZCwgdmlkZW9Vcmw6IG51bGwgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwic2VuZEV2ZW50UnN2cEVtYWlsc1wiOiB7XG4gICAgICBjb25zdCBxdWV1ZVVybCA9IHByb2Nlc3MuZW52LlJTVlBfUVVFVUVfVVJMO1xuICAgICAgaWYgKCFxdWV1ZVVybCkgdGhyb3cgbmV3IEVycm9yKFwiUlNWUF9RVUVVRV9VUkwgZW52IG5vdCBzZXRcIik7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxuICAgICAgY29uc3QgeyBTUVNDbGllbnQsIFNlbmRNZXNzYWdlQ29tbWFuZCB9ID0gKGF3YWl0IGltcG9ydChcbiAgICAgICAgLyogd2VicGFja0lnbm9yZTogdHJ1ZSAqLyBcIkBhd3Mtc2RrL2NsaWVudC1zcXNcIiBhcyBzdHJpbmdcbiAgICAgICkpIGFzIGFueTtcbiAgICAgIGNvbnN0IHNxcyA9IG5ldyBTUVNDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XG5cbiAgICAgIGNvbnN0IG1lbWJlcnMgPSBhd2FpdCBnLlYoKS5oYXNMYWJlbChcIk1lbWJlclwiKS5pZCgpLnRvTGlzdCgpO1xuICAgICAgbGV0IHNlbnQgPSAwO1xuICAgICAgbGV0IHNraXBwZWQgPSAwO1xuICAgICAgZm9yIChjb25zdCBtZW1iZXJJZCBvZiBtZW1iZXJzKSB7XG4gICAgICAgIGlmICghbWVtYmVySWQpIHtcbiAgICAgICAgICBza2lwcGVkKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdG9rZW4gPSBhd2FpdCBzaWduUnN2cFRva2VuKHtcbiAgICAgICAgICBldmVudElkOiBhcmdzLmV2ZW50SWQsXG4gICAgICAgICAgbWVtYmVySWQ6IFN0cmluZyhtZW1iZXJJZCksXG4gICAgICAgICAgZXhwOiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArIDYwICogNjAgKiAyNCAqIDMwLCAvLyAzMCBkYXlzXG4gICAgICAgIH0pO1xuICAgICAgICBhd2FpdCBzcXMuc2VuZChcbiAgICAgICAgICBuZXcgU2VuZE1lc3NhZ2VDb21tYW5kKHtcbiAgICAgICAgICAgIFF1ZXVlVXJsOiBxdWV1ZVVybCxcbiAgICAgICAgICAgIE1lc3NhZ2VCb2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgIGV2ZW50SWQ6IGFyZ3MuZXZlbnRJZCxcbiAgICAgICAgICAgICAgbWVtYmVySWQ6IFN0cmluZyhtZW1iZXJJZCksXG4gICAgICAgICAgICAgIHRva2VuLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgICAgIHNlbnQrKztcbiAgICAgIH1cbiAgICAgIHJldHVybiB7IHNlbnQsIHNraXBwZWQgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiY3JlYXRlVmVuZG9yXCI6IHtcbiAgICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgICBjb25zdCBpZCA9IGB2bmQtJHtjcnlwdG8ucmFuZG9tVVVJRCgpfWA7XG4gICAgICBhd2FpdCBnXG4gICAgICAgIC5hZGRWKFwiVmVuZG9yXCIpXG4gICAgICAgIC5wcm9wZXJ0eShULmlkLCBpZClcbiAgICAgICAgLnByb3BlcnR5KFwibmFtZVwiLCBpbnB1dC5uYW1lKVxuICAgICAgICAucHJvcGVydHkoXCJ0YWdsaW5lXCIsIGlucHV0LnRhZ2xpbmUgPz8gXCJcIilcbiAgICAgICAgLnByb3BlcnR5KFwiZGVzY3JpcHRpb25cIiwgaW5wdXQuZGVzY3JpcHRpb24gPz8gXCJcIilcbiAgICAgICAgLnByb3BlcnR5KFwibG9nb1VybFwiLCBpbnB1dC5sb2dvVXJsID8/IFwiXCIpXG4gICAgICAgIC5wcm9wZXJ0eShcIndlYnNpdGVcIiwgaW5wdXQud2Vic2l0ZSA/PyBcIlwiKVxuICAgICAgICAucHJvcGVydHkoXCJ0YWdzXCIsIChpbnB1dC50YWdzID8/IFtdKS5qb2luKFwifFwiKSlcbiAgICAgICAgLnByb3BlcnR5KFwiY3JlYXRlZEF0XCIsIG5vd0lzbygpKVxuICAgICAgICAuaXRlcmF0ZSgpO1xuICAgICAgY29uc3QgY29udGFjdHM6IHVua25vd25bXSA9IFtdO1xuICAgICAgZm9yIChjb25zdCBjIG9mIGlucHV0LmNvbnRhY3RzID8/IFtdKSB7XG4gICAgICAgIGNvbnN0IGNpZCA9IGB2Yy0ke2NyeXB0by5yYW5kb21VVUlEKCl9YDtcbiAgICAgICAgYXdhaXQgZ1xuICAgICAgICAgIC5hZGRWKFwiVmVuZG9yQ29udGFjdFwiKVxuICAgICAgICAgIC5wcm9wZXJ0eShULmlkLCBjaWQpXG4gICAgICAgICAgLnByb3BlcnR5KFwibmFtZVwiLCBjLm5hbWUpXG4gICAgICAgICAgLnByb3BlcnR5KFwicm9sZVwiLCBjLnJvbGUpXG4gICAgICAgICAgLnByb3BlcnR5KFwiZW1haWxcIiwgYy5lbWFpbClcbiAgICAgICAgICAucHJvcGVydHkoXCJwaG9uZVwiLCBjLnBob25lID8/IFwiXCIpXG4gICAgICAgICAgLmFzKFwidmNcIilcbiAgICAgICAgICAuVihpZClcbiAgICAgICAgICAuYWRkRShcIkhBU19DT05UQUNUXCIpXG4gICAgICAgICAgLnRvKFwidmNcIilcbiAgICAgICAgICAuaXRlcmF0ZSgpO1xuICAgICAgICBjb250YWN0cy5wdXNoKHsgaWQ6IGNpZCwgLi4uYyB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGlkLFxuICAgICAgICBuYW1lOiBpbnB1dC5uYW1lLFxuICAgICAgICB0YWdsaW5lOiBpbnB1dC50YWdsaW5lLFxuICAgICAgICBkZXNjcmlwdGlvbjogaW5wdXQuZGVzY3JpcHRpb24sXG4gICAgICAgIGxvZ29Vcmw6IGlucHV0LmxvZ29VcmwsXG4gICAgICAgIHdlYnNpdGU6IGlucHV0LndlYnNpdGUsXG4gICAgICAgIHRhZ3M6IGlucHV0LnRhZ3MsXG4gICAgICAgIGNvbnRhY3RzLFxuICAgICAgICBjcmVhdGVkQXQ6IG5vd0lzbygpLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwidXBkYXRlVmVuZG9yXCI6IHtcbiAgICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgICBsZXQgcSA9IGcuVihpbnB1dC5pZCkuaGFzTGFiZWwoXCJWZW5kb3JcIik7XG4gICAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhpbnB1dCkpIHtcbiAgICAgICAgaWYgKGsgPT09IFwiaWRcIiB8fCBrID09PSBcImNvbnRhY3RzXCIgfHwgdiA9PT0gdW5kZWZpbmVkIHx8IHYgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgICBpZiAoayA9PT0gXCJ0YWdzXCIpIHEgPSBxLnByb3BlcnR5KFwidGFnc1wiLCAodiBhcyBzdHJpbmdbXSkuam9pbihcInxcIikpO1xuICAgICAgICBlbHNlIHEgPSBxLnByb3BlcnR5KGssIHYgYXMgc3RyaW5nKTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHEuaXRlcmF0ZSgpO1xuICAgICAgcmV0dXJuIHsgaWQ6IGlucHV0LmlkLCBuYW1lOiBpbnB1dC5uYW1lID8/IFwiXCIgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwic3VibWl0UnN2cFwiOiB7XG4gICAgICBjb25zdCBwYXlsb2FkID0gYXdhaXQgdmVyaWZ5UnN2cFRva2VuKGFyZ3MudG9rZW4pO1xuICAgICAgaWYgKCFwYXlsb2FkKSB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIG9yIGV4cGlyZWQgUlNWUCB0b2tlblwiKTtcbiAgICAgIGNvbnN0IHsgZXZlbnRJZCwgbWVtYmVySWQgfSA9IHBheWxvYWQ7XG5cbiAgICAgIC8vIFVwc2VydCBSc3ZwIHZlcnRleFxuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBnXG4gICAgICAgIC5WKG1lbWJlcklkKVxuICAgICAgICAub3V0KFwiUlNWUERcIilcbiAgICAgICAgLmhhc0xhYmVsKFwiUnN2cFwiKVxuICAgICAgICAud2hlcmUoX18ub3V0KFwiRk9SXCIpLmhhc0lkKGV2ZW50SWQpKVxuICAgICAgICAuaWQoKVxuICAgICAgICAuZm9sZCgpXG4gICAgICAgIC5uZXh0KCk7XG4gICAgICBjb25zdCBleGlzdGluZ0lkID1cbiAgICAgICAgQXJyYXkuaXNBcnJheShleGlzdGluZz8udmFsdWUpICYmIGV4aXN0aW5nLnZhbHVlWzBdXG4gICAgICAgICAgPyBTdHJpbmcoZXhpc3RpbmcudmFsdWVbMF0pXG4gICAgICAgICAgOiBudWxsO1xuXG4gICAgICBjb25zdCBzdGF0dXNTdHIgPSBhcmdzLmF0dGVuZGluZyA/IFwieWVzXCIgOiBcIm5vXCI7XG4gICAgICBpZiAoZXhpc3RpbmdJZCkge1xuICAgICAgICBhd2FpdCBnXG4gICAgICAgICAgLlYoZXhpc3RpbmdJZClcbiAgICAgICAgICAucHJvcGVydHkoXCJzdGF0dXNcIiwgc3RhdHVzU3RyKVxuICAgICAgICAgIC5wcm9wZXJ0eShcImd1ZXN0c1wiLCBhcmdzLmd1ZXN0cylcbiAgICAgICAgICAucHJvcGVydHkoXCJ1cGRhdGVkQXRcIiwgbm93SXNvKCkpXG4gICAgICAgICAgLml0ZXJhdGUoKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBpZDogZXhpc3RpbmdJZCxcbiAgICAgICAgICBldmVudElkLFxuICAgICAgICAgIG1lbWJlcklkLFxuICAgICAgICAgIHN0YXR1czogc3RhdHVzU3RyLFxuICAgICAgICAgIGd1ZXN0czogYXJncy5ndWVzdHMsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBjb25zdCBuZXdJZCA9IGByc3ZwLSR7Y3J5cHRvLnJhbmRvbVVVSUQoKX1gO1xuICAgICAgYXdhaXQgZ1xuICAgICAgICAuYWRkVihcIlJzdnBcIilcbiAgICAgICAgLnByb3BlcnR5KFQuaWQsIG5ld0lkKVxuICAgICAgICAucHJvcGVydHkoXCJzdGF0dXNcIiwgc3RhdHVzU3RyKVxuICAgICAgICAucHJvcGVydHkoXCJndWVzdHNcIiwgYXJncy5ndWVzdHMpXG4gICAgICAgIC5wcm9wZXJ0eShcImNyZWF0ZWRBdFwiLCBub3dJc28oKSlcbiAgICAgICAgLmFzKFwiclwiKVxuICAgICAgICAuVihtZW1iZXJJZClcbiAgICAgICAgLmFkZEUoXCJSU1ZQRFwiKVxuICAgICAgICAudG8oXCJyXCIpXG4gICAgICAgIC5WKGV2ZW50SWQpXG4gICAgICAgIC5hZGRFKFwiRk9SXCIpXG4gICAgICAgIC5mcm9tXyhcInJcIilcbiAgICAgICAgLml0ZXJhdGUoKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGlkOiBuZXdJZCxcbiAgICAgICAgZXZlbnRJZCxcbiAgICAgICAgbWVtYmVySWQsXG4gICAgICAgIHN0YXR1czogc3RhdHVzU3RyLFxuICAgICAgICBndWVzdHM6IGFyZ3MuZ3Vlc3RzLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjYXNlIFwiaW52aXRlTWVtYmVyXCI6IHtcbiAgICAgIGNvbnN0IGNhbGxlciA9IGlkZW50aXR5O1xuICAgICAgY29uc3QgZ3JvdXBzID0gY2FsbGVyPy5ncm91cHMgPz8gW107XG4gICAgICBpZiAoIWdyb3Vwcy5pbmNsdWRlcyhcIkFkbWluXCIpICYmICFncm91cHMuaW5jbHVkZXMoXCJNZW1iZXJzaGlwQWRtaW5cIikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm90IGF1dGhvcml6ZWQgdG8gaW52aXRlIG1lbWJlcnNcIik7XG4gICAgICB9XG4gICAgICBjb25zdCBuYW1lID0gU3RyaW5nKGFyZ3M/Lm5hbWUgPz8gXCJcIikudHJpbSgpO1xuICAgICAgY29uc3QgZW1haWwgPSBTdHJpbmcoYXJncz8uZW1haWwgPz8gXCJcIikudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoIW5hbWUpIHRocm93IG5ldyBFcnJvcihcIm5hbWUgaXMgcmVxdWlyZWRcIik7XG4gICAgICBpZiAoIS9eW15cXHNAXStAW15cXHNAXStcXC5bXlxcc0BdKyQvLnRlc3QoZW1haWwpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkEgdmFsaWQgZW1haWwgYWRkcmVzcyBpcyByZXF1aXJlZFwiKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHVzZXJQb29sSWQgPSBwcm9jZXNzLmVudi5VU0VSX1BPT0xfSUQ7XG4gICAgICBpZiAoIXVzZXJQb29sSWQpIHRocm93IG5ldyBFcnJvcihcIlVTRVJfUE9PTF9JRCBpcyBub3QgY29uZmlndXJlZFwiKTtcblxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbiAgICAgIGNvbnN0IG1vZDogYW55ID0gYXdhaXQgaW1wb3J0KFxuICAgICAgICAvKiB3ZWJwYWNrSWdub3JlOiB0cnVlICovIFwiQGF3cy1zZGsvY2xpZW50LWNvZ25pdG8taWRlbnRpdHktcHJvdmlkZXJcIiBhcyBzdHJpbmdcbiAgICAgICk7XG4gICAgICBjb25zdCBjbGllbnQgPSBuZXcgbW9kLkNvZ25pdG9JZGVudGl0eVByb3ZpZGVyQ2xpZW50KHtcbiAgICAgICAgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFVzZSB0aGUgZW1haWwgYXMgdGhlIHVzZXJuYW1lIHNvIHRoZSBpbnZpdGF0aW9uIGVtYWlsIHRlbXBsYXRlJ3NcbiAgICAgIC8vIHt1c2VybmFtZX0gcGxhY2Vob2xkZXIgaXMgbWVhbmluZ2Z1bCBhbmQgdGhlIHVzZXIgc2lnbnMgaW4gd2l0aFxuICAgICAgLy8gdGhlaXIgYWRkcmVzcy5cbiAgICAgIGNvbnN0IHVzZXJuYW1lID0gZW1haWw7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNsaWVudC5zZW5kKFxuICAgICAgICAgIG5ldyBtb2QuQWRtaW5DcmVhdGVVc2VyQ29tbWFuZCh7XG4gICAgICAgICAgICBVc2VyUG9vbElkOiB1c2VyUG9vbElkLFxuICAgICAgICAgICAgVXNlcm5hbWU6IHVzZXJuYW1lLFxuICAgICAgICAgICAgRGVzaXJlZERlbGl2ZXJ5TWVkaXVtczogW1wiRU1BSUxcIl0sXG4gICAgICAgICAgICBGb3JjZUFsaWFzQ3JlYXRpb246IGZhbHNlLFxuICAgICAgICAgICAgVXNlckF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgICAgeyBOYW1lOiBcImVtYWlsXCIsIFZhbHVlOiBlbWFpbCB9LFxuICAgICAgICAgICAgICB7IE5hbWU6IFwiZW1haWxfdmVyaWZpZWRcIiwgVmFsdWU6IFwidHJ1ZVwiIH0sXG4gICAgICAgICAgICAgIHsgTmFtZTogXCJuYW1lXCIsIFZhbHVlOiBuYW1lIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG4gICAgICAgIGNvbnN0IGUgPSBlcnIgYXMgYW55O1xuICAgICAgICBpZiAoZT8ubmFtZSA9PT0gXCJVc2VybmFtZUV4aXN0c0V4Y2VwdGlvblwiKSB7XG4gICAgICAgICAgLy8gUmVzZW5kIHRoZSBpbnZpdGF0aW9uIGZvciB0aGUgZXhpc3RpbmcgKHVuY29uZmlybWVkKSB1c2VyLlxuICAgICAgICAgIGF3YWl0IGNsaWVudC5zZW5kKFxuICAgICAgICAgICAgbmV3IG1vZC5BZG1pbkNyZWF0ZVVzZXJDb21tYW5kKHtcbiAgICAgICAgICAgICAgVXNlclBvb2xJZDogdXNlclBvb2xJZCxcbiAgICAgICAgICAgICAgVXNlcm5hbWU6IHVzZXJuYW1lLFxuICAgICAgICAgICAgICBNZXNzYWdlQWN0aW9uOiBcIlJFU0VORFwiLFxuICAgICAgICAgICAgICBEZXNpcmVkRGVsaXZlcnlNZWRpdW1zOiBbXCJFTUFJTFwiXSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIEFkZCB0aGUgdXNlciB0byB0aGUgTWVtYmVyIGdyb3VwIHNvIHRoZWlyIHRva2VuIGNhcnJpZXMgdGhlIHJvbGUuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBjbGllbnQuc2VuZChcbiAgICAgICAgICBuZXcgbW9kLkFkbWluQWRkVXNlclRvR3JvdXBDb21tYW5kKHtcbiAgICAgICAgICAgIFVzZXJQb29sSWQ6IHVzZXJQb29sSWQsXG4gICAgICAgICAgICBVc2VybmFtZTogdXNlcm5hbWUsXG4gICAgICAgICAgICBHcm91cE5hbWU6IFwiTWVtYmVyXCIsXG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgLy8gSWRlbXBvdGVudCDigJQgaWdub3JlIFwiYWxyZWFkeSBpbiBncm91cFwiIGVycm9ycy5cbiAgICAgICAgY29uc29sZS53YXJuKFwiQWRtaW5BZGRVc2VyVG9Hcm91cCBmYWlsZWQgKGNvbnRpbnVpbmcpXCIsIGVycik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7IGVtYWlsLCB1c2VybmFtZSwgc3RhdHVzOiBcImludml0ZWRcIiB9O1xuICAgIH1cblxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbi8vIFNpbGVuY2UgdW51c2VkLWltcG9ydCB3YXJuaW5ncyBmb3IgZXhwb3J0cyBjb25zdW1lZCBieSB0aGUgTGFtYmRhcyBvbmx5Llxudm9pZCBQO1xuIl19