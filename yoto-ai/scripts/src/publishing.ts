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
  operation:
    | "create"
    | "append"
    | "repair-artwork"
    | "repair-song-layout"
    | "repair-track-artwork"
    | "repair-track-labels";
  packageDirectory: string;
  package: PlaylistPackage;
  cardId?: string;
  finalTitle?: string;
  chapterLayout?: "grouped" | "single-track-chapters";
  targetChapterKey?: string;
  targetChapterKeys?: string[];
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
  existing?: ExistingPlaylist,
  finalTitle?: string,
  chapterLayout?: "grouped" | "single-track-chapters"
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
    ...(finalTitle ? { finalTitle } : {}),
    ...(chapterLayout ? { chapterLayout } : {}),
    existing,
    tracksToAdd,
    duplicates,
    confirmationsRequired: 1
  };
}

export interface ApplyVerification {
  cardId?: string;
  verified: boolean;
  source: "readback";
  issues: string[];
}

type PersistedTrack = {
  title?: string;
  overlayLabel?: string;
};

type PersistedChapter = {
  key?: string;
  title?: string;
  overlayLabel?: string;
  tracks?: PersistedTrack[];
};

function persistedChapters(card: unknown): PersistedChapter[] {
  const candidate = card as {
    card?: { content?: { chapters?: PersistedChapter[] } };
    content?: { chapters?: PersistedChapter[] };
  } | null;
  return candidate?.card?.content?.chapters ?? candidate?.content?.chapters ?? [];
}

function verifyChapterKeys(chapters: PersistedChapter[], issues: string[]): void {
  const keys = chapters.map((chapter) => chapter.key).filter((key): key is string => Boolean(key));
  if (keys.length !== chapters.length) issues.push("Every chapter must have a key.");
  if (keys.some((key) => key.length > 20)) issues.push("Every chapter key must be at most 20 characters.");
  if (new Set(keys).size !== keys.length) issues.push("Chapter keys must be unique.");
}

function verifySingleTrackChapters(
  chapters: PersistedChapter[],
  expectedTracks: PlaylistPackage["tracks"],
  labelOffset: number,
  issues: string[]
): void {
  if (chapters.length !== expectedTracks.length) {
    issues.push(
      `Expected ${expectedTracks.length} single-track chapters but found ${chapters.length}.`
    );
    return;
  }
  chapters.forEach((chapter, index) => {
    const expected = expectedTracks[index];
    const label = String(labelOffset + index + 1);
    if (chapter.tracks?.length !== 1) {
      issues.push(`Chapter ${label} is not a single-track chapter.`);
      return;
    }
    if (normalized(chapter.title ?? "") !== normalized(expected?.title ?? "")) {
      issues.push(`Chapter ${label} title does not match the preview.`);
    }
    if (chapter.overlayLabel !== label || chapter.tracks[0]?.overlayLabel !== label) {
      issues.push(`Chapter ${label} does not preserve navigation label ${label}.`);
    }
  });
}

function existingChapters(preview: PublishPreview): PersistedChapter[] {
  return persistedChapters(preview.existing?.metadata);
}

export function appliedCardId(result: unknown): string | undefined {
  const candidate = result as {
    cardId?: string;
    card?: { cardId?: string };
  } | null;
  return candidate?.cardId ?? candidate?.card?.cardId;
}

export function verifyAppliedPreview(
  preview: PublishPreview,
  card: unknown,
  cardId?: string
): ApplyVerification {
  const chapters = persistedChapters(card);
  const issues: string[] = [];
  verifyChapterKeys(chapters, issues);

  if (preview.operation === "create") {
    if (preview.chapterLayout === "single-track-chapters") {
      verifySingleTrackChapters(chapters, preview.package.tracks, 0, issues);
    } else {
      if (chapters.length !== 1) {
        issues.push(`Expected one grouped chapter but found ${chapters.length}.`);
      } else {
        const tracks = chapters[0]?.tracks ?? [];
        if (tracks.length !== preview.package.tracks.length) {
          issues.push(`Expected ${preview.package.tracks.length} grouped tracks but found ${tracks.length}.`);
        }
        tracks.forEach((track, index) => {
          if (track.overlayLabel !== String(index + 1)) {
            issues.push(`Grouped track ${index + 1} does not preserve navigation label ${index + 1}.`);
          }
        });
      }
    }
  } else if (preview.operation === "append") {
    const prior = existingChapters(preview);
    const appended = chapters.slice(prior.length);
    const preservesSingleTrackLayout =
      prior.length > 0 && prior.every((chapter) => chapter.tracks?.length === 1);
    if (preservesSingleTrackLayout) {
      verifySingleTrackChapters(appended, preview.tracksToAdd, prior.length, issues);
    } else if (appended.length !== 1) {
      issues.push(`Expected one appended grouped chapter but found ${appended.length}.`);
    }
  } else if (preview.operation === "repair-song-layout") {
    const prior = existingChapters(preview);
    const targetIndex = prior.findIndex((chapter) => chapter.key === preview.targetChapterKey);
    const repaired = chapters.slice(targetIndex, targetIndex + preview.package.tracks.length);
    verifySingleTrackChapters(repaired, preview.package.tracks, targetIndex, issues);
  } else if (chapters.length !== existingChapters(preview).length) {
    issues.push("The saved chapter count does not match the confirmed repair preview.");
  }

  return {
    ...(cardId ? { cardId } : {}),
    verified: issues.length === 0,
    source: "readback",
    issues
  };
}

export function previewRepairArtwork(
  packageDirectory: string,
  manifest: PlaylistPackage,
  existing: ExistingPlaylist
): PublishPreview {
  if (manifest.tracks.length !== existing.tracks.length) {
    throw new Error(
      `Artwork repair track count mismatch: package has ${manifest.tracks.length}, card has ${existing.tracks.length}`
    );
  }
  return {
    version: 1,
    operation: "repair-artwork",
    packageDirectory,
    package: manifest,
    cardId: existing.cardId,
    existing,
    tracksToAdd: [],
    duplicates: [],
    confirmationsRequired: 1
  };
}

export function previewRepairTrackLabels(
  packageDirectory: string,
  manifest: PlaylistPackage,
  existing: ExistingPlaylist
): PublishPreview {
  if (manifest.tracks.length !== existing.tracks.length) {
    throw new Error(
      `Track-label repair count mismatch: package has ${manifest.tracks.length}, card has ${existing.tracks.length}`
    );
  }
  manifest.tracks.forEach((track, index) => {
    const existingTrack = existing.tracks[index];
    if (
      track.position !== index + 1 ||
      !existingTrack ||
      normalized(track.title) !== normalized(existingTrack.title)
    ) {
      throw new Error(`Track-label repair order mismatch at position ${index + 1}`);
    }
  });
  return {
    version: 1,
    operation: "repair-track-labels",
    packageDirectory,
    package: manifest,
    cardId: existing.cardId,
    existing,
    tracksToAdd: [],
    duplicates: [],
    confirmationsRequired: 1
  };
}

export function previewRepairSongLayout(
  packageDirectory: string,
  manifest: PlaylistPackage,
  existing: ExistingPlaylist,
  targetChapterKey: string
): PublishPreview {
  const card = existing.metadata as {
    content?: { chapters?: Array<{ key?: string; tracks?: Array<{ title?: string }> }> };
  };
  const chapters = card.content?.chapters ?? [];
  const targetIndex = chapters.findIndex((chapter) => chapter.key === targetChapterKey);
  if (targetIndex < 0) {
    throw new Error(`Target chapter ${targetChapterKey} was not found`);
  }
  if (targetIndex !== chapters.length - 1) {
    throw new Error("Song-layout repair is limited to the final imported chapter");
  }
  const targetTracks = chapters[targetIndex]?.tracks ?? [];
  if (
    targetTracks.length !== manifest.tracks.length ||
    targetTracks.some(
      (track, index) => normalized(track.title ?? "") !== normalized(manifest.tracks[index]?.title ?? "")
    )
  ) {
    throw new Error("Target chapter tracks do not exactly match the repair package");
  }
  return {
    version: 1,
    operation: "repair-song-layout",
    packageDirectory,
    package: manifest,
    cardId: existing.cardId,
    targetChapterKey,
    existing,
    tracksToAdd: [],
    duplicates: [],
    confirmationsRequired: 1
  };
}

export function previewRepairTrackArtwork(
  packageDirectory: string,
  manifest: PlaylistPackage,
  existing: ExistingPlaylist,
  targetChapterKeys: string[]
): PublishPreview {
  if (
    targetChapterKeys.length !== manifest.tracks.length ||
    new Set(targetChapterKeys).size !== targetChapterKeys.length
  ) {
    throw new Error("Target chapter keys must uniquely match every package track");
  }
  const card = existing.metadata as {
    content?: {
      chapters?: Array<{
        key?: string;
        title?: string;
        tracks?: Array<{ title?: string }>;
      }>;
    };
  };
  const chapters = card.content?.chapters ?? [];
  targetChapterKeys.forEach((key, index) => {
    const chapter = chapters.find((candidate) => candidate.key === key);
    const manifestTrack = manifest.tracks[index];
    if (!chapter || chapter.tracks?.length !== 1 || !manifestTrack) {
      throw new Error(`Target chapter ${key} is not a single-track song chapter`);
    }
    if (
      normalized(chapter.title ?? chapter.tracks[0]?.title ?? "") !==
      normalized(manifestTrack.title)
    ) {
      throw new Error(`Target chapter ${key} does not match ${manifestTrack.title}`);
    }
    if (!manifestTrack.icon) {
      throw new Error(`Missing replacement icon for ${manifestTrack.title}`);
    }
  });
  return {
    version: 1,
    operation: "repair-track-artwork",
    packageDirectory,
    package: manifest,
    cardId: existing.cardId,
    targetChapterKeys,
    existing,
    tracksToAdd: [],
    duplicates: [],
    confirmationsRequired: 1
  };
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
  api: YotoWriteApi,
  checkpoint?: UploadCheckpoint
): Promise<unknown> {
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
  if (
    preview.operation === "repair-artwork" ||
    preview.operation === "repair-track-artwork"
  ) {
    for (const track of preview.package.tracks) {
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
  }
  let cover: unknown = null;
  if (
    preview.operation !== "repair-song-layout" &&
    preview.operation !== "repair-track-artwork" &&
    preview.operation !== "repair-track-labels"
  ) {
    cover = await checkpoint?.get(preview.package.cover.sha256);
    if (cover === undefined) {
      cover = await api.uploadCover(preview.package.cover, root);
      await checkpoint?.put(preview.package.cover.sha256, cover);
    }
  }
  // Deliberately exactly once: callers may resume media uploads but must never
  // automatically retry the final card mutation.
  return api.mutateCard({ preview, audio, cover, icons });
}
