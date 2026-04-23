import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import type { AppRole } from "@/store/useAuthStore";

// src/routes/_authenticated.tsx
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    // Fast path: in-memory store already knows we're authenticated
    if (context.auth.isAuth) return;

    // On page reload the store resets, but Amplify persists tokens in
    // localStorage. Check for a live session before bouncing to sign-in.
    try {
      const session = await fetchAuthSession();
      if (session.tokens) {
        context.auth.setIsAuthenticated(true);
        // Restore roles from the JWT on reload
        const groups = (session.tokens.idToken?.payload["cognito:groups"] as AppRole[]) ?? [];
        context.auth.setRoles(groups);
        // Restore username on reload
        try {
          const { username } = await getCurrentUser();
          context.auth.setUser(username);
        } catch { /* non-critical */ }
        // On refresh, redirect to home instead of staying on the deep route
        if (location.pathname !== "/") {
          throw redirect({ to: "/" });
        }
        return;
      }
    } catch (e) {
      // If it's a redirect, re-throw it
      if (e instanceof Response || (e && typeof e === "object" && "to" in e)) throw e;
      // No valid session — fall through to redirect
    }

    throw redirect({
      // @ts-ignore
      to: "/signin",
    });
  },
});
