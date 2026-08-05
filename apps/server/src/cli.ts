/**
 * CLI argument parsing for the Bunkobank server process.
 */

export interface ServerCliOptions {
  configPath?: string;
}

/**
 * Parses command-line flags supported by the server entrypoint.
 */
export const parseServerCliOptions = (argv: string[]): ServerCliOptions => {
  const options: ServerCliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";

    if (argument === "--config") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--config requires a path.");
      }

      options.configPath = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--config=")) {
      const value = argument.slice("--config=".length);

      if (!value) {
        throw new Error("--config requires a path.");
      }

      options.configPath = value;
    }
  }

  return options;
};
