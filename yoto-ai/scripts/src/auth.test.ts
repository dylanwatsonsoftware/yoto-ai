import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizationUrl,
  AuthSession,
  exchangeAuthorizationCode,
  MemoryTokenStore,
  parseAuthorizationCallback,
  renderCallbackPage,
  TokenManager,
  type StoredTokens
} from "./auth.js";

describe("Yoto OAuth", () => {
  it("builds an authorization URL with PKCE and the required library and icon scopes", () => {
    const url = buildAuthorizationUrl({
      clientId: "client-123",
      redirectUri: "http://127.0.0.1:8787/callback",
      codeChallenge: "challenge",
      state: "state-123"
    });

    expect(url.origin + url.pathname).toBe("https://login.yotoplay.com/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(
      [
        "family:library:view",
        "user:content:view",
        "user:content:manage",
        "user:icons:manage"
      ].sort()
    );
  });

  it("refreshes once for concurrent callers and atomically stores the replacement token", async () => {
    const expired: StoredTokens = {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: 1
    };
    const store = new MemoryTokenStore(expired);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const manager = new TokenManager({
      clientId: "client-123",
      store,
      fetcher,
      now: () => 10_000
    });

    const [first, second] = await Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken()
    ]);

    expect(first).toBe("new-access");
    expect(second).toBe("new-access");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await store.load()).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh"
    });
  });

  it("accepts a token response without offline access or a refresh token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access",
          expires_in: 3600
        }),
        { status: 200 }
      )
    );

    const tokens = await exchangeAuthorizationCode(
      {
        clientId: "client-123",
        code: "auth-code",
        codeVerifier: "verifier",
        redirectUri: "http://127.0.0.1:8787/callback"
      },
      fetcher,
      () => 1000
    );

    const request = fetcher.mock.calls[0]?.[1];
    expect(String(request?.body)).not.toContain("client_secret");
    expect(tokens).toEqual({
      accessToken: "access",
      expiresAt: 3_601_000
    });
  });

  it("requires login again when a non-refreshable access token expires", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const manager = new TokenManager({
      clientId: "client-123",
      store: new MemoryTokenStore({
        accessToken: "expired-access",
        expiresAt: 1
      }),
      fetcher,
      now: () => 10_000
    });

    await expect(manager.getAccessToken()).rejects.toThrow(/login required/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces an OAuth callback denial immediately", () => {
    expect(() =>
      parseAuthorizationCallback(
        new URL(
          "http://127.0.0.1:8787/callback?error=access_denied&error_description=Scope%20not%20approved&state=abc"
        )
      )
    ).toThrow("Yoto authorization failed (access_denied): Scope not approved");
  });

  it("renders a branded success callback page", () => {
    const html = renderCallbackPage("success");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Yoto AI");
    expect(html).toContain("You’re signed in");
    expect(html).toContain("You can close this tab");
    expect(html).not.toContain("<button");
  });

  it("renders and escapes a helpful failure callback page", () => {
    const html = renderCallbackPage("error", "Denied <unsafe>");

    expect(html).toContain("Sign-in didn’t work");
    expect(html).toContain("Denied &lt;unsafe&gt;");
    expect(html).not.toContain("Denied <unsafe>");
  });

  it("reports status without exposing stored tokens and clears them on logout", async () => {
    const store = new MemoryTokenStore({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 100_000
    });
    const session = new AuthSession({
      clientId: "client-123",
      store,
      now: () => 1_000
    });

    await expect(session.status()).resolves.toEqual({
      authenticated: true,
      expiresAt: 100_000
    });
    await expect(session.logout()).resolves.toEqual({ authenticated: false });
    await expect(store.load()).resolves.toBeNull();
  });

  it("reports an expired non-refreshable session as unauthenticated", async () => {
    const session = new AuthSession({
      clientId: "client-123",
      store: new MemoryTokenStore({
        accessToken: "expired",
        expiresAt: 1
      }),
      now: () => 10_000
    });

    await expect(session.status()).resolves.toEqual({ authenticated: false });
  });

  it("stores tokens after a successful login callback", async () => {
    const store = new MemoryTokenStore();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600
        }),
        { status: 200 }
      )
    );
    const session = new AuthSession({
      clientId: "client-123",
      store,
      fetcher,
      now: () => 1000,
      authorizationCodeProvider: async ({ state }) => ({
        code: "authorization-code",
        state
      })
    });

    await expect(session.login()).resolves.toMatchObject({ authenticated: true });
    await expect(store.load()).resolves.toMatchObject({
      accessToken: "access",
      refreshToken: "refresh"
    });
  });

  it("rechecks the keychain under a shared refresh lock across manager instances", async () => {
    const store = new MemoryTokenStore({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: 1
    });
    let queue = Promise.resolve();
    const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600
        }),
        { status: 200 }
      )
    );
    const options = {
      clientId: "client-123",
      store,
      fetcher,
      now: () => 10_000,
      withRefreshLock: withLock
    };

    const results = await Promise.all([
      new TokenManager(options).getAccessToken(),
      new TokenManager(options).getAccessToken()
    ]);

    expect(results).toEqual(["new-access", "new-access"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
