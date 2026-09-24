import type { TokenStore } from "./auth.js";
import { validatePlaylistDraft } from "./playlist.js";
import { inspectPlaylistPackage } from "./package-contract.js";
import {
  applyPreview,
  appliedCardId,
  findSimilarPlaylists,
  previewCreate,
  previewRepairArtwork,
  previewRepairSongLayout,
  previewRepairTrackArtwork,
  verifyAppliedPreview,
  previewRepairTrackLabels,
  type PublishPreview,
  type YotoWriteApi,
  type UploadCheckpoint
} from "./publishing.js";
import type { YotoService } from "./yoto-service.js";

interface AuthCommands {
  login(): Promise<unknown>;
  status(): Promise<unknown>;
  logout(): Promise<unknown>;
}

interface CommandDependencies {
  auth: AuthCommands;
  service: YotoService;
  readFile(path: string): Promise<string>;
  tokenStore: TokenStore;
  writeApi?: YotoWriteApi;
  checkpoint?: UploadCheckpoint;
  inspectPackage?(path: string): Promise<Awaited<ReturnType<typeof inspectPlaylistPackage>>>;
}

export class UnsupportedOperationError extends Error {}
export class UsageError extends Error {}

function optionValue(args: string[], option: string): string {
  const index = args.indexOf(option);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`${option} is required`);
  }
  return value;
}

function optionalOptionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`${option} requires a value`);
  }
  return value;
}

function withVerification(result: unknown, verification: ReturnType<typeof verifyAppliedPreview>) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), verification };
  }
  return { result, verification };
}

export async function executeCommand(
  args: string[],
  dependencies: CommandDependencies
): Promise<unknown> {
  const [group, action, identifier] = args;

  if (group === "auth" && action === "login") {
    return dependencies.auth.login();
  }
  if (group === "auth" && action === "status") {
    return dependencies.auth.status();
  }
  if (group === "auth" && action === "logout") {
    return dependencies.auth.logout();
  }
  if (group === "devices" && action === "list") {
    return { devices: await dependencies.service.listDevices() };
  }
  if (group === "devices" && action === "status" && identifier) {
    return { device: await dependencies.service.getDevice(identifier) };
  }
  if (group === "library" && action === "list") {
    return { cards: await dependencies.service.listCards() };
  }
  if (group === "library" && action === "show" && identifier) {
    return { card: await dependencies.service.getCard(identifier) };
  }
  if (group === "playlist" && action === "draft") {
    const inputPath = optionValue(args, "--input");
    const draft = validatePlaylistDraft(JSON.parse(await dependencies.readFile(inputPath)));
    return { published: false, draft };
  }
  if (group === "playlist" && action === "inspect-package") {
    const inputPath = optionValue(args, "--input");
    return {
      package: await (dependencies.inspectPackage ?? inspectPlaylistPackage)(inputPath),
      valid: true
    };
  }
  if (group === "playlist" && action === "preview-create") {
    const inputPath = optionValue(args, "--input");
    const inspect = dependencies.inspectPackage ?? inspectPlaylistPackage;
    const playlistPackage = await inspect(inputPath);
    const similar = findSimilarPlaylists(
      playlistPackage.title,
      await dependencies.service.listCards()
    );
    if (similar.length) {
      const candidates = similar
        .map(
          (card) =>
            `${card.title} (${card.cardId}, ${card.match}, ${Math.round(card.score * 100)}%)`
        )
        .join("; ");
      throw new UsageError(
        `Possible duplicate Yoto playlist found: ${candidates}. Use playlist preview-append with the intended card ID, or choose a distinct title.`
      );
    }
    return previewCreate(
      inputPath,
      playlistPackage,
      undefined,
      undefined,
      args.includes("--single-track-chapters")
        ? "single-track-chapters"
        : undefined
    );
  }
  if (group === "playlist" && action === "preview-append") {
    const inputPath = optionValue(args, "--input");
    const cardId = optionValue(args, "--card-id");
    const finalTitle = optionalOptionValue(args, "--title");
    const card = (await dependencies.service.getCard(cardId)) as unknown as {
      title?: string;
      content?: { chapters?: Array<{ tracks?: Array<{ title?: string; duration?: number }> }> };
    };
    const existingTracks = (card.content?.chapters ?? []).flatMap((chapter) =>
      (chapter.tracks ?? []).map((track) => ({
        title: track.title ?? "",
        artist: "",
        duration: track.duration ?? 0
      }))
    );
    const inspect = dependencies.inspectPackage ?? inspectPlaylistPackage;
    return previewCreate(inputPath, await inspect(inputPath), {
      cardId,
      title: card.title ?? "",
      tracks: existingTracks,
      metadata: card
    }, finalTitle);
  }
  if (group === "playlist" && action === "preview-repair-artwork") {
    const inputPath = optionValue(args, "--input");
    const cardId = optionValue(args, "--card-id");
    const card = (await dependencies.service.getCard(cardId)) as unknown as {
      title?: string;
      content?: {
        chapters?: Array<{
          tracks?: Array<{ title?: string; duration?: number }>;
        }>;
      };
    };
    const existingTracks = (card.content?.chapters ?? []).flatMap((chapter) =>
      (chapter.tracks ?? []).map((track) => ({
        title: track.title ?? "",
        artist: "",
        duration: track.duration ?? 0
      }))
    );
    const inspect = dependencies.inspectPackage ?? inspectPlaylistPackage;
    return previewRepairArtwork(inputPath, await inspect(inputPath), {
      cardId,
      title: card.title ?? "",
      tracks: existingTracks,
      metadata: card
    });
  }
  if (group === "playlist" && action === "preview-repair-song-layout") {
    const inputPath = optionValue(args, "--input");
    const cardId = optionValue(args, "--card-id");
    const chapterKey = optionValue(args, "--chapter-key");
    const card = (await dependencies.service.getCard(cardId)) as unknown as {
      title?: string;
      content?: {
        chapters?: Array<{
          tracks?: Array<{ title?: string; duration?: number }>;
        }>;
      };
    };
    const existingTracks = (card.content?.chapters ?? []).flatMap((chapter) =>
      (chapter.tracks ?? []).map((track) => ({
        title: track.title ?? "",
        artist: "",
        duration: track.duration ?? 0
      }))
    );
    const inspect = dependencies.inspectPackage ?? inspectPlaylistPackage;
    return previewRepairSongLayout(inputPath, await inspect(inputPath), {
      cardId,
      title: card.title ?? "",
      tracks: existingTracks,
      metadata: card
    }, chapterKey);
  }
  if (group === "playlist" && action === "preview-repair-track-labels") {
    const inputPath = optionValue(args, "--input");
    const cardId = optionValue(args, "--card-id");
    const card = (await dependencies.service.getCard(cardId)) as unknown as {
      title?: string;
      content?: {
        chapters?: Array<{
          tracks?: Array<{ title?: string; duration?: number }>;
        }>;
      };
    };
    const existingTracks = (card.content?.chapters ?? []).flatMap((chapter) =>
      (chapter.tracks ?? []).map((track) => ({
        title: track.title ?? "",
        artist: "",
        duration: track.duration ?? 0
      }))
    );
    const inspect = dependencies.inspectPackage ?? inspectPlaylistPackage;
    return previewRepairTrackLabels(inputPath, await inspect(inputPath), {
      cardId,
      title: card.title ?? "",
      tracks: existingTracks,
      metadata: card
    });
  }
  if (group === "playlist" && action === "preview-repair-track-artwork") {
    const inputPath = optionValue(args, "--input");
    const cardId = optionValue(args, "--card-id");
    const chapterKeys = optionValue(args, "--chapter-keys")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    const card = (await dependencies.service.getCard(cardId)) as unknown as {
      title?: string;
      content?: {
        chapters?: Array<{
          tracks?: Array<{ title?: string; duration?: number }>;
        }>;
      };
    };
    const existingTracks = (card.content?.chapters ?? []).flatMap((chapter) =>
      (chapter.tracks ?? []).map((track) => ({
        title: track.title ?? "",
        artist: "",
        duration: track.duration ?? 0
      }))
    );
    const inspect = dependencies.inspectPackage ?? inspectPlaylistPackage;
    return previewRepairTrackArtwork(inputPath, await inspect(inputPath), {
      cardId,
      title: card.title ?? "",
      tracks: existingTracks,
      metadata: card
    }, chapterKeys);
  }
  if (group === "playlist" && action === "apply") {
    if (!dependencies.writeApi) {
      throw new UnsupportedOperationError("Yoto publishing adapter is unavailable");
    }
    const preview = JSON.parse(
      await dependencies.readFile(optionValue(args, "--preview"))
    ) as PublishPreview;
    const result = await applyPreview(
      preview,
      dependencies.writeApi,
      dependencies.checkpoint
    );
    const cardId = appliedCardId(result);
    if (!cardId) {
      return withVerification(result, {
        verified: false,
        source: "readback",
        issues: ["The successful mutation response did not include a card ID for read-back verification."]
      });
    }
    let card: unknown;
    try {
      card = await dependencies.service.getCard(cardId);
    } catch {
      try {
        card = await dependencies.service.getCard(cardId);
      } catch {
        return withVerification(result, {
          cardId,
          verified: false,
          source: "readback",
          issues: [
            "The card mutation succeeded, but the saved card could not be read back after one retry. Do not repeat the mutation."
          ]
        });
      }
    }
    return withVerification(result, verifyAppliedPreview(preview, card, cardId));
  }

  if (
    group === "devices" ||
    group === "playlist" ||
    group === "content" ||
    group === "library"
  ) {
    throw new UnsupportedOperationError(
      "This safe MVP does not publish content or control players."
    );
  }
  throw new UsageError("Unknown command");
}
