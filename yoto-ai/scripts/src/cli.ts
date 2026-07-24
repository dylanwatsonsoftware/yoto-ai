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
import {
  classifyError,
  loadLocalEnvironmentFile,
  parseCliArguments,
  renderHuman,
  requiresClientId,
  writePrivateFile
} from "./cli-support.js";
import { failureEnvelope, redact, successEnvelope } from "./output.js";
import { YotoService } from "./yoto-service.js";
import type { YotoWriteApi } from "./publishing.js";
import { JsonUploadCheckpoint } from "./checkpoint.js";
import {
  buildYotoCard,
  isCompletedTranscode,
  postYotoCard,
  waitForTranscode
} from "./yoto-card.js";

loadLocalEnvironmentFile();

function audioContentType(format: string): string {
  const types: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    opus: "audio/ogg"
  };
  return types[format.toLowerCase()] || "application/octet-stream";
}

const rawArgs = process.argv.slice(2);
const { args, json, outputPath } = parseCliArguments(rawArgs);
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
    isAudioComplete: isCompletedTranscode,
    uploadAudio: async (track, root, previous, saveCheckpoint) => {
      const yoto = createYotoSdk({ jwt: await tokenManager.getAccessToken(), retries: 0 });
      let uploadId = (previous as { uploadId?: string } | null)?.uploadId;
      if (!uploadId) {
        const upload = await yoto.media.getUploadUrlForTranscode(
          track.audio.sha256,
          basename(track.audio.path)
        );
        const response = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": audioContentType(track.audio.format) },
          body: await readFile(join(root, track.audio.path))
        });
        if (!response.ok) {
          throw new Error(`Audio upload failed (${response.status}): ${await response.text()}`);
        }
        uploadId = upload.uploadId;
        await saveCheckpoint({ uploadId });
      }
      return waitForTranscode(uploadId, (id) =>
        yoto.media.getTranscodedUpload(id, true)
      );
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
      const card = buildYotoCard({
        preview,
        audio: audio as Parameters<typeof buildYotoCard>[0]["audio"],
        cover,
        icons
      });
      return postYotoCard(card, await tokenManager.getAccessToken());
    }
  };

  try {
    const result = redact(
      await executeCommand(args, {
        auth,
        service: new YotoService(sdk),
        readFile: (path) => readFile(path, "utf8"),
        writeConfirmationFile: async (path, token) => {
          await writePrivateFile(path, `${token}\n`);
        },
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
