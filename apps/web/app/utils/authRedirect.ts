const BUNKOBANK_ORIGIN = "http://bunkobank.local";

/**
 * Resolves an untrusted login redirect to a safe in-app destination.
 */
export const getLoginRedirect = (redirect: unknown): string => {
  if (typeof redirect !== "string") {
    return "/";
  }

  try {
    const destination = new URL(redirect, BUNKOBANK_ORIGIN);

    if (
      destination.origin !== BUNKOBANK_ORIGIN ||
      destination.pathname === "/login"
    ) {
      return "/";
    }

    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
};
