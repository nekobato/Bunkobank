#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  decryptBec1File,
  inspectBec1File,
  openBec1Container
} from "./container.js";
import { Bec1Error } from "./errors.js";

const usage = `Usage:
  bunkobank-recover inspect <container.bbec> [--password-file <path>] [--json]
  bunkobank-recover decrypt <container.bbec> <output> --password-file <path>

The BUNKOBANK_RECOVERY_PASSWORD environment variable may be used instead of
--password-file. Passwords are deliberately not accepted as command arguments.`;

interface ParsedArguments {
  command: string | undefined;
  positional: string[];
  passwordFile?: string;
  json: boolean;
}

const parseArguments = (arguments_: string[]): ParsedArguments => {
  const [command, ...rest] = arguments_;
  const positional: string[] = [];
  let passwordFile: string | undefined;
  let json = false;

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--password-file") {
      passwordFile = rest[index + 1];
      if (!passwordFile) throw new Error("--password-file requires a path.");
      index += 1;
      continue;
    }
    if (argument?.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (argument !== undefined) positional.push(argument);
  }
  return { command, positional, passwordFile, json };
};

const readPassword = async (passwordFile?: string): Promise<string> => {
  if (passwordFile) {
    return (await readFile(passwordFile, "utf8")).replace(/\r?\n$/, "");
  }
  const password = process.env.BUNKOBANK_RECOVERY_PASSWORD;
  if (password !== undefined) return password;
  throw new Error(
    "A password is required via --password-file or BUNKOBANK_RECOVERY_PASSWORD."
  );
};

const print = (value: unknown, json: boolean): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  for (const [key, field] of Object.entries(value as object)) {
    process.stdout.write(`${key}: ${String(field)}\n`);
  }
};

const run = async (): Promise<void> => {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.command === "inspect" && arguments_.positional.length === 1) {
    const [inputPath] = arguments_.positional as [string];
    if (!arguments_.passwordFile && !process.env.BUNKOBANK_RECOVERY_PASSWORD) {
      print(await inspectBec1File(inputPath), arguments_.json);
      return;
    }
    const container = await openBec1Container(
      inputPath,
      await readPassword(arguments_.passwordFile)
    );
    try {
      print(
        { ...container.info, recovery: container.manifest },
        arguments_.json
      );
    } finally {
      await container.close();
    }
    return;
  }

  if (arguments_.command === "decrypt" && arguments_.positional.length === 2) {
    const [inputPath, outputPath] = arguments_.positional as [string, string];
    const recovery = await decryptBec1File({
      inputPath,
      outputPath,
      password: await readPassword(arguments_.passwordFile)
    });
    print({ outputPath, recovery }, arguments_.json);
    return;
  }

  throw new Error(usage);
};

run().catch((error: unknown) => {
  const prefix = error instanceof Bec1Error ? `${error.code}: ` : "";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${prefix}${message}\n`);
  process.exitCode = 1;
});
