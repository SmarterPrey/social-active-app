import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_layout/graph")({
  beforeLoad: () => {
    throw redirect({ to: "/monitoring" });
  },
  component: () => null,
});
