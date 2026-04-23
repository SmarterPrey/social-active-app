// Shared domain types for member networking features (feed, events, vendors, members).
// These mirror the GraphQL schema in api/graphql/schema.graphql.

export interface Member {
  id: string;
  name: string;
  title?: string | null;
  company?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  // Private contact — null unless the current user is connected to this member.
  email?: string | null;
  phone?: string | null;
  connectionStatus?: "none" | "pending_outgoing" | "pending_incoming" | "connected";
}

export interface VendorContact {
  id: string;
  name: string;
  role: "sales" | "technical_sales";
  email: string;
  phone?: string | null;
}

export interface Vendor {
  id: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  website?: string | null;
  tags: string[];
  presentationVideoUrl?: string | null;
  contacts: VendorContact[];
  createdAt: string;
}

export type EventStatus = "upcoming" | "past";

export interface EventItem {
  id: string;
  title: string;
  description: string;
  startsAt: string; // ISO
  endsAt?: string | null;
  venue: string;
  city?: string | null;
  status: EventStatus;
  rsvpCount: number;
  guestCount: number;
  vendors: Pick<Vendor, "id" | "name" | "logoUrl">[];
  videoUrl?: string | null; // CloudFront signed URL, set only for past events with video
  createdAt: string;
  comments?: Comment[];
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  body: string;
  createdAt: string;
}

export type FeedItemKind =
  | "member_post"
  | "system_new_vendor"
  | "system_new_event_video";

export interface FeedItem {
  id: string;
  kind: FeedItemKind;
  authorId?: string | null; // null for system posts
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  body: string;
  createdAt: string;
  commentCount: number;
  likeCount: number;
  likedByMe: boolean;
  // Linked target for system posts.
  linkedVendorId?: string | null;
  linkedEventId?: string | null;
  comments?: Comment[];
}

export interface Feedback {
  id: string;
  eventId: string;
  memberId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string | null;
  vendorApproval: { vendorId: string; approved: boolean }[];
}

export interface Rsvp {
  id: string;
  eventId: string;
  memberId: string;
  status: "yes" | "no" | "pending";
  guests: number;
  respondedAt?: string | null;
}
