// Data hooks for member networking pages.
//
// NOTE: For now these return MOCK data so the UI can be reviewed end-to-end.
// Once the Lambda resolvers in api/lambda/queryGraph.ts + mutationGraph.ts are
// extended with the new `event.field` cases (see api/graphql/schema.graphql),
// swap the mock bodies with `client.graphql({ query: ..., variables: ... })`
// calls following the pattern in src/lib/utils.ts.

import { useEffect, useState, useCallback } from "react";
import type {
  EventItem,
  EventStatus,
  FeedItem,
  Member,
  Vendor,
  Comment,
} from "@/types/social";

// ---------- mock data ----------------------------------------------------------

const MOCK_MEMBERS: Member[] = [
  {
    id: "m-001",
    name: "Alex Chen",
    title: "CISO",
    company: "Vanta Financial",
    bio: "Defensive security, zero-trust architecture, board-level risk reporting.",
    connectionStatus: "connected",
    email: "alex.chen@example.com",
    phone: "+1 415 555 0101",
  },
  {
    id: "m-002",
    name: "Priya Ramanathan",
    title: "VP Security Engineering",
    company: "Helix Aero",
    bio: "Product security at scale. Former offensive red team lead.",
    connectionStatus: "none",
  },
  {
    id: "m-003",
    name: "Jordan Reyes",
    title: "Deputy CISO",
    company: "Northline Health",
    bio: "Healthcare, HITRUST, supply-chain risk.",
    connectionStatus: "pending_outgoing",
  },
  {
    id: "m-004",
    name: "Mika Tanaka",
    title: "Head of Cloud Security",
    company: "Orbit Logistics",
    bio: "Kubernetes, multi-cloud IAM, incident response automation.",
    connectionStatus: "pending_incoming",
  },
  {
    id: "m-005",
    name: "Dara Okafor",
    title: "CISO",
    company: "Meridian Energy",
    bio: "OT/ICS security, NERC CIP, critical infrastructure.",
    connectionStatus: "none",
  },
];

const MOCK_VENDORS: Vendor[] = [
  {
    id: "v-001",
    name: "Sentinel Labs",
    tagline: "Runtime detection for cloud-native workloads.",
    description:
      "Sentinel Labs delivers eBPF-based runtime detection across Kubernetes, serverless, and bare-metal hosts — with built-in SOAR hooks and a policy engine that speaks OPA.",
    tags: ["Runtime", "eBPF", "Cloud"],
    website: "https://example.com/sentinel",
    contacts: [
      { id: "c1", name: "Sam Patel", role: "sales", email: "sam@example.com", phone: "+1 650 555 0110" },
      { id: "c2", name: "Dr. Renee Lu", role: "technical_sales", email: "renee@example.com" },
    ],
    createdAt: "2026-03-12T10:00:00Z",
  },
  {
    id: "v-002",
    name: "Ironbark Identity",
    tagline: "Continuous identity posture for the modern enterprise.",
    description:
      "Continuous identity posture management across IdPs, SaaS, and cloud. Dormant-account hunting, privilege drift, and session risk scoring in one pane.",
    tags: ["IAM", "Zero-Trust"],
    contacts: [
      { id: "c3", name: "Noa Friedman", role: "sales", email: "noa@example.com" },
    ],
    createdAt: "2026-02-01T10:00:00Z",
  },
  {
    id: "v-003",
    name: "Fathom Threat Intel",
    tagline: "Curated threat intel for security executives.",
    description:
      "Executive-grade threat intel tailored to your sector. Monthly adversary briefings, custom campaign tracking, and a direct hotline to senior analysts.",
    tags: ["Threat Intel", "Briefings"],
    contacts: [
      { id: "c4", name: "Will Oduya", role: "sales", email: "will@example.com" },
      { id: "c5", name: "Theo Vasquez", role: "technical_sales", email: "theo@example.com" },
    ],
    createdAt: "2026-04-01T10:00:00Z",
  },
];

const MOCK_EVENTS: EventItem[] = [
  {
    id: "e-001",
    title: "Q2 Executive Roundtable — Identity & the AI Workforce",
    description:
      "A closed-door session on how agentic AI is reshaping identity, access, and audit. Includes two vendor deep-dives and a peer discussion.",
    startsAt: "2026-05-14T18:00:00-04:00",
    endsAt: "2026-05-14T21:00:00-04:00",
    venue: "The Pierre — 2 E 61st St",
    city: "New York, NY",
    status: "upcoming",
    rsvpCount: 24,
    guestCount: 6,
    vendors: [
      { id: "v-002", name: "Ironbark Identity", logoUrl: null },
      { id: "v-001", name: "Sentinel Labs", logoUrl: null },
    ],
    createdAt: "2026-04-01T12:00:00Z",
  },
  {
    id: "e-002",
    title: "Threat Intel Briefing — Spring 2026",
    description: "Quarterly adversary briefing with Fathom Threat Intel.",
    startsAt: "2026-06-02T17:30:00-07:00",
    endsAt: "2026-06-02T20:00:00-07:00",
    venue: "Nobu Palo Alto",
    city: "Palo Alto, CA",
    status: "upcoming",
    rsvpCount: 11,
    guestCount: 2,
    vendors: [{ id: "v-003", name: "Fathom Threat Intel", logoUrl: null }],
    createdAt: "2026-04-10T12:00:00Z",
  },
  {
    id: "e-100",
    title: "Winter 2026 CISO Dinner — Boston",
    description:
      "Executive discussion on SEC disclosure rules, with a runtime security demo from Sentinel Labs.",
    startsAt: "2026-02-12T18:00:00-05:00",
    endsAt: "2026-02-12T21:00:00-05:00",
    venue: "Menton",
    city: "Boston, MA",
    status: "past",
    rsvpCount: 31,
    guestCount: 8,
    vendors: [{ id: "v-001", name: "Sentinel Labs", logoUrl: null }],
    videoUrl: "https://example.com/recordings/ciso-dinner-boston-2026-02.mp4",
    createdAt: "2026-01-10T12:00:00Z",
  },
];

const MOCK_COMMENTS: Comment[] = [
  {
    id: "cm-1",
    authorId: "m-001",
    authorName: "Alex Chen",
    body: "The Sentinel eBPF demo alone was worth the trip.",
    createdAt: "2026-02-13T14:02:00Z",
  },
  {
    id: "cm-2",
    authorId: "m-005",
    authorName: "Dara Okafor",
    body: "Agreed — would love a follow-up session focused on OT environments.",
    createdAt: "2026-02-13T15:10:00Z",
  },
];

const MOCK_FEED: FeedItem[] = [
  {
    id: "f-1",
    kind: "system_new_event_video",
    authorName: "Event team",
    body: "Video posted: Winter 2026 CISO Dinner — Boston",
    createdAt: "2026-02-16T12:00:00Z",
    commentCount: MOCK_COMMENTS.length,
    likeCount: 9,
    likedByMe: false,
    linkedEventId: "e-100",
    comments: MOCK_COMMENTS,
  },
  {
    id: "f-2",
    kind: "system_new_vendor",
    authorName: "Event team",
    body: "New vendor joined: Fathom Threat Intel — curated executive threat briefings.",
    createdAt: "2026-04-01T10:05:00Z",
    commentCount: 1,
    likeCount: 4,
    likedByMe: true,
    linkedVendorId: "v-003",
  },
  {
    id: "f-3",
    kind: "member_post",
    authorId: "m-002",
    authorName: "Priya Ramanathan",
    body: "Anyone here tried rolling passkey-only auth for executive assistants? Looking for war stories before we commit.",
    createdAt: "2026-04-18T16:30:00Z",
    commentCount: 3,
    likeCount: 7,
    likedByMe: false,
  },
];

// ---------- hooks --------------------------------------------------------------

function useAsyncState<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    loader()
      .then((v) => setData(v))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  return { data, loading, error, reload, setData };
}

const fakeLatency = <T>(value: T, ms = 120) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

export function useFeed() {
  // TODO: replace with client.graphql({ query: listFeed }) wired via src/lib/utils.ts
  return useAsyncState(() => fakeLatency(MOCK_FEED));
}

export function useEvents(status: EventStatus) {
  return useAsyncState(
    () => fakeLatency(MOCK_EVENTS.filter((e) => e.status === status)),
    [status],
  );
}

export function useEvent(id: string | undefined) {
  return useAsyncState(
    () => fakeLatency(MOCK_EVENTS.find((e) => e.id === id) ?? null),
    [id],
  );
}

export function useVendors() {
  return useAsyncState(() => fakeLatency(MOCK_VENDORS));
}

export function useVendor(id: string | undefined) {
  return useAsyncState(
    () => fakeLatency(MOCK_VENDORS.find((v) => v.id === id) ?? null),
    [id],
  );
}

export function useMembers(search: string) {
  return useAsyncState(
    () =>
      fakeLatency(
        MOCK_MEMBERS.filter((m) => {
          const q = search.trim().toLowerCase();
          if (!q) return true;
          return (
            m.name.toLowerCase().includes(q) ||
            (m.company ?? "").toLowerCase().includes(q) ||
            (m.title ?? "").toLowerCase().includes(q)
          );
        }),
      ),
    [search],
  );
}

export function useMember(id: string | undefined) {
  return useAsyncState(
    () => fakeLatency(MOCK_MEMBERS.find((m) => m.id === id) ?? null),
    [id],
  );
}
