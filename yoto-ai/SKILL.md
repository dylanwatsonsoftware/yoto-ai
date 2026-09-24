---
name: yoto-ai
description: Authenticate with Yoto, inspect a Make Your Own library, validate portable playlist packages, and safely preview and publish a whole create/append operation after one explicit confirmation. Use for Yoto setup, authentication, library inspection, package validation, or publishing.
---

# Yoto AI

Use the bundled TypeScript CLI as the deterministic boundary for Yoto authentication, reads, and playlist validation.

## Setup

1. Require Node.js 22 or later.
2. Run `npm ci` in this skill directory when dependencies are absent.
   After installing, verify that `keytar` loads under the same Node executable
   and architecture that will run the CLI. If its native binary architecture
   is incompatible, run `npm rebuild keytar --build-from-source`, verify it
   again, and then run `auth status`.
3. Ask the user to create a **public client** at `https://dashboard.yoto.dev/` and register `http://127.0.0.1:8787/callback`.
4. Require `YOTO_CLIENT_ID`; allow `YOTO_REDIRECT_URI` only when it exactly matches a registered loopback callback. The CLI automatically loads an ignored `.env` file from this directory when present.
5. Never request or use a client secret.
Before preparing a confirmed write, preflight Node/keytar, authentication, the
current CLI command contract, and every package dependency. Do not reinstall
dependencies or rebuild the CLI in the middle of a confirmed batch unless a
pre-mutation failure requires it; re-read the current command help or source
after any rebuild.

Run commands from this skill directory:

```bash
npm run yoto -- <command> --json
```

Use JSON mode for orchestration. Never include command output containing personal information in a model prompt unless it is essential and the user requested it.

## Workflow

1. Classify the request as read, draft, package preview, confirmed write, or control.
2. Available operations:
   - `auth login`
   - `auth status`
   - `auth logout`
   - `library list`
   - `library show <card-id>`
   - `playlist draft --input <json-file>`
   - `playlist inspect-package --input <dir> --json`
   - `playlist preview-create --input <dir> [--single-track-chapters] --output <preview-file> --json`
   - `playlist preview-append --input <dir> --card-id <id> [--title <final-title>] --output <preview-file> --json`
   - `playlist preview-repair-artwork --input <dir> --card-id <id> --output <preview-file> --json`
   - `playlist preview-repair-track-artwork --input <dir> --card-id <id> --chapter-keys <comma-separated-keys> --output <preview-file> --json`
   - `playlist preview-repair-track-labels --input <dir> --card-id <id> --output <preview-file> --json`
   - `playlist preview-repair-song-layout --input <dir> --card-id <id> --chapter-key <key> --output <preview-file> --json`
   - `playlist apply --preview <file> --json`
3. Validate every package and generate a preview before any upload. Before
   every create preview, search the live Yoto library for exact and similar
   normalized titles.
4. If a possible duplicate exists, stop and show every candidate title, card
   ID, match type, and similarity score. Use `playlist preview-append` only
   after the user chooses that card; otherwise require a distinct title.
5. For append-by-name requests, run `library list`, require exactly one exact title match, show its card ID, then preview with that ID. Reject zero or multiple exact matches.
   When a new package represents multiple standalone items that should each be
   selectable from the card, use `preview-create --single-track-chapters`.
   Require the preview to show one chapter per package track with chapter and
   track navigation labels `1..N`. Keep the default grouped layout for one
   story/album whose tracks are parts of the same item.
   Before appending, inspect the existing chapter shape. Treat a card as a
   song playlist only when it is non-empty and every existing chapter contains
   exactly one track. For that shape, append every new song as its own
   single-track chapter and continue the existing navigation labels. Do not
   infer a song playlist from its title, genre, or source. For albums, stories,
   or any card with empty or multi-track chapters, preserve package chapter
   grouping instead of forcing one chapter per track.
   When combining multiple seasons, append one ordered season package at a
   time so each season becomes a separate chapter. Preserve an existing clear
   chapter structure instead of adding redundant season grouping. Use the
   optional append `--title` only when the final combined card needs a title
   that differs from the existing card.
6. Show one consolidated preview containing every audio, cover, icon, duplicate decision, and final card change. Ask exactly one confirmation.
   Use `preview-repair-artwork` for artwork-only fixes; it preserves existing
   audio and replaces only the cover and track display icons.
   Use `preview-repair-track-artwork` to replace icons only for an exact list
   of single-track song chapters. Require one unique chapter key per package
   track and exact title/order matching; preserve the card cover, untargeted
   icons, all audio, and all other metadata.
   Use `preview-repair-track-labels` to renumber every track's `overlayLabel`
   in global playback order after exact title/order matching. It uploads no
   media and preserves chapters, audio, artwork, and all other metadata.
   Use `preview-repair-song-layout` only to split the final imported multi-song
   chapter into one-song chapters; it preserves all audio, artwork, and metadata.
   Prefer supplied or embedded artwork over generated fallbacks. If artwork
   must be generated, generate at most one image per playlist and reuse it for
   the cover and every derived track icon. Clearly identify generated artwork
   in the consolidated preview.
   For a multi-track playlist whose tracks would otherwise share one generic
   icon, derive numbered 16×16 RGBA icons locally from that single source
   image. Number them in final track order, using high-contrast bitmap digits
   about one quarter of the icon height with hard pixel edges. Place the number
   in the bottom-right corner with a one-pixel visual inset unless the artwork or
   user requires another position; do not generate a separate image for each
   number. Skip numbering when supplied icons are
   already distinct and meaningful or the user asks for unnumbered icons.
   Validate every output at exactly 16×16 RGBA, verify the numbers against the
   manifest positions, and show a nearest-neighbor contact sheet in the
   consolidated preview. Use the bundled local renderer for this:
   `npm run render-numbered-icons -- --source <png> --package <dir> --preview <png>`.
7. Only after explicit confirmation, run `playlist apply` with the exact
   immutable preview file that was shown to the user.
8. Let `playlist apply` resume any checkpointed upload IDs and poll until Yoto
   returns `transcodedSha256` and `transcodedInfo`. A transcode-start response is
   not a completed upload. Inspect the returned `verification`: require
   `verified: true` before declaring the saved structure correct. If the final
   mutation succeeded but verification is false or unavailable, report the
   card ID and issues, do not repeat the mutation, and prepare a repair preview
   from the live card state when possible.
9. Refuse deletion, player commands, settings changes, TTS, and streaming.

For a multi-package operation, keep one immutable preview per package. The
user's single confirmation authorizes the whole displayed batch; do not ask
again between packages. Apply packages
sequentially so each final card mutation remains single-attempt. If the batch
partially completes, report created card IDs, determine whether the failed
package reached its final mutation, and resume only checkpointed media or an
untouched preview. Never repeat a final mutation that was attempted.

Do not batch dependent previews that mutate the same card when a later preview
was generated from the card state before an earlier preview. Applying the later
stale snapshot can overwrite the earlier mutation. Use one atomic preview when
supported; otherwise apply and verify the first mutation, fetch the new live
card state, generate a new immutable preview, and obtain confirmation for that
new mutation.

## Authentication recovery

Do not return a bare CLI error when authentication or configuration fails.
Read [references/setup.md](references/setup.md), identify the error code, and
give the user the applicable setup or recovery steps. Prefer exact,
copy-pasteable commands over prose whenever a command exists:

- `CONFIG_ERROR`: explain how to create a Yoto public client, register the
  callback, enable the required scopes, set `YOTO_CLIENT_ID` for the agent
  process, and retry.
- `AUTH_REQUIRED`: explain that setup is complete but login is needed, then run
  `auth login` with the user's approval for browser-based sign-in.
- `AUTH_FAILED`: preserve the useful non-secret error message; have the user
  verify the exact callback and scopes, then use `auth logout` followed by
  `auth login` when a stale or revoked session is likely.
- Missing dependencies: run `npm ci` in this skill directory, then retry.
- A `keytar` load error that reports incompatible `x86_64`/`arm64`
  architecture: rebuild `keytar` from source with the active Node 22 runtime,
  verify `import("keytar")`, then retry `auth status`. A one-off API error
  immediately after the rebuild may be retried once after the module-load
  check.

Never ask the user to paste a client secret, access token, refresh token, or
authorization code. Stop after providing setup steps when the next action
requires the user to create an application, change its dashboard settings, or
restart the agent with a new environment variable.

## Guardrails

- Do not ask for separate conversational approval before routine setup,
  authentication-status checks, library reads, validation, preview generation,
  or each CLI command. Run those steps autonomously. If the execution
  environment itself requires a tool permission prompt, request the narrowest
  reusable command prefix and avoid repeating an equivalent request.
- After the user confirms an immutable Yoto preview, treat that confirmation
  as authorization for every upload and apply command in that preview; do not
  ask again between media uploads or before the final mutation.
- Never print, store in files, or send access or refresh tokens to an LLM.
- Keep refresh tokens only in the operating-system keychain.
- Never retry the final card mutation automatically. Media uploads may resume
  by checksum and pending upload ID, but inspect the preview and checkpoint
  before recovery.
- Build audio references from `transcodedSha256`, map `m4a` to Yoto's `x-m4a`
  card format, and use Yoto's completed duration, size, and channel metadata.
- Map uploaded icons to `display.icon16x16` as `yoto:#<mediaId>` and uploaded
  covers to `metadata.cover.imageL`.
- Surface Yoto's response body when the final card mutation fails.
- Treat child-related names, emails, listening activity, and content as sensitive.
- Filter `library list` output inside the local process to only the titles,
  card IDs, and match scores needed for duplicate checks; do not emit the
  unfiltered library response into a model prompt or log.
- Require HTTPS for remote track URLs.
- Require provenance and permission for every playlist draft.
- Upload icons only after local 16×16 RGBA validation and use `autoConvert=false`.
- Preserve all existing card content and metadata when appending.
- Never create a playlist until the authenticated library duplicate check
  returns no exact or similar title candidates.
- Treat a successful `playlist apply` response containing the new card ID as
  authoritative completion. A later read-back failure does not invalidate the
  completed mutation. The CLI retries the read once and returns a failed
  verification if it remains unavailable; report that result and never rerun
  the final mutation automatically.
- Read [references/contracts.md](references/contracts.md) when interpreting scopes, errors, or playlist requirements.
