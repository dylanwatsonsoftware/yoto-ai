---
name: yoto-ai
description: Authenticate with Yoto, inspect a Make Your Own library, validate portable playlist packages, and safely preview and publish a whole create/append operation after one explicit confirmation. Use for Yoto setup, authentication, library inspection, package validation, or publishing.
---

# Yoto AI

Use the bundled TypeScript CLI as the deterministic boundary for Yoto authentication, reads, and playlist validation.

## Setup

1. Require Node.js 22 or later.
2. Run `npm ci` in this skill directory when dependencies are absent.
3. Ask the user to create a **public client** at `https://dashboard.yoto.dev/` and register `http://127.0.0.1:8787/callback`.
4. Require `YOTO_CLIENT_ID`; allow `YOTO_REDIRECT_URI` only when it exactly matches a registered loopback callback. The CLI automatically loads an ignored `.env` file from this directory when present.
5. Never request or use a client secret.
6. For publishing, require `YOTO_CONFIRMATION_SECRET` from the environment or ignored `.env` file. Never put its value in a command.

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
   - `playlist preview-create --input <dir> --output <preview-file> --json`
   - `playlist preview-append --input <dir> --card-id <id> --output <preview-file> --json`
   - `playlist confirm --preview <file> --confirmation-file <file> --json`
   - `playlist apply --preview <file> --confirmation-file <file> --json`
3. Validate every package and generate a preview before any upload. Before
   every create preview, search the live Yoto library for exact and similar
   normalized titles.
4. If a possible duplicate exists, stop and show every candidate title, card
   ID, match type, and similarity score. Use `playlist preview-append` only
   after the user chooses that card; otherwise require a distinct title.
5. For append-by-name requests, run `library list`, require exactly one exact title match, show its card ID, then preview with that ID. Reject zero or multiple exact matches.
6. Show one consolidated preview containing every audio, cover, icon, duplicate decision, and final card change. Ask exactly one confirmation.
7. Only after explicit confirmation, run `playlist confirm` with a private
   confirmation-file path, then pass that file path to `playlist apply`. Never
   print, copy, return, or place the token itself in command arguments.
8. Let `playlist apply` resume any checkpointed upload IDs and poll until Yoto
   returns `transcodedSha256` and `transcodedInfo`. A transcode-start response is
   not a completed upload.
9. Refuse deletion, player commands, settings changes, TTS, and streaming.

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

Never ask the user to paste a client secret, access token, refresh token, or
authorization code. Stop after providing setup steps when the next action
requires the user to create an application, change its dashboard settings, or
restart the agent with a new environment variable.

## Guardrails

- Never print, store in files, or send access or refresh tokens to an LLM.
- Store confirmation tokens only in CLI-created mode-`0600` files; never put
  them in command arguments, output, prompts, or logs.
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
- Require HTTPS for remote track URLs.
- Require provenance and permission for every playlist draft.
- Upload icons only after local 16×16 RGBA validation and use `autoConvert=false`.
- Preserve all existing card content and metadata when appending.
- Never create a playlist until the authenticated library duplicate check
  returns no exact or similar title candidates.
- Read [references/contracts.md](references/contracts.md) when interpreting scopes, errors, or playlist requirements.
