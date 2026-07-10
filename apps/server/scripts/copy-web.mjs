import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(scriptDir, "..");
const webPublicDir = resolve(serverDir, "../web/.output/public");
const targetDir = resolve(serverDir, "public");

if (!existsSync(webPublicDir)) {
  throw new Error(`Nuxt output was not found: ${webPublicDir}`);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(webPublicDir, targetDir, { recursive: true });
