import type { TokenStore } from "./auth.js";
import { validatePlaylistDraft } from "./playlist.js";
import { inspectPlaylistPackage } from "./package-contract.js";
import {
  applyPreview,
  createConfirmationToken,
  findSimilarPlaylists,
  previewCreate,
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
  writeConfirmationFile?(path: string, token: string): Promise<void>;
  tokenStore: TokenStore;
  writeApi?: YotoWriteApi;
  confirmationSecret?: string;
  checkpoint?: UploadCheckpoint;
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
    return { package: await inspectPlaylistPackage(inputPath), valid: true };
  }
  if (group === "playlist" && action === "preview-create") {
    const inputPath = optionValue(args, "--input");
    const playlistPackage = await inspectPlaylistPackage(inputPath);
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
    return previewCreate(inputPath, playlistPackage);
  }
  if (group === "playlist" && action === "preview-append") {
    const inputPath = optionValue(args, "--input");
    const cardId = optionValue(args, "--card-id");
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
    return previewCreate(inputPath, await inspectPlaylistPackage(inputPath), {
      cardId,
      title: card.title ?? "",
      tracks: existingTracks,
      metadata: card
    });
  }
  if (group === "playlist" && action === "confirm") {
    if (!dependencies.confirmationSecret) {
      throw new UsageError("YOTO_CONFIRMATION_SECRET is required");
    }
    if (!dependencies.writeConfirmationFile) {
      throw new UnsupportedOperationError(
        "Secure confirmation file output is unavailable"
      );
    }
    const preview = JSON.parse(
      await dependencies.readFile(optionValue(args, "--preview"))
    ) as PublishPreview;
    const confirmationFile = optionValue(args, "--confirmation-file");
    await dependencies.writeConfirmationFile(
      confirmationFile,
      createConfirmationToken(preview, dependencies.confirmationSecret)
    );
    return {
      confirmed: true,
      confirmationFile,
      expiresInSeconds: 15 * 60
    };
  }
  if (group === "playlist" && action === "apply") {
    if (!dependencies.confirmationSecret) {
      throw new UsageError("YOTO_CONFIRMATION_SECRET is required");
    }
    if (!dependencies.writeApi) {
      throw new UnsupportedOperationError("Yoto publishing adapter is unavailable");
    }
    const preview = JSON.parse(
      await dependencies.readFile(optionValue(args, "--preview"))
    ) as PublishPreview;
    const confirmationToken = (
      await dependencies.readFile(optionValue(args, "--confirmation-file"))
    ).trim();
    return applyPreview(
      preview,
      confirmationToken,
      dependencies.confirmationSecret,
      dependencies.writeApi,
      dependencies.checkpoint
    );
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
