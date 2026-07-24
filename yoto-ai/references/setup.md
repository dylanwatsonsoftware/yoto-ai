# Yoto setup and authentication recovery

## Create a client

1. Sign in to `https://dashboard.yoto.dev/`.
2. Create an API application and select **Public client**.
3. Register `http://127.0.0.1:8787/callback` exactly.
4. In the current dashboard, select:
   - `family:library:manage` — this automatically includes
     `family:library:view`
   - `user:content:manage` — this automatically includes
     `user:content:view` and `user:icons:manage`
5. Do not request `offline_access`. This application has not pre-approved it,
   and Yoto rejects authorization when it is requested.
6. Do not request `family:devices:view` until Yoto enables it for the client.
   The authorization server currently rejects it as not pre-approved even
   though the public documentation lists it.
7. Save the application and copy its client ID.
8. From the skill directory, install dependencies:

   ```bash
   npm ci
   npm run build
   ```

9. Make the ID available to the AI-agent process:

   ```bash
   export YOTO_CLIENT_ID="your-client-id"
   ```

10. Restart the agent from that environment if it was already running.
11. From the skill directory, authenticate:

   ```bash
   npm run yoto -- auth login --json
   ```

12. Confirm the stored session:

    ```bash
    npm run yoto -- auth status --json
    ```

Do not create or use a confidential client or client secret. A different
loopback callback may be supplied with `YOTO_REDIRECT_URI`, but it must use
`127.0.0.1` and exactly match a callback registered in the dashboard.

Official references:

- `https://yoto.dev/authentication/headless-cli-auth/`
- `https://yoto.dev/authentication/scopes/`

## Recover an existing login

### No stored session

```bash
npm run yoto -- auth login --json
```

The application does not have persistent access. Run the same command again
when the access token expires.

### Check the current session

```bash
npm run yoto -- auth status --json
```

### Reset a revoked, stale, or invalid session

```bash
npm run yoto -- auth logout --json
npm run yoto -- auth login --json
```

### Callback mismatch

First make the dashboard callback exactly match the desired loopback URL. For
the default:

```bash
export YOTO_REDIRECT_URI="http://127.0.0.1:8787/callback"
npm run yoto -- auth login --json
```

If the AI agent was already running, restart it after exporting the variable.

### Missing scope

Enable both available `manage` scopes in `https://dashboard.yoto.dev/`. The
skill requests `user:content:manage` and `user:icons:manage` so it can retrieve
icon URLs, but its CLI remains read-only. Then issue fresh authorization:

```bash
npm run yoto -- auth logout --json
npm run yoto -- auth login --json
```

### Scope not pre-approved

If Yoto reports that `offline_access` was not pre-approved, rebuild the current
skill and retry. The current version does not request that scope:

```bash
npm run build
npm run yoto -- auth login --json
```

### Port 8787 unavailable

Identify the listening process:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

Do not terminate it automatically. Ask the user before running:

```bash
kill <PID>
```

Alternatively, register another `127.0.0.1` callback in the dashboard, export
the exact matching URI, and retry:

```bash
export YOTO_REDIRECT_URI="http://127.0.0.1:<PORT>/callback"
npm run yoto -- auth login --json
```

### Keychain or dependency unavailable

Reinstall the locked dependencies:

```bash
npm ci
npm run build
npm run yoto -- auth status --json
```

Do not fall back to plaintext token files.

### Client ID unavailable to the agent process

Set it in the shell used to launch the agent:

```bash
export YOTO_CLIENT_ID="your-client-id"
```

Restart the agent from that shell, then run:

```bash
npm run yoto -- auth login --json
```

Never request that the user reveal tokens, authorization codes, or a client
secret while troubleshooting.
