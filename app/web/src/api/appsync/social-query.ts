// GraphQL queries and mutations for the member networking features.
// Resolvers are dispatched inside api/lambda/queryGraph.ts and mutationGraph.ts
// by `event.field`, following the existing Gremlin pattern.

export const listFeed = /* GraphQL */ `
  query ListFeed($limit: Int, $cursor: String) {
    listFeed(limit: $limit, cursor: $cursor) {
      items {
        id
        kind
        authorId
        authorName
        authorAvatarUrl
        body
        createdAt
        commentCount
        likeCount
        likedByMe
        linkedVendorId
        linkedEventId
      }
      nextCursor
    }
  }
`;

export const getPost = /* GraphQL */ `
  query GetPost($id: ID!) {
    getPost(id: $id) {
      id
      kind
      authorId
      authorName
      authorAvatarUrl
      body
      createdAt
      commentCount
      likeCount
      likedByMe
      linkedVendorId
      linkedEventId
      comments {
        id
        authorId
        authorName
        authorAvatarUrl
        body
        createdAt
      }
    }
  }
`;

export const listEvents = /* GraphQL */ `
  query ListEvents($status: EventStatus!) {
    listEvents(status: $status) {
      id
      title
      startsAt
      endsAt
      venue
      city
      status
      rsvpCount
      guestCount
      videoUrl
      vendors {
        id
        name
        logoUrl
      }
    }
  }
`;

export const getEvent = /* GraphQL */ `
  query GetEvent($id: ID!) {
    getEvent(id: $id) {
      id
      title
      description
      startsAt
      endsAt
      venue
      city
      status
      rsvpCount
      guestCount
      videoUrl
      vendors {
        id
        name
        tagline
        logoUrl
      }
      comments {
        id
        authorId
        authorName
        authorAvatarUrl
        body
        createdAt
      }
    }
  }
`;

export const listVendors = /* GraphQL */ `
  query ListVendors {
    listVendors {
      id
      name
      tagline
      logoUrl
      tags
    }
  }
`;

export const getVendor = /* GraphQL */ `
  query GetVendor($id: ID!) {
    getVendor(id: $id) {
      id
      name
      tagline
      description
      logoUrl
      website
      tags
      presentationVideoUrl
      contacts {
        id
        name
        role
        email
        phone
      }
      comments {
        id
        authorId
        authorName
        authorAvatarUrl
        body
        createdAt
      }
    }
  }
`;

export const listMembers = /* GraphQL */ `
  query ListMembers($search: String) {
    listMembers(search: $search) {
      id
      name
      title
      company
      avatarUrl
      connectionStatus
    }
  }
`;

export const getMember = /* GraphQL */ `
  query GetMember($id: ID!) {
    getMember(id: $id) {
      id
      name
      title
      company
      bio
      avatarUrl
      email
      phone
      connectionStatus
    }
  }
`;

export const getRsvpByToken = /* GraphQL */ `
  query GetRsvpByToken($token: String!) {
    getRsvpByToken(token: $token) {
      event {
        id
        title
        startsAt
        endsAt
        venue
        city
      }
      member {
        id
        name
      }
      rsvp {
        id
        status
        guests
      }
    }
  }
`;
