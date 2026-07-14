/**
 * Node.js entrypoint for the BookCafe Hono server.
 */

import { loadConfig } from "@bookcafe/config";
import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { parseServerCliOptions } from "./cli.js";

const cliOptions = parseServerCliOptions(process.argv.slice(2));
const config = loadConfig(cliOptions.configPath);
const app = createApp({
  configPath: cliOptions.configPath
});

serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port
  },
  (info) => {
    console.log(
      `BookCafe server listening on http://${info.address}:${info.port}`
    );
  }
);
