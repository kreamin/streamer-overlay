// Checks that the version in the files that matter matches the release tag, and
// names any file that still needs bumping.
//
// Why this exists: `apps/desktop/package.json` is THE release version —
// electron-builder publishes to `v${version}`. If the tag says v0.3.12 but that
// file still says 0.3.11, the run tries to publish into the already-released
// v0.3.11 and fails several minutes into the build. This catches it in seconds.
//
// CI runs it automatically on a tag. To check before you tag:
//   npm run check:version v0.3.13

import fs from "node:fs";

// Must match the tag or the release is broken.
const REQUIRED = ["apps/desktop/package.json"];
// Reported for visibility only — not used for releases, so it never fails the build.
const INFO = ["package.json"];
// (apps/control, apps/overlay, packages/* are intentionally left at 0.0.0.)

const raw = (process.argv[2] || process.env.GITHUB_REF_NAME || "").trim();
const expected = raw.replace(/^v/, "");

if (!expected) {
  console.error("No tag given. Usage: node scripts/check-release-version.mjs v0.3.13");
  process.exit(2);
}

function versionOf(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).version ?? "(no version field)";
  } catch {
    return "(unreadable)";
  }
}

console.log(`\nRelease version check - tag ${raw} (expected version ${expected})\n`);

const stale = [];
for (const file of REQUIRED) {
  const found = versionOf(file);
  const ok = found === expected;
  if (!ok) stale.push({ file, found });
  console.log(`  ${ok ? "OK   " : "STALE"}  ${file.padEnd(32)} ${found}`);
}
for (const file of INFO) {
  const found = versionOf(file);
  const ok = found === expected;
  console.log(
    `  ${ok ? "OK   " : "note "}  ${file.padEnd(32)} ${found}${ok ? "" : "   (not used for releases)"}`,
  );
}

if (stale.length > 0) {
  console.error(`\nNot updated to ${expected} - bump these before releasing:`);
  for (const { file, found } of stale) {
    console.error(`  - ${file}  (currently ${found})`);
  }
  console.error(
    `\nThen re-point the tag:\n` +
      `  git push --delete origin ${raw}\n` +
      `  git tag -d ${raw}\n` +
      `  git tag ${raw}\n` +
      `  git push origin master && git push origin ${raw}\n`,
  );
  process.exit(1);
}

console.log(`\nAll good - safe to publish ${expected}.\n`);
