import { createHash, randomBytes } from "node:crypto";
import { mkdir, open as openFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import open from "open";
import lockfile from "proper-lockfile";

export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:8787/callback";
export const READ_SCOPES = [
  "family:library:view",
  "user:content:view",
  "user:content:manage",
  "user:icons:manage"
] as const;

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface TokenStore {
  load(): Promise<StoredTokens | null>;
  save(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  constructor(private tokens: StoredTokens | null = null) {}

  async load(): Promise<StoredTokens | null> {
    return this.tokens ? { ...this.tokens } : null;
  }

  async save(tokens: StoredTokens): Promise<void> {
    this.tokens = { ...tokens };
  }

  async clear(): Promise<void> {
    this.tokens = null;
  }
}

export class KeychainTokenStore implements TokenStore {
  constructor(
    private readonly service = process.env.YOTO_TOKEN_STORE || "yoto-ai-skill",
    private readonly account = "oauth-tokens"
  ) {}

  private async keytar() {
    try {
      return await import("keytar");
    } catch {
      throw new Error(
        "OS keychain support is unavailable. Install the optional keytar dependency; insecure token-file fallback is disabled."
      );
    }
  }

  async load(): Promise<StoredTokens | null> {
    const keytar = await this.keytar();
    const value = await keytar.default.getPassword(this.service, this.account);
    return value ? (JSON.parse(value) as StoredTokens) : null;
  }

  async save(tokens: StoredTokens): Promise<void> {
    const keytar = await this.keytar();
    await keytar.default.setPassword(this.service, this.account, JSON.stringify(tokens));
  }

  async clear(): Promise<void> {
    const keytar = await this.keytar();
    await keytar.default.deletePassword(this.service, this.account);
  }
}

interface AuthorizationUrlOptions {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes?: readonly string[];
}

export function buildAuthorizationUrl(options: AuthorizationUrlOptions): URL {
  const url = new URL("https://login.yotoplay.com/authorize");
  url.search = new URLSearchParams({
    audience: "https://api.yotoplay.com",
    scope: (options.scopes ?? READ_SCOPES).join(" "),
    response_type: "code",
    client_id: options.clientId,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: options.redirectUri,
    state: options.state
  }).toString();
  return url;
}

export function createPkce(): {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
} {
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return {
    codeVerifier,
    codeChallenge,
    state: randomBytes(24).toString("base64url")
  };
}

interface AuthorizationCodeOptions {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export async function exchangeAuthorizationCode(
  options: AuthorizationCodeOptions,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<StoredTokens> {
  const response = await fetcher("https://login.yotoplay.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: options.clientId,
      code_verifier: options.codeVerifier,
      code: options.code,
      redirect_uri: options.redirectUri
    })
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status})`);
  }
  const body = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) {
    throw new Error("Token exchange response was incomplete");
  }
  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    expiresAt: now() + (body.expires_in ?? 3600) * 1000
  };
}

interface TokenManagerOptions {
  clientId: string;
  store: TokenStore;
  fetcher?: typeof fetch;
  now?: () => number;
  withRefreshLock?: <T>(operation: () => Promise<T>) => Promise<T>;
}

export class TokenManager {
  private refreshPromise: Promise<string> | null = null;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: TokenManagerOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async getAccessToken(): Promise<string> {
    const tokens = await this.options.store.load();
    if (!tokens) {
      throw new Error("Login required");
    }
    if (tokens.expiresAt > this.now() + 30_000) {
      return tokens.accessToken;
    }
    if (!this.refreshPromise) {
      const refreshUnderLock = async () => {
        const latest = await this.options.store.load();
        if (!latest) {
          throw new Error("Login required");
        }
        if (latest.expiresAt > this.now() + 30_000) {
          return latest.accessToken;
        }
        if (!latest.refreshToken) {
          throw new Error("Login required: access token expired");
        }
        return this.refresh(latest.refreshToken);
      };
      const operation = this.options.withRefreshLock
        ? () => this.options.withRefreshLock!(refreshUnderLock)
        : refreshUnderLock;
      this.refreshPromise = operation().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async refresh(refreshToken: string): Promise<string> {
    const response = await this.fetcher("https://login.yotoplay.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.options.clientId,
        refresh_token: refreshToken
      })
    });
    if (!response.ok) {
      throw new Error(`Token refresh failed (${response.status})`);
    }
    const body = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
    };
    if (!body.access_token || !body.refresh_token) {
      throw new Error("Token refresh response was incomplete");
    }
    const replacement = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: this.now() + (body.expires_in ?? 3600) * 1000
    };
    await this.options.store.save(replacement);
    return replacement.accessToken;
  }
}

export function createFileRefreshLock(
  name = process.env.YOTO_TOKEN_STORE || "yoto-ai-skill"
): <T>(operation: () => Promise<T>) => Promise<T> {
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 16);
  const directory = join(tmpdir(), "yoto-ai-skill");
  const target = join(directory, `refresh-${digest}`);
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const handle = await openFile(target, "a", 0o600);
    await handle.close();
    const release = await lockfile.lock(target, {
      retries: { retries: 20, minTimeout: 50, maxTimeout: 250 },
      stale: 30_000
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  };
}

interface AuthorizationCodeRequest {
  authorizationUrl: URL;
  redirectUri: string;
  state: string;
}

type AuthorizationCodeProvider = (
  request: AuthorizationCodeRequest
) => Promise<{ code: string; state: string }>;

export function parseAuthorizationCallback(
  callback: URL
): { code: string; state: string } {
  const error = callback.searchParams.get("error");
  if (error) {
    const description =
      callback.searchParams.get("error_description") || "Authorization was denied";
    throw new Error(`Yoto authorization failed (${error}): ${description}`);
  }
  const code = callback.searchParams.get("code");
  const state = callback.searchParams.get("state");
  if (!code || !state) {
    throw new Error("Login callback was incomplete");
  }
  return { code, state };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderCallbackPage(
  status: "success" | "error",
  detail?: string
): string {
  const success = status === "success";
  const title = success ? "You’re signed in" : "Sign-in didn’t work";
  const description = success
    ? "You can close this tab and return to your AI assistant."
    : detail || "Return to your AI assistant for setup and recovery steps.";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Yoto AI</title>
  <style>
    :root { color-scheme: light; font-family: ui-rounded, "SF Pro Rounded", system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px;
      color: #28233f; background: #f6f3ff;
    }
    main {
      width: min(100%, 440px); padding: 40px 32px; text-align: center;
      background: #fff; border: 1px solid #e6e0f5; border-radius: 24px;
      box-shadow: 0 18px 50px rgba(57, 43, 92, .12);
    }
    .mark {
      width: 64px; height: 64px; margin: 0 auto 24px; display: grid; place-items: center;
      border-radius: 20px; color: #fff; background: ${success ? "#5b45d6" : "#c0445e"};
      font-size: 30px; font-weight: 800;
    }
    .brand { margin: 0 0 12px; color: #6e5bc7; font-size: 14px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0 0 12px; font-size: clamp(28px, 7vw, 36px); line-height: 1.1; }
    p { margin: 0; color: #655f78; font-size: 17px; line-height: 1.55; }
  </style>
</head>
<body>
  <main role="${success ? "status" : "alert"}">
    <div class="mark" aria-hidden="true">${success ? "✓" : "!"}</div>
    <p class="brand">Yoto AI</p>
    <h1>${title}</h1>
    <p>${escapeHtml(description)}</p>
  </main>
</body>
</html>`;
}

interface AuthSessionOptions {
  clientId: string;
  store: TokenStore;
  redirectUri?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  authorizationCodeProvider?: AuthorizationCodeProvider;
}

async function loopbackAuthorizationCode(
  request: AuthorizationCodeRequest
): Promise<{ code: string; state: string }> {
  const redirect = new URL(request.redirectUri);
  if (redirect.hostname !== "127.0.0.1") {
    throw new Error("OAuth redirect must use the 127.0.0.1 loopback address");
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Yoto login"));
    }, 120_000);
    const server = createServer((incoming, response) => {
      const callback = new URL(incoming.url ?? "/", request.redirectUri);
      if (callback.pathname !== redirect.pathname) {
        response.writeHead(404).end("Not found");
        return;
      }
      let result: { code: string; state: string };
      try {
        result = parseAuthorizationCallback(callback);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Yoto login failed";
        response.writeHead(400, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
          "X-Content-Type-Options": "nosniff"
        });
        response.end(renderCallbackPage("error", message));
        clearTimeout(timeout);
        server.close();
        reject(error);
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(renderCallbackPage("success"));
      clearTimeout(timeout);
      server.close();
      resolve(result);
    });
    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.listen(Number(redirect.port), redirect.hostname, async () => {
      try {
        await open(request.authorizationUrl.toString());
      } catch {
        process.stderr.write(`Open this URL to sign in:\n${request.authorizationUrl}\n`);
      }
    });
  });
}

export class AuthSession {
  private readonly redirectUri: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly authorizationCodeProvider: AuthorizationCodeProvider;

  constructor(private readonly options: AuthSessionOptions) {
    this.redirectUri = options.redirectUri ?? DEFAULT_REDIRECT_URI;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.authorizationCodeProvider =
      options.authorizationCodeProvider ?? loopbackAuthorizationCode;
  }

  async login(): Promise<{ authenticated: true; expiresAt: number }> {
    const pkce = createPkce();
    const authorizationUrl = buildAuthorizationUrl({
      clientId: this.options.clientId,
      redirectUri: this.redirectUri,
      codeChallenge: pkce.codeChallenge,
      state: pkce.state
    });
    const callback = await this.authorizationCodeProvider({
      authorizationUrl,
      redirectUri: this.redirectUri,
      state: pkce.state
    });
    if (callback.state !== pkce.state) {
      throw new Error("OAuth state mismatch");
    }
    const tokens = await exchangeAuthorizationCode(
      {
        clientId: this.options.clientId,
        code: callback.code,
        codeVerifier: pkce.codeVerifier,
        redirectUri: this.redirectUri
      },
      this.fetcher,
      this.now
    );
    await this.options.store.save(tokens);
    return { authenticated: true, expiresAt: tokens.expiresAt };
  }

  async status(): Promise<{ authenticated: boolean; expiresAt?: number }> {
    const tokens = await this.options.store.load();
    if (!tokens || (tokens.expiresAt <= this.now() && !tokens.refreshToken)) {
      return { authenticated: false };
    }
    return { authenticated: true, expiresAt: tokens.expiresAt };
  }

  async logout(): Promise<{ authenticated: false }> {
    await this.options.store.clear();
    return { authenticated: false };
  }
}
