const BOOKCAFE_ORIGIN = "http://bookcafe.local";

/**
 * Resolves an untrusted login redirect to a safe in-app destination.
 */
export const getLoginRedirect = (redirect: unknown): string => {
  if (typeof redirect !== "string") {
    return "/";
  }

  try {
    const destination = new URL(redirect, BOOKCAFE_ORIGIN);

    if (
      destination.origin !== BOOKCAFE_ORIGIN ||
      destination.pathname === "/login"
    ) {
      return "/";
    }

    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
};
