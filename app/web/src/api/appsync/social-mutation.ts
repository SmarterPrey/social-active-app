// GraphQL mutations for member networking features.

export const createPost = /* GraphQL */ `
  mutation CreatePost($body: String!) {
    createPost(body: $body) {
      id
      kind
      authorId
      authorName
      body
      createdAt
      commentCount
      likeCount
      likedByMe
    }
  }
`;

export const createComment = /* GraphQL */ `
  mutation CreateComment($input: CreateCommentInput!) {
    createComment(input: $input) {
      id
      authorId
      authorName
      authorAvatarUrl
      body
      createdAt
    }
  }
`;

export const toggleLike = /* GraphQL */ `
  mutation ToggleLike($postId: ID!) {
    toggleLike(postId: $postId) {
      id
      likeCount
      likedByMe
    }
  }
`;

export const submitFeedback = /* GraphQL */ `
  mutation SubmitFeedback($input: SubmitFeedbackInput!) {
    submitFeedback(input: $input) {
      id
    }
  }
`;

export const requestConnection = /* GraphQL */ `
  mutation RequestConnection($targetMemberId: ID!) {
    requestConnection(targetMemberId: $targetMemberId) {
      targetMemberId
      connectionStatus
    }
  }
`;

export const respondToConnection = /* GraphQL */ `
  mutation RespondToConnection($requesterId: ID!, $accept: Boolean!) {
    respondToConnection(requesterId: $requesterId, accept: $accept) {
      targetMemberId
      connectionStatus
    }
  }
`;

export const updateMemberProfile = /* GraphQL */ `
  mutation UpdateMemberProfile($input: UpdateMemberProfileInput!) {
    updateMemberProfile(input: $input) {
      id
      name
      title
      company
      bio
    }
  }
`;

// Admin-only (Cognito group: Admin)
export const createEvent = /* GraphQL */ `
  mutation CreateEvent($input: CreateEventInput!) {
    createEvent(input: $input) {
      id
      title
      startsAt
    }
  }
`;

export const updateEvent = /* GraphQL */ `
  mutation UpdateEvent($input: UpdateEventInput!) {
    updateEvent(input: $input) {
      id
      title
    }
  }
`;

export const requestEventVideoUpload = /* GraphQL */ `
  mutation RequestEventVideoUpload($eventId: ID!, $contentType: String!) {
    requestEventVideoUpload(eventId: $eventId, contentType: $contentType) {
      uploadUrl
      key
    }
  }
`;

export const attachEventVideo = /* GraphQL */ `
  mutation AttachEventVideo($eventId: ID!, $key: String!) {
    attachEventVideo(eventId: $eventId, key: $key) {
      id
      videoUrl
    }
  }
`;

export const sendEventRsvpEmails = /* GraphQL */ `
  mutation SendEventRsvpEmails($eventId: ID!) {
    sendEventRsvpEmails(eventId: $eventId) {
      sent
      skipped
    }
  }
`;

export const createVendor = /* GraphQL */ `
  mutation CreateVendor($input: CreateVendorInput!) {
    createVendor(input: $input) {
      id
      name
    }
  }
`;

export const updateVendor = /* GraphQL */ `
  mutation UpdateVendor($input: UpdateVendorInput!) {
    updateVendor(input: $input) {
      id
      name
    }
  }
`;

// Public — API-key auth, JWT in token verified in resolver
export const submitRsvp = /* GraphQL */ `
  mutation SubmitRsvp($token: String!, $attending: Boolean!, $guests: Int!) {
    submitRsvp(token: $token, attending: $attending, guests: $guests) {
      id
      status
      guests
    }
  }
`;

export const inviteMember = /* GraphQL */ `
  mutation InviteMember($name: String!, $email: String!, $note: String) {
    inviteMember(name: $name, email: $email, note: $note) {
      email
      username
      status
    }
  }
`;
