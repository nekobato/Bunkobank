/**
 * Client-side route guard for every authenticated BookCafe page.
 *
 * @module
 */

const publicPaths = new Set(["/login", "/setup"]);

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server || publicPaths.has(to.path)) {
    return;
  }

  const { session } = useBookAuth();

  if (session.value.isPending) {
    await session.value.refetch();
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
