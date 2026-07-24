# Yoto AI skill

A local-first AI-agent skill for safely working with a Yoto account. Ask your
agent to inspect Make Your Own library content or to prepare and validate a
playlist draft. The skill uses a bundled TypeScript CLI for
deterministic authentication, API access, and validation.

The CLI can inspect packages and publish a complete playlist create or append
only after one explicit, cryptographically bound batch confirmation. It cannot
delete cards, change player settings, or control playback.

## Install the skill

Requirements:

- An AI agent that supports `SKILL.md`-based skills
- Node.js 22 or later
- npm
- A Yoto account
- A Yoto public-client ID

Copy or link this `yoto-ai` directory into the skills directory configured for
your AI agent. For example:

```bash
mkdir -p /path/to/your-agent/skills
ln -s /absolute/path/to/yoto-skill/yoto-ai /path/to/your-agent/skills/yoto-ai
```

Alternatively, copy the directory:

```bash
cp -R /absolute/path/to/yoto-skill/yoto-ai /path/to/your-agent/skills/yoto-ai
```

Install the bundled CLI dependencies:

```bash
cd /path/to/your-agent/skills/yoto-ai
npm ci
npm run build
```

Restart or reload your agent if the skill is not immediately available.

## Get a Yoto client ID

1. Sign in to the [Yoto Developer Dashboard](https://dashboard.yoto.dev/).
2. Create a new API application.
3. Select **Public client**. A local skill cannot safely keep a client secret,
   so do not create a confidential client.
4. Register this redirect URL exactly:

   ```text
   http://127.0.0.1:8787/callback
   ```

5. Select the dashboard scopes currently offered:

   - `family:library:manage` (automatically includes `family:library:view`)
   - `user:content:manage` (automatically includes `user:content:view` and
     `user:icons:manage`)

   During sign-in the skill requests `family:library:view`,
   `user:content:view`, `user:content:manage`, and `user:icons:manage`. Yoto
   requires the two manage scopes to retrieve icon image URLs, although the
   bundled CLI remains read-only. It does not request `offline_access` or
   `family:devices:view` because Yoto rejects those scopes unless the
   application has explicitly pre-approved them.

6. Save the application and copy its client ID.

Yoto documents this setup in its
[headless/CLI authentication guide](https://yoto.dev/authentication/headless-cli-auth/).
The callback used by the skill must exactly match the dashboard entry. See
[Yoto API scopes](https://yoto.dev/authentication/scopes/) for the current
scope definitions.

Do not create, configure, or store a client secret for this skill.

## Configure your agent

Make `YOTO_CLIENT_ID` available to the agent process before starting it:

```bash
export YOTO_CLIENT_ID="your-client-id"
```

The default callback is already `http://127.0.0.1:8787/callback`.
`YOTO_REDIRECT_URI` is only needed if you registered a different loopback URL:

```bash
export YOTO_REDIRECT_URI="http://127.0.0.1:8787/callback"
```

Optional:

```bash
export YOTO_TOKEN_STORE="yoto-ai-skill"
```

For package publishing, create a per-session confirmation secret:

```bash
export YOTO_CONFIRMATION_SECRET="$(openssl rand -hex 32)"
```

This changes the service name used in the operating-system keychain. Never put
access or refresh tokens in environment variables, `.env` files, source
control, prompts, or logs.

## Use the skill

Invoke it explicitly with `$yoto-ai` when supported, or ask your agent for a
task covered by the skill description.

Example prompts:

```text
Use $yoto-ai to sign in to my Yoto account.
```

```text
Use $yoto-ai to list my Make Your Own library.
```

```text
Use $yoto-ai to prepare a playlist JSON draft from these tracks. Validate it,
but do not publish anything.
```

On login, the skill opens Yoto’s authorization page in a browser and
temporarily listens on `127.0.0.1:8787` for the callback. It stores the access
token in the operating-system keychain. Sign in again after the token expires;
this application does not have persistent access.

## Supported capabilities

- Log in, inspect authentication status, and log out.
- List Make Your Own library content.
- Read a selected card.
- Prepare and locally validate playlist JSON.
- Inspect `playlist-package.json` v1 packages.
- Preview an entire playlist create or append without uploading.
- Upload and publish only after one confirmation bound to that exact preview.

Playlist drafts require HTTPS or `yoto:#` track references,
source-and-permission metadata, and unique chapter and track keys. Validation
does not require a Yoto client ID and never publishes the draft.

## Safety boundaries

- OAuth includes Yoto content and icon manage scopes for media and card
  publishing.
- Tokens are stored in the OS keychain and redacted from diagnostics.
- Any refresh token returned by Yoto is stored only in the OS keychain and
  replaced under a cross-process lock.
- Publishing requires a full preview and one explicit confirmation. A changed
  preview requires a new confirmation.
- Audio uploads are checkpointed by checksum and upload ID. Re-running the
  same confirmed apply resumes Yoto transcoding instead of uploading the audio
  again.
- Publishing waits for completed Yoto transcodes before constructing the card,
  and uses the returned media references and metadata.
- The final card mutation is attempted once and is never automatically retried.
  If it fails, the CLI includes Yoto's validation response so the payload can
  be corrected before the user explicitly retries.

## Bundled CLI

The skill calls its bundled CLI in JSON mode. Direct CLI use is optional, but
useful for diagnostics:

```bash
cd /path/to/your-agent/skills/yoto-ai

npm run yoto -- auth login --json
npm run yoto -- library list --json
npm run yoto -- playlist draft \
  --input references/example-playlist.json \
  --json
npm run yoto -- playlist inspect-package --input /path/to/package --json
npm run yoto -- playlist preview-create --input /path/to/package \
  --output /tmp/yoto-preview.json --json
```

Save a preview JSON, show it to the user, and only after they confirm:

```bash
npm run yoto -- playlist confirm --preview /tmp/yoto-preview.json --json
npm run yoto -- playlist apply --preview /tmp/yoto-preview.json \
  --confirmation-token TOKEN --json
```

Development checks:

```bash
npm test
npm run check
npm run build
```
