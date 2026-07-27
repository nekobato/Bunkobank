/**
 * Shared application-shell navigation definitions and route matching.
 *
 * @module
 */

/** One primary destination rendered by the application shell. */
export interface AppNavigationItem {
  label: string;
  to: string;
  group: "browse" | "manage";
}

/** Primary destinations from the README Web UI plan. */
export const appNavigationItems = [
  {
    label: "ライブラリ",
    to: "/",
    group: "browse"
  },
  {
    label: "アーカイブ",
    to: "/archived",
    group: "browse"
  },
  {
    label: "設定",
    to: "/setup",
    group: "manage"
  }
] as const satisfies readonly AppNavigationItem[];

/**
 * Returns whether a navigation item represents the current route location.
 */
export const isAppNavigationItemActive = (
  item: AppNavigationItem,
  path: string,
  hash: string
): boolean => {
  const [targetPath, targetHash = ""] = item.to.split("#");

  if (targetHash) {
    return path === targetPath && hash === `#${targetHash}`;
  }

  if (item.to === "/") {
    return (path === "/" && !hash) || path.startsWith("/books/");
  }

  return path === item.to || path.startsWith(`${item.to}/`);
};

/**
 * Returns whether the route is the distraction-free book reader.
 */
export const isReaderRoute = (path: string): boolean =>
  /^\/books\/[^/]+\/read\/?$/.test(path);
