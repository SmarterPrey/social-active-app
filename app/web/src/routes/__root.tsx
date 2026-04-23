import { AuthStore, useAuthStore } from "@/store/useAuthStore";
import { createRootRouteWithContext, Outlet, useRouterState } from "@tanstack/react-router";
import { LandingPage } from "@/components/LandingPage";
import { useState } from "react";

interface RouterContext {
  // The ReturnType of your useAuth hook or the value of your AuthContext
  auth: AuthStore;
}
export const isAuth = false;
export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
});

// Paths that render without auth (public) — keep in sync with any new public route groups.
const PUBLIC_PATH_PREFIXES = ["/rsvp", "/apply"];

function Root() {
  const auth = useAuthStore();
  const [showSignIn, setShowSignIn] = useState(false);
  // @ts-ignore — TanStack Router deep type instantiation (TS2589)
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPublicPath = PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p));

  return (
    <div className="min-h-screen w-dvw">
      {!auth.isAuth && !isPublicPath ? (
        <LandingPage
          onSignIn={() => setShowSignIn(true)}
          showSignIn={showSignIn}
          onBack={() => setShowSignIn(false)}
        />
      ) : (
        <>
          <Outlet />
        </>
      )}
    </div>
  );
}
