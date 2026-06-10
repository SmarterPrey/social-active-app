// Set up a Router instance
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen.js";
``;
export const router = createRouter({
  routeTree,
  context: {
    // @ts-expect-error — auth is populated at runtime by RouterProvider context
    auth: undefined,
  },
});
