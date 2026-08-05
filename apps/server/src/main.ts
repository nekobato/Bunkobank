/**
 * Node.js entrypoint for the Bunkobank Hono server.
 */

import {
  getDefaultStateDir,
  loadConfig,
  resolveStatePaths
} from "@bunkobank/config";
import { serve } from "@hono/node-server";

import { createApp } from "./library-app.js";
import { parseServerCliOptions } from "./cli.js";
import {
  readInitializationState,
  resolveEffectiveBindHost
} from "./initialization.js";
import { isPdfWorkerInvocation } from "./pdf-protocol.js";
import { runPdfWorker } from "./pdf-worker.js";

/**
 * Starts the long-lived HTTP server when this process is not a PDF worker.
 */
const startServer = (): void => {
  const cliOptions = parseServerCliOptions(process.argv.slice(2));
  const config = loadConfig(cliOptions.configPath);
  const stateDir = getDefaultStateDir();
  const initializationState = readInitializationState(
    resolveStatePaths(stateDir).databasePath
  );
  const hostname = resolveEffectiveBindHost(config.host, initializationState);
  const app = createApp({
    configPath: cliOptions.configPath,
    stateDir
  });

  if (initializationState.status === "unavailable") {
    console.error(
      "Bunkobank data is unavailable. The server is restricted to loopback.",
      initializationState.cause
    );
  }

  serve(
    {
      fetch: app.fetch,
      hostname,
      port: config.port
    },
    (info) => {
      console.log(
        `Bunkobank server listening on http://${info.address}:${info.port}`
      );
    }
  );
};

if (isPdfWorkerInvocation(process.argv.slice(2))) {
  await runPdfWorker().catch(() => {
    process.exitCode = 1;
  });
} else {
  startServer();
}
