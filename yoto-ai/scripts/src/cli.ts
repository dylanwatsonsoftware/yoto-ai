#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createYotoSdk } from "@yotoplay/yoto-sdk";
import {
  AuthSession,
  createFileRefreshLock,
  DEFAULT_REDIRECT_URI,
  KeychainTokenStore,
  TokenManager
} from "./auth.js";
import { executeCommand } from "./commands.js";
import { classifyError, renderHuman, requiresClientId } from "./cli-support.js";
import { failureEnvelope, redact, successEnvelope } from "./output.js";
import { YotoService } from "./yoto-service.js";

const rawArgs = process.argv.slice(2);
const json = rawArgs.includes("--json");
const args = rawArgs.filter((argument) => argument !== "--json");
const clientId = process.env.YOTO_CLIENT_ID;

if (!clientId && requiresClientId(args)) {
  const envelope = failureEnvelope(
    "CONFIG_ERROR",
    "YOTO_CLIENT_ID is required. Create a public client at https://dashboard.yoto.dev/.",
    false
  );
  process.stderr.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.exitCode = 2;
} else {
  const effectiveClientId = clientId ?? "";
  const store = new KeychainTokenStore();
  const auth = new AuthSession({
    clientId: effectiveClientId,
    redirectUri: process.env.YOTO_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    store
  });
  const tokenManager = new TokenManager({
    clientId: effectiveClientId,
    store,
    withRefreshLock: createFileRefreshLock()
  });
  const sdk = {
    devices: {
      getMyDevices: async () =>
        createYotoSdk({ jwt: await tokenManager.getAccessToken() }).devices.getMyDevices()
    },
    content: {
      getMyCards: async () =>
        createYotoSdk({ jwt: await tokenManager.getAccessToken() }).content.getMyCards(),
      getCard: async (cardId: string) =>
        createYotoSdk({ jwt: await tokenManager.getAccessToken() }).content.getCard(cardId)
    }
  };

  try {
    const result = redact(
      await executeCommand(args, {
        auth,
        service: new YotoService(sdk),
        readFile: (path) => readFile(path, "utf8"),
        tokenStore: store
      })
    );
    process.stdout.write(
      json ? `${JSON.stringify(successEnvelope(result), null, 2)}\n` : `${renderHuman(result)}\n`
    );
  } catch (error) {
    const classified = classifyError(error);
    const envelope = failureEnvelope(
      classified.code,
      classified.message,
      classified.retryable
    );
    process.stderr.write(
      json ? `${JSON.stringify(envelope, null, 2)}\n` : `${classified.message}\n`
    );
    process.exitCode = classified.exitCode;
  }
}
