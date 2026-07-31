/**
 * Client-side route guard for every authenticated BookCafe page.
 *
 * @module
 */

import { getLoginRedirect } from "../utils/authRedirect";

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server || to.path === "/setup") {
    return;
  }

  const { session, waitForSession } = useBookAuth();
  await waitForSession();

  if (to.path === "/login") {
    return session.value.data?.user
      ? navigateTo(getLoginRedirect(to.query.redirect), { replace: true })
      : undefined;
  }

  if (!session.value.data?.user) {
    const { getSetupStatus } = useBookApi();

    try {
      const setup = await getSetupStatus();

      if (!setup.setupComplete) {
        return navigateTo("/setup");
      }
    } catch {
      // Authentication remains the safe fallback when setup status is unknown.
    }

    return navigateTo({
      path: "/login",
      query: { redirect: to.fullPath }
    });
  }
});
