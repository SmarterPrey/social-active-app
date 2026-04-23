# Role-Based Access Control (RBAC)

The application uses **Cognito User Pool Groups** to implement role-based access control across the API and frontend.

## Roles

| Role | Precedence | Description |
|------|-----------|-------------|
| **Admin** | 0 | Full access — mutations, deletions, monitoring, user management |
| **Editor** | 10 | Can add and modify graph data (vertices, edges, project accounts) |
| **Viewer** | 20 | Read-only access to dashboards, graph visualization, and search |

Roles are defined as Cognito groups in [`lib/constructs/cognito.ts`](../lib/constructs/cognito.ts). The initial admin user (configured via `adminEmail` in [`config.ts`](../config.ts)) is automatically added to the `Admin` group on stack creation.

## API Authorization

GraphQL authorization is enforced at the AppSync layer via schema directives in [`api/graphql/schema.graphql`](../api/graphql/schema.graphql):

| Operation | Allowed Roles |
|-----------|---------------|
| All queries (read) | Any authenticated user |
| `insertData` | Admin, Editor |
| `addProjectAccount` | Admin, Editor |
| `deleteProjectAccount` | Admin only |

Unauthorized mutations return an AppSync authorization error — no custom Lambda logic required.

## Frontend Enforcement

### Auth Store

Roles are stored in the Zustand auth store (`app/web/src/store/useAuthStore.ts`):

```ts
import { useHasRole } from "@/store/useAuthStore";

const canEdit = useHasRole("Admin", "Editor");
const isAdmin = useHasRole("Admin");
```

### When Roles Are Populated

- **On sign-in**: Read from the `cognito:groups` claim in the JWT ID token
- **On page reload**: Restored from the persisted Amplify session in the `_authenticated` route guard

### Navigation Gating

The sidebar in `RootLayout.tsx` conditionally renders nav items:

- **Add Vertex/Edge** — visible to `Admin` and `Editor` only
- **Monitoring** — visible to `Admin` only
- **All other pages** — visible to all authenticated users

## Managing Roles

### AWS Console

1. Go to **Cognito → User Pools → select pool → Groups**
2. Click a group (e.g., `Editor`)
3. Add or remove users

### AWS CLI

```bash
# Add a user to a group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <USER_POOL_ID> \
  --username <EMAIL_OR_USERNAME> \
  --group-name Editor

# Remove a user from a group
aws cognito-idp admin-remove-user-from-group \
  --user-pool-id <USER_POOL_ID> \
  --username <EMAIL_OR_USERNAME> \
  --group-name Editor

# List users in a group
aws cognito-idp list-users-in-group \
  --user-pool-id <USER_POOL_ID> \
  --group-name Admin
```

### Self-registered Users

Users who self-register are not assigned to any group by default. An Admin must assign them a role before they can perform write operations. Read-only access (queries, graph visualization) works without any group membership.

## Adding New Roles

1. Add a `CfnUserPoolGroup` in [`lib/constructs/cognito.ts`](../lib/constructs/cognito.ts)
2. Add the group name to the `AppRole` type in `app/web/src/store/useAuthStore.ts`
3. Update `@aws_auth(cognito_groups: [...])` directives in the GraphQL schema as needed
4. Use `useHasRole("NewRole")` in frontend components to gate UI
