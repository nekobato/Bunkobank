/** Pure build planning helpers for the packaged BookCafe server sidecar. */

/** Reads the Rust host target from `rustc -vV` output. */
export declare const parseRustHost: (output: string) => string;

/** Resolves Tauri's Rust target, falling back to the compiler host. */
export declare const resolveRustTarget: (options: {
  rustVersionOutput: string;
  tauriTargetTriple?: string;
}) => string;

/** Resolves the host-specific `pkg` target used by the Tauri sidecar. */
export declare const resolvePkgTarget: (environment: {
  platform: NodeJS.Platform;
  arch: string;
}) => string;

/** Resolves the package architecture encoded by a Rust host triple. */
export declare const resolveRustHostArch: (rustHost: string) => string;

/** Creates the deterministic Enhanced SEA packaging command for one host. */
export declare const createSidecarPackagePlan: (options: {
  platform: NodeJS.Platform;
  arch: string;
  rustHost: string;
  serverPackagePath: string;
  binariesDir: string;
}) => {
  outputPath: string;
  pkgArguments: string[];
};

/** Creates the pnpm command that stages a portable production server tree. */
export declare const createSidecarDeployPlan: (stageDir: string) => {
  arguments: string[];
};
