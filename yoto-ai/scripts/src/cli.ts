#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir, platform } from "node:os";
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
import type { YotoWriteApi } from "./publishing.js";
import { JsonUploadCheckpoint } from "./checkpoint.js";

const rawArgs = process.argv.slice(2);
const json = rawArgs.includes("--json");
const outputIndex = rawArgs.indexOf("--output");
const outputPath = outputIndex >= 0 ? rawArgs[outputIndex + 1] : undefined;
const args = rawArgs.filter(
  (argument, index) =>
    argument !== "--json" && index !== outputIndex && index !== outputIndex + 1
);
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
  const writeApi: YotoWriteApi = {
    uploadAudio: async (track, root) => {
      const yoto = createYotoSdk({ jwt: await tokenManager.getAccessToken(), retries: 0 });
      const upload = await yoto.media.getUploadUrlForTranscode(
        track.audio.sha256,
        basename(track.audio.path)
      );
      await yoto.media.uploadFile(upload.uploadUrl, await readFile(join(root, track.audio.path)));
      return yoto.media.getTranscodedUpload(upload.uploadId, true);
    },
    uploadCover: async (cover, root) => {
      const response = await fetch(
        "https://api.yotoplay.com/media/coverImage/user/me/upload?autoconvert=true&coverType=default",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await tokenManager.getAccessToken()}`,
            "Content-Type": "image/png"
          },
          body: await readFile(join(root, cover.path))
        }
      );
      if (!response.ok) throw new Error(`Cover upload failed: ${response.status}`);
      return response.json();
    },
    uploadIcon: async (icon, root) => {
      const response = await fetch(
        `https://api.yotoplay.com/media/displayIcons/user/me/upload?autoConvert=false&filename=${encodeURIComponent(basename(icon.path))}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await tokenManager.getAccessToken()}`,
            "Content-Type": "image/png"
          },
          body: await readFile(join(root, icon.path))
        }
      );
      if (!response.ok) throw new Error(`Icon upload failed: ${response.status}`);
      return response.json();
    },
    mutateCard: async ({ preview, audio, cover, icons }) => {
      const previous = preview.existing?.metadata as
        | { content?: Record<string, unknown>; metadata?: Record<string, unknown> }
        | undefined;
      const existingChapters =
        (previous?.content?.chapters as unknown[] | undefined) ?? [];
      const chapter = {
        key: `import-${preview.package.source.id}`,
        title: preview.package.title,
        defaultTrackDisplay: "1",
        defaultTrackAmbient: "none",
        display: cover,
        tracks: preview.tracksToAdd.map((track, index) => ({
          key: track.sourceId,
          uid: track.sourceId,
          title: track.title,
          trackUrl: (audio[index] as { url?: string }).url,
          format: track.audio.format,
          type: "audio",
          duration: track.audio.duration,
          fileSize: 0,
          display: icons[index]
        }))
      };
      const card = {
        ...(preview.cardId ? { cardId: preview.cardId } : {}),
        title: preview.existing?.title || preview.package.title,
        content: {
          ...(previous?.content ?? {}),
          chapters: [...existingChapters, chapter]
        },
        metadata: {
          ...(previous?.metadata ?? {}),
          source: {
            description: preview.package.source.description,
            permission: preview.package.source.permission
          }
        }
      };
      return createYotoSdk({
        jwt: await tokenManager.getAccessToken(),
        retries: 0
      }).content.updateCard(card);
    }
  };

  try {
    const result = redact(
      await executeCommand(args, {
        auth,
        service: new YotoService(sdk),
        readFile: (path) => readFile(path, "utf8"),
        tokenStore: store,
        writeApi,
        confirmationSecret: process.env.YOTO_CONFIRMATION_SECRET,
        checkpoint: new JsonUploadCheckpoint(
          join(
            process.env.XDG_CACHE_HOME ||
              (platform() === "darwin"
                ? join(homedir(), "Library", "Caches")
                : join(homedir(), ".cache")),
            "yoto-ai",
            "upload-checkpoints.json"
          )
        )
      })
    );
    if (outputPath) {
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
        mode: 0o600
      });
    }
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
