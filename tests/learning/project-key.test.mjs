// Boundary tests for canonical project keying (P0-B).
// Same-named repos must differ; worktrees/nested dirs must share the repo key.
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { projectName } from "../../scripts/learning/session-context.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "pkey-"));
const git = (cwd, args) => execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] });
process.on("exit", () => rmSync(ROOT, { recursive: true, force: true }));

// ~/a/app and ~/b/app — different repos, same basename
mkdirSync(join(ROOT, "a", "app"), { recursive: true });
mkdirSync(join(ROOT, "b", "app"), { recursive: true });
mkdirSync(join(ROOT, "c", "app", "sub", "deep"), { recursive: true });
for (const p of [join(ROOT, "a", "app"), join(ROOT, "b", "app"), join(ROOT, "c", "app")]) git(p, "init -q");
// worktree of a/app
git(join(ROOT, "a", "app"), "config user.email t@t && git -C . config user.name t");
git(join(ROOT, "a", "app"), "commit -qm init --allow-empty");
git(join(ROOT, "a", "app"), "worktree add -q ../app-wt");

test("same-basename different repos produce different keys", () => {
  const ka = projectName(join(ROOT, "a", "app"));
  const kb = projectName(join(ROOT, "b", "app"));
  if (ka === kb) throw new Error(`collision: ${ka}`);
  if (!/^app-[0-9a-f]{16}$/.test(ka) || !/^app-[0-9a-f]{16}$/.test(kb)) throw new Error(`bad key shape: ${ka} ${kb}`);
});

test("worktree shares the parent repo key", () => {
  const main = projectName(join(ROOT, "a", "app"));
  const wt = projectName(join(ROOT, "a", "app-wt"));
  if (main !== wt) throw new Error(`worktree key differs: ${main} vs ${wt}`);
});

test("nested dir inside repo shares repo key", () => {
  const repo = projectName(join(ROOT, "c", "app"));
  const nested = projectName(join(ROOT, "c", "app", "sub", "deep"));
  if (repo !== nested) throw new Error(`nested key differs: ${repo} vs ${nested}`);
});

test("non-git dir falls back to path-hash key", () => {
  mkdirSync(join(ROOT, "plain", "data"), { recursive: true });
  const k = projectName(join(ROOT, "plain", "data"));
  if (!/^data-[0-9a-f]{16}$/.test(k)) throw new Error(`bad fallback key: ${k}`);
});
