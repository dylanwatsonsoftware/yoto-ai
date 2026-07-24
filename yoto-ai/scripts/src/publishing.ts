import {
  createHash,
  createHmac,
  timingSafeEqual
} from "node:crypto";
import type { PlaylistPackage } from "./package-contract.js";

export interface ExistingTrack {
  sourceId?: string;
  checksum?: string;
  title: string;
  artist: string;
  duration: number;
}

export interface ExistingPlaylist {
  cardId: string;
  title: string;
  tracks: ExistingTrack[];
  metadata?: unknown;
}

export interface SimilarPlaylist {
  cardId: string;
  title: string;
  match: "exact" | "similar";
  score: number;
}

export interface PublishPreview {
  version: 1;
  operation: "create" | "append";
  packageDirectory: string;
  package: PlaylistPackage;
  cardId?: string;
  existing?: ExistingPlaylist;
  tracksToAdd: PlaylistPackage["tracks"];
  duplicates: Array<
    PlaylistPackage["tracks"][number] & {
      reason: "sourceId" | "checksum" | "metadata";
    }
  >;
  confirmationsRequired: 1;
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function titleTokens(value: string): string[] {
  const stopWords = new Set(["a", "an", "and", "the"]);
  return normalized(value)
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token && !stopWords.has(token));
}

function tokenDice(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return (2 * intersection) / (a.size + b.size);
}

export function findSimilarPlaylists(
  title: string,
  cards: Array<{ cardId?: string; title?: string }>
): SimilarPlaylist[] {
  const wanted = titleTokens(title);
  return cards.flatMap((card) => {
    if (!card.cardId || !card.title) return [];
    const candidate = titleTokens(card.title);
    const score = tokenDice(wanted, candidate);
    const exact = wanted.join(" ") === candidate.join(" ");
    if (!exact && score < 0.75) return [];
    return [{
      cardId: card.cardId,
      title: card.title,
      match: exact ? "exact" as const : "similar" as const,
      score
    }];
  });
}

function duplicateReason(
  track: PlaylistPackage["tracks"][number],
  existing: ExistingTrack[]
): "sourceId" | "checksum" | "metadata" | undefined {
  if (existing.some((item) => item.sourceId === track.sourceId)) return "sourceId";
  if (existing.some((item) => item.checksum === track.audio.sha256)) return "checksum";
  if (
    existing.some(
      (item) =>
        normalized(item.title) === normalized(track.title) &&
        normalized(item.artist) === normalized(track.artist) &&
        Math.abs(item.duration - track.audio.duration) <= 1
    )
  ) return "metadata";
  return undefined;
}

export function previewCreate(
  packageDirectory: string,
  manifest: PlaylistPackage,
  existing?: ExistingPlaylist
): PublishPreview {
  const duplicates: PublishPreview["duplicates"] = [];
  const tracksToAdd = manifest.tracks.filter((track) => {
    const reason = duplicateReason(track, existing?.tracks ?? []);
    if (reason) duplicates.push({ ...track, reason });
    return !reason;
  });
  return {
    version: 1,
    operation: existing ? "append" : "create",
    packageDirectory,
    package: manifest,
    cardId: existing?.cardId,
    existing,
    tracksToAdd,
    duplicates,
    confirmationsRequired: 1
  };
}

function previewDigest(preview: PublishPreview): string {
  return createHash("sha256").update(JSON.stringify(preview)).digest("base64url");
}

export function createConfirmationToken(
  preview: PublishPreview,
  secret: string,
  now = Date.now()
): string {
  const body = Buffer.from(
    JSON.stringify({
      digest: previewDigest(preview),
      expiresAt: now + 15 * 60_000
    })
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyConfirmation(
  preview: PublishPreview,
  token: string,
  secret: string,
  now = Date.now()
): void {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new Error("Invalid confirmation token");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid confirmation token");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
    digest: string;
    expiresAt: number;
  };
  if (payload.expiresAt < now) throw new Error("Confirmation token expired");
  if (payload.digest !== previewDigest(preview)) {
    throw new Error("Confirmation does not match preview");
  }
}

export interface YotoWriteApi {
  uploadAudio(
    track: PlaylistPackage["tracks"][number],
    root: string,
    previous: unknown,
    saveCheckpoint: (result: unknown) => Promise<void>
  ): Promise<unknown>;
  isAudioComplete?(result: unknown): boolean;
  uploadCover(cover: PlaylistPackage["cover"], root: string): Promise<unknown>;
  uploadIcon(icon: NonNullable<PlaylistPackage["tracks"][number]["icon"]>, root: string): Promise<unknown>;
  mutateCard(input: {
    preview: PublishPreview;
    audio: unknown[];
    cover: unknown;
    icons: Array<unknown | null>;
  }): Promise<unknown>;
}

export interface UploadCheckpoint {
  get(checksum: string): Promise<unknown | undefined>;
  put(checksum: string, result: unknown): Promise<void>;
}

export async function applyPreview(
  preview: PublishPreview,
  token: string,
  secret: string,
  api: YotoWriteApi,
  checkpoint?: UploadCheckpoint
): Promise<unknown> {
  verifyConfirmation(preview, token, secret);
  const root = preview.packageDirectory;
  const audio = [];
  const icons: Array<unknown | null> = [];
  for (const track of preview.tracksToAdd) {
    let audioResult = await checkpoint?.get(track.audio.sha256);
    if (
      audioResult === undefined ||
      (api.isAudioComplete && !api.isAudioComplete(audioResult))
    ) {
      audioResult = await api.uploadAudio(
        track,
        root,
        audioResult,
        async (result) => checkpoint?.put(track.audio.sha256, result)
      );
      await checkpoint?.put(track.audio.sha256, audioResult);
    }
    audio.push(audioResult);
    if (track.icon) {
      let iconResult = await checkpoint?.get(track.icon.sha256);
      if (iconResult === undefined) {
        iconResult = await api.uploadIcon(track.icon, root);
        await checkpoint?.put(track.icon.sha256, iconResult);
      }
      icons.push(iconResult);
    } else {
      icons.push(null);
    }
  }
  let cover = await checkpoint?.get(preview.package.cover.sha256);
  if (cover === undefined) {
    cover = await api.uploadCover(preview.package.cover, root);
    await checkpoint?.put(preview.package.cover.sha256, cover);
  }
  // Deliberately exactly once: callers may resume media uploads but must never
  // automatically retry the final card mutation.
  return api.mutateCard({ preview, audio, cover, icons });
}
