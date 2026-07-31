import { watch } from "vue";

interface PendingSessionRef {
  readonly value: {
    readonly isPending: boolean;
  };
}

interface SessionRef<State> {
  readonly value: State;
}

/**
 * Waits until a shared reactive session atom matches the requested state.
 */
export const waitForAuthSessionState = async <State>(
  session: SessionRef<State>,
  matches: (state: State) => boolean
): Promise<void> => {
  if (matches(session.value)) {
    return;
  }

  await new Promise<void>((resolve) => {
    const stop = watch(
      () => session.value,
      (state) => {
        if (matches(state)) {
          stop();
          resolve();
        }
      },
      { flush: "sync" }
    );
  });
};

/**
 * Waits for Better Auth's automatic session request to settle.
 *
 * Calling `refetch` while the initial request is pending aborts that request,
 * so route guards should wait for the shared session atom instead.
 */
export const waitForAuthSession = async (
  session: PendingSessionRef
): Promise<void> =>
  waitForAuthSessionState(session, (state) => !state.isPending);
