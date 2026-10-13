import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const requireFromNuxt = createRequire(require.resolve("nuxt/package.json"));
const devtoolsManifest = requireFromNuxt.resolve("@nuxt/devtools/package.json");

test("Nuxt DevTools Git consumer loads through native ESM", async () => {
  const consumer = pathToFileURL(
    join(dirname(devtoolsManifest), "dist/chunks/module-main.mjs")
  ).href;
  await execFileAsync(process.execPath, [
    "--input-type=module",
    "--eval",
    "await import(process.argv[1]);",
    consumer
  ]);
});

test("DevTools build naming keeps Git branch, revision and clean/dirty status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devtools-git-compat-"));
  try {
    await execFileAsync("git", ["init", "--initial-branch=main", directory]);
    await writeFile(join(directory, "fixture.txt"), "initial\n");
    await execFileAsync("git", ["-C", directory, "add", "fixture.txt"]);
    await execFileAsync("git", [
      "-C",
      directory,
      "-c",
      "user.name=Compatibility test",
      "-c",
      "user.email=tests@example.invalid",
      "commit",
      "-m",
      "Test fixture"
    ]);

    const inspect = async () => {
      const { stdout } = await execFileAsync(process.execPath, [
        "--input-type=module",
        "--eval",
        `
          import { createRequire } from "node:module";
          const { simpleGit } = createRequire(process.argv[1])("simple-git");
          const git = simpleGit(process.argv[2]);
          const branch = await git.branch();
          const revision = (await git.revparse(["--short", "HEAD"])).trim();
          const clean = (await git.status()).isClean();
          process.stdout.write(JSON.stringify({
            branch: branch.current, revision, clean,
            name: branch.current + "#" + revision + (clean ? "" : "-dirty")
          }));
        `,
        devtoolsManifest,
        directory
      ]);
      return JSON.parse(stdout);
    };

    const clean = await inspect();
    assert.equal(clean.branch, "main");
    assert.equal(clean.clean, true);
    assert.match(clean.revision, /^[0-9a-f]{7,}$/);
    assert.equal(clean.name, "main#" + clean.revision);

    await writeFile(join(directory, "fixture.txt"), "changed\n");
    const modified = await inspect();
    assert.equal(modified.clean, false);
    assert.equal(modified.revision, clean.revision);
    assert.equal(modified.name, "main#" + clean.revision + "-dirty");

    await execFileAsync("git", ["-C", directory, "restore", "fixture.txt"]);
    await writeFile(join(directory, "untracked.txt"), "new\n");
    assert.equal((await inspect()).clean, false);
    await rm(join(directory, "untracked.txt"));

    await execFileAsync("git", ["-C", directory, "checkout", "-b", "feature"]);
    const branch = await inspect();
    assert.equal(branch.branch, "feature");
    assert.equal(branch.clean, true);
    assert.equal(branch.name, "feature#" + clean.revision);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("DevTools Git reads the actual project worktree", async () => {
  const directory = process.cwd();
  const { stdout: branch } = await execFileAsync("git", [
    "-C",
    directory,
    "rev-parse",
    "--abbrev-ref",
    "HEAD"
  ]);
  const { stdout: revision } = await execFileAsync("git", [
    "-C",
    directory,
    "rev-parse",
    "--short",
    "HEAD"
  ]);
  const { stdout: status } = await execFileAsync("git", [
    "-C",
    directory,
    "status",
    "--porcelain"
  ]);
  const { stdout } = await execFileAsync(process.execPath, [
    "--input-type=module",
    "--eval",
    `
      import { createRequire } from "node:module";
      const { simpleGit } = createRequire(process.argv[1])("simple-git");
      const git = simpleGit(process.argv[2]);
      const branch = await git.branch();
      const revision = (await git.revparse(["--short", "HEAD"])).trim();
      const clean = (await git.status()).isClean();
      process.stdout.write(JSON.stringify({ branch: branch.current, revision, clean }));
    `,
    devtoolsManifest,
    directory
  ]);
  assert.deepEqual(JSON.parse(stdout), {
    branch: branch.trim(),
    revision: revision.trim(),
    clean: status.trim() === ""
  });
});
