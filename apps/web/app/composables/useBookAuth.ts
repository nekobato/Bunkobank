import { createAuthClient } from "better-auth/vue";
import { usernameClient } from "better-auth/client/plugins";

import {
  waitForAuthSession,
  waitForAuthSessionState
} from "../utils/authSession";

interface UsernameSignInInput {
  username: string;
  password: string;
}

/**
 * Creates the Better Auth Vue client for a BookCafe API base URL.
 */
const createBookAuthClient = (apiBase: string) => {
  const authPath = `${apiBase}/auth`;

  return createAuthClient({
    ...(isAbsoluteUrl(apiBase)
      ? { baseURL: authPath }
      : { basePath: authPath }),
    plugins: [usernameClient()]
  });
};

type BookAuthClient = ReturnType<typeof createBookAuthClient>;

let cachedApiBase = "";
let cachedAuthClient: BookAuthClient | null = null;

/**
 * Returns a cached Better Auth client for the active API base URL.
 */
const getBookAuthClient = (apiBase: string): BookAuthClient => {
  if (!cachedAuthClient || cachedApiBase !== apiBase) {
    cachedApiBase = apiBase;
    cachedAuthClient = createBookAuthClient(apiBase);
  }

  return cachedAuthClient;
};

/**
 * Returns true when a URL includes an HTTP protocol.
 */
const isAbsoluteUrl = (url: string): boolean =>
  url.startsWith("http://") || url.startsWith("https://");

/**
 * Creates small authentication helpers for the BookCafe frontend.
 */
export const useBookAuth = () => {
  const authClient = getBookAuthClient(useApiBase());
  const session = authClient.useSession();

  /**
   * Signs in with the username plugin and refreshes the shared session atom.
   */
  const signInWithUsername = async (input: UsernameSignInInput) => {
    const result = await authClient.signIn.username({
      ...input,
      rememberMe: true,
      fetchOptions: {
        disableSignal: true
      }
    });

    if (!result.error) {
      await session.value.refetch();
    }

    return result;
  };

  /**
   * Signs out and waits for Better Auth's cross-tab session signal.
   */
  const signOut = async () => {
    const result = await authClient.signOut();

    if (!result.error) {
      await waitForAuthSessionState(
        session,
        (state) =>
          (!state.isPending && !state.isRefetching && !state.data?.user) ||
          Boolean(state.error)
      );
    }

    return result;
  };

  /** Waits for the shared automatic session request without starting another. */
  const waitForSession = (): Promise<void> => waitForAuthSession(session);

  return {
    authClient,
    session,
    signInWithUsername,
    signOut,
    waitForSession
  };
};
