# Pi toolkit readiness — 15 October 2026

## Changes included

This isolated checkout starts from the original repository's committed HEAD
and selectively incorporates the current Pi integration work: AGENTS.md,
CLAUDE.md, both skill instructions, README, root package metadata, project Pi
settings, the import prompt, and Pi discovery tests. CLAUDE.md is a regular
import file in the source checkout, not a symlink.

The unrelated staged `.backpassrc.json` and untracked import reports were
intentionally excluded. No `.env`, account credentials, generated audio,
previews, token storage, or import reports were copied.

The review also adds:

- A root `npm test` entry point and Node 22 requirement.
- An explicit npm package allowlist. The original root metadata packaged the
  entire catalogue website. The reviewed package contains 54 files, 467,374
  unpacked bytes (109,889 compressed), with the two executable skills, schema,
  and Pi prompt. It excludes the website and runtime output directories.
- A package-content regression and actual installed-Pi prompt expansion tests.
- Documentation separating Pi resource discovery from per-skill dependency
  setup and Drive integration setup.

The existing Drive capability guidance matches the CLI contract: the catalogue
CLI operates on supplied local snapshots and files; it has no Drive download
command or `index find`. The cover-size guidance matches package construction,
which normalizes supplied covers to PNG and stores their checksum. A 600-pixel
longest side is an example, not a verified Yoto upload limit. Instructions
require inspecting the final bytes and updating the checksum before preview;
supplied icons remain unchanged.

## Verified

- Root packaging test passed; with `PI_SKILLS_MODULE` pointing at installed
  Pi, all three root tests passed with no skips. Pi discovered both project
  skill paths and package-manifest skill paths without diagnostics. Its prompt
  loader discovered `/yoto-import` and expanded selected IDs and paths.
- `yoto-ai`: 64 tests passed across 10 files; TypeScript check and build passed.
- Drive catalogue: 19 tests passed across 5 files; TypeScript check and build
  passed.
- Built CLI checks: local `playlist inspect-package --input <missing fixture>
  --json` returned the expected missing-manifest error without authentication;
  `index status --json` succeeded against a new isolated local SQLite file.
- `git diff --check` passed. Original source Git status remained unchanged,
  including its existing staged, unstaged, and untracked work.

## Remaining steps

1. Review this commit against the original working tree. Because original files
   already contain part of this patch, integrate the reviewed versions carefully;
   do not blindly cherry-pick over existing staged and unstaged changes.
2. In the chosen checkout, use `pi` followed by `/reload` for an existing session,
   or `pi install /absolute/path/to/checkout` for use from other directories.
   Run each skill's `npm ci` only when its dependencies are absent.
3. Confirm the intended Pi session has authenticated Drive metadata, ancestry,
   listing, and binary download tools before a real Drive import. Skill
   installation alone does not provide that connector.
4. Run the first real import through package validation and a consolidated
   preview. Publishing requires the explicit confirmation described by the
   skills. No live import or publishing acceptance test was performed here.

No Yoto or Drive writes, authentication changes, keychain access, npm publish,
website publication, or Pi installation were performed. Test dependencies were
reused through local symlinks; the original dependency directories were not
modified. The catalogue website and Spotify import skill were not changed, so
their independent application suites were outside this task's validation scope.
