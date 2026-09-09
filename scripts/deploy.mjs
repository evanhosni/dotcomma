#!/usr/bin/env node
/**
 * `npm run deploy` — cut a release and push it. Railway deploys on push (GitHub
 * integration); this script only decides the version, tags it, and pushes.
 *
 *   1. Refuse on a dirty working tree, a non-main branch, or a branch behind origin.
 *   2. Read `version` from the root package.json.
 *   3. If tag v{version} does NOT exist (locally or on origin): the version was
 *      set by hand → use it as-is.
 *   4. If it DOES exist: already shipped → bump the patch segment in package.json
 *      and package-lock.json. If THAT tag exists too, stop — never guess further.
 *   5. Commit the bump (if any), create annotated tag v{version}, push the
 *      branch and the tag.
 *
 * Flags: --dry-run (print the plan, change nothing), --branch <name> (default main).
 *
 * Migrations are NOT run here. Order of operations for a schema change:
 * `npm run db:migrate` on the live database first, then `npm run deploy`.
 *
 * Everything git-related goes through run() so the whole flow is testable
 * against a throwaway repo: the script operates on process.cwd().
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class DeployError extends Error {}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export const run = (cmd, args, { cwd, allowFail = false } = {}) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    if (allowFail) return null;
    const stderr = err.stderr ? String(err.stderr).trim() : "";
    throw new DeployError(`${cmd} ${args.join(" ")} failed${stderr ? `:\n${stderr}` : ""}`);
  }
};

export const parseVersion = (v) => {
  const m = SEMVER.exec(v);
  if (!m) throw new DeployError(`package.json version "${v}" is not plain x.y.z semver`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
};

export const bumpPatch = (v) => {
  const { major, minor, patch } = parseVersion(v);
  return `${major}.${minor}.${patch + 1}`;
};

export const tagFor = (version) => `v${version}`;

export const readVersion = (cwd) => {
  const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  if (typeof pkg.version !== "string") throw new DeployError("package.json has no version");
  parseVersion(pkg.version);
  return pkg.version;
};

/** Write the version into package.json (textual replace, so formatting is
 *  untouched) and package-lock.json (root `version` + `packages[""].version`,
 *  the two places npm keeps it). Done by hand instead of `npm version` so the
 *  script has no dependency beyond git — and no .cmd spawning quirks on Windows. */
export const writeVersion = (cwd, version) => {
  const pkgPath = path.join(cwd, "package.json");
  const pkgText = readFileSync(pkgPath, "utf8");
  const replaced = pkgText.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`);
  if (replaced === pkgText) throw new DeployError('could not find a "version" line in package.json to rewrite');
  writeFileSync(pkgPath, replaced);

  const lockPath = path.join(cwd, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.version = version;
  if (lock.packages && lock.packages[""]) lock.packages[""].version = version;
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
};

/** True if the tag exists locally OR on origin (both count as "shipped"). */
export const tagExists = (cwd, tag) => {
  const local = run("git", ["tag", "--list", tag], { cwd });
  if (local === tag) return true;
  const remote = run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], { cwd });
  return remote.length > 0;
};

export const assertCleanAndReady = (cwd, branch) => {
  const status = run("git", ["status", "--porcelain"], { cwd });
  if (status) throw new DeployError(`working tree is dirty — commit or stash first:\n${status}`);

  const current = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  if (current !== branch) throw new DeployError(`on branch "${current}", deploys go from "${branch}" (use --branch to override)`);

  run("git", ["fetch", "--quiet", "--tags", "origin", branch], { cwd });
  const behind = run("git", ["rev-list", "--count", `HEAD..origin/${branch}`], { cwd, allowFail: true });
  if (behind === null) throw new DeployError(`origin/${branch} not found — is the remote set up?`);
  if (Number(behind) > 0) throw new DeployError(`branch is ${behind} commit(s) behind origin/${branch} — pull first`);
};

/** Decide what to do. Pure given the git facts; returns a plan. */
export const planRelease = (cwd) => {
  const current = readVersion(cwd);
  if (!tagExists(cwd, tagFor(current))) {
    return { version: current, bump: false, reason: `tag ${tagFor(current)} does not exist → version was set by hand, using as-is` };
  }
  const next = bumpPatch(current);
  if (tagExists(cwd, tagFor(next))) {
    throw new DeployError(
      `tag ${tagFor(current)} is already shipped AND the bumped ${tagFor(next)} exists too. ` +
        `Set the version in package.json by hand to something unreleased, commit, and rerun.`,
    );
  }
  return { version: next, bump: true, reason: `tag ${tagFor(current)} exists → already shipped, bumping patch to ${next}` };
};

export const deploy = ({ cwd = process.cwd(), branch = "main", dryRun = false, log = console.log } = {}) => {
  assertCleanAndReady(cwd, branch);
  const plan = planRelease(cwd);
  const tag = tagFor(plan.version);
  log(plan.reason);

  if (dryRun) {
    log(`[dry-run] would ${plan.bump ? `bump package.json + package-lock.json to ${plan.version}, commit, ` : ""}tag ${tag}, and push ${branch} + ${tag}`);
    return { ...plan, tag, pushed: false };
  }

  if (plan.bump) {
    writeVersion(cwd, plan.version);
    run("git", ["add", "package.json", "package-lock.json"], { cwd });
    run("git", ["commit", "--quiet", "-m", `release ${tag}`], { cwd });
    log(`committed version bump ${tag}`);
  }

  run("git", ["tag", "-a", tag, "-m", `release ${tag}`], { cwd });
  log(`tagged ${tag}`);

  try {
    run("git", ["push", "--quiet", "origin", branch], { cwd });
    run("git", ["push", "--quiet", "origin", tag], { cwd });
  } catch (err) {
    throw new DeployError(
      `${err.message}\n\nThe tag ${tag} exists LOCALLY but the push did not complete. ` +
        `Fix the remote issue and run: git push origin ${branch} && git push origin ${tag}`,
    );
  }
  log(`pushed ${branch} and ${tag} — Railway will deploy from this push`);
  return { ...plan, tag, pushed: true };
};

// ── CLI ────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const bi = argv.indexOf("--branch");
  const branch = bi >= 0 ? argv[bi + 1] : "main";
  try {
    deploy({ dryRun, branch });
  } catch (err) {
    if (err instanceof DeployError) {
      console.error(`\ndeploy aborted: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
