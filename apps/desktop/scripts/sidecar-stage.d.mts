/** Portable staging helpers for the packaged BookCafe server sidecar. */

/** Replaces pnpm virtual-store links with real top-level package directories. */
export declare const materializeSidecarStage: (stageDir: string) => number;
