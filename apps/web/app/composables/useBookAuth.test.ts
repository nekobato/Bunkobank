import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => {
  const refetch = vi.fn(async () => undefined);
  const session = {
    value: {
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch
    }
  };

  return {
    refetch,
    session,
    signInWithUsername: vi.fn(),
    signOut: vi.fn(),
    useSession: vi.fn(() => session)
  };
});

const sessionWaitMocks = vi.hoisted(() => ({
  waitForAuthSession: vi.fn(async () => undefined),
  waitForAuthSessionState: vi.fn(async () => undefined)
}));

vi.mock("better-auth/vue", () => ({
  createAuthClient: vi.fn(() => ({
    signIn: {
      username: authMocks.signInWithUsername
    },
    signOut: authMocks.signOut,
    useSession: authMocks.useSession
  }))
}));

vi.mock("better-auth/client/plugins", () => ({
  usernameClient: vi.fn(() => ({ id: "username" }))
}));

vi.mock("../utils/authSession", () => sessionWaitMocks);

import { useBookAuth } from "./useBookAuth";

describe("useBookAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("useApiBase", () => "/api");
  });

  it("refreshes the session exactly once after username sign-in", async () => {
    authMocks.signInWithUsername.mockResolvedValueOnce({
      data: {},
      error: null
    });
    const { signInWithUsername } = useBookAuth();

    await signInWithUsername({
      username: "reader",
      password: "password"
    });

    expect(authMocks.signInWithUsername).toHaveBeenCalledWith({
      username: "reader",
      password: "password",
      rememberMe: true,
      fetchOptions: {
        disableSignal: true
      }
    });
    expect(authMocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("preserves Better Auth's automatic cross-tab sign-out signal", async () => {
    authMocks.signOut.mockResolvedValueOnce({
      data: { success: true },
      error: null
    });
    const { signOut } = useBookAuth();

    await signOut();

    expect(authMocks.signOut).toHaveBeenCalledWith();
    expect(sessionWaitMocks.waitForAuthSessionState).toHaveBeenCalledTimes(1);
    expect(authMocks.refetch).not.toHaveBeenCalled();
  });
});
