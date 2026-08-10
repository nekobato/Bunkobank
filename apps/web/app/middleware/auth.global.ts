/**
 * Route guard for every authenticated Bunkobank page.
 *
 * @module
 */

import { getLoginRedirect } from "../utils/authRedirect";

interface AuthSessionResponse {
  user?: unknown;
}

interface SetupStatusResponse {
  setupComplete: boolean;
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === "/setup") {
    return;
  }

  if (import.meta.server) {
    const requestFetch = useRequestFetch();
    const apiBase = useApiBase();
    const authenticated = await requestFetch<AuthSessionResponse | null>(
      `${apiBase}/auth/get-session`
    )
      .then((authSession) => Boolean(authSession?.user))
      .catch(() => false);

    if (to.path === "/login") {
      return authenticated
        ? navigateTo(getLoginRedirect(to.query.redirect), { replace: true })
        : undefined;
    }

    if (!authenticated) {
      const setup = await requestFetch<SetupStatusResponse>(
        `${apiBase}/setup/status`
      ).catch(() => null);

      if (setup && !setup.setupComplete) {
        return navigateTo("/setup");
      }

      return navigateTo({
        path: "/login",
        query: { redirect: to.fullPath }
      });
    }

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
