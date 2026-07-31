import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { waitForAuthSession, waitForAuthSessionState } from "./authSession";

describe("waitForAuthSession", () => {
  it("returns immediately after the session has settled", async () => {
    const session = ref({ isPending: false });

    await expect(waitForAuthSession(session)).resolves.toBeUndefined();
  });

  it("waits for the automatic session request without starting another", async () => {
    const refetch = vi.fn();
    const session = ref({ isPending: true, refetch });
    let settled = false;
    const pending = waitForAuthSession(session).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    session.value = { isPending: false, refetch };
    await pending;

    expect(settled).toBe(true);
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe("waitForAuthSessionState", () => {
  it("waits for the requested session state", async () => {
    const session = ref<{
      data: { user: { id: string } } | null;
      isPending: boolean;
      isRefetching: boolean;
    }>({
      data: { user: { id: "reader" } },
      isPending: false,
      isRefetching: false
    });
    let settled = false;
    const pending = waitForAuthSessionState(
      session,
      (state) => !state.isRefetching && !state.data
    ).then(() => {
      settled = true;
    });

    session.value = {
      data: { user: { id: "reader" } },
      isPending: false,
      isRefetching: true
    };
    expect(settled).toBe(false);

    session.value = {
      data: null,
      isPending: false,
      isRefetching: false
    };
    await pending;

    expect(settled).toBe(true);
  });
});
