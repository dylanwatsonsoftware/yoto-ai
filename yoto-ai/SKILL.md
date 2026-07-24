---
name: yoto-ai
description: Safely inspect a user's Yoto Make Your Own library, authenticate or troubleshoot a local Yoto public client, and prepare schema-validated playlist JSON drafts without publishing. Use for Yoto setup, authentication failures, library inspection, or draft playlist preparation.
---

# Yoto AI

Use the bundled TypeScript CLI as the deterministic boundary for Yoto authentication, reads, and playlist validation.

## Setup

1. Require Node.js 22 or later.
2. Run `npm ci` in this skill directory when dependencies are absent.
3. Ask the user to create a **public client** at `https://dashboard.yoto.dev/` and register `http://127.0.0.1:8787/callback`.
4. Require `YOTO_CLIENT_ID`; allow `YOTO_REDIRECT_URI` only when it exactly matches a registered loopback callback.
5. Never request or use a client secret.

Run commands from this skill directory:

```bash
npm run yoto -- <command> --json
```

Use JSON mode for orchestration. Never include command output containing personal information in a model prompt unless it is essential and the user requested it.

## Workflow

1. Classify the request as read, draft, write, or control.
2. Execute read and draft operations only:
   - `auth login`
   - `auth status`
   - `auth logout`
   - `library list`
   - `library show <card-id>`
   - `playlist draft --input <json-file>`
3. For playlist work, draft JSON locally, record content source and permission, then validate it with `playlist draft`.
4. Present validation results and clearly state that nothing was published.
5. Refuse write or control requests. Explain that publishing, uploads, deletion, player commands, settings changes, TTS, and streaming are outside this safe MVP.

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
- Keep refresh tokens only in the operating-system keychain.
- Never retry a write; this skill contains no write operation.
- Treat child-related names, emails, listening activity, and content as sensitive.
- Require HTTPS for remote track URLs.
- Require provenance and permission for every playlist draft.
- Read [references/contracts.md](references/contracts.md) when interpreting scopes, errors, or playlist requirements.
