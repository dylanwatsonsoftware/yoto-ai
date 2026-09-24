import { createHash } from "node:crypto";
import type { PublishPreview } from "./publishing.js";

export interface CompletedTranscode {
  transcodedSha256: string;
  transcodedInfo: {
    duration: number;
    fileSize: number;
    channels?: "mono" | "stereo";
    format: string;
  };
}

export function isCompletedTranscode(value: unknown): value is CompletedTranscode {
  const candidate = value as Partial<CompletedTranscode> | null;
  return Boolean(
    candidate?.transcodedSha256 &&
      candidate.transcodedInfo &&
      Number.isFinite(candidate.transcodedInfo.duration) &&
      Number.isFinite(candidate.transcodedInfo.fileSize)
  );
}

export async function waitForTranscode(
  uploadId: string,
  getTranscode: (uploadId: string) => Promise<unknown>,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<CompletedTranscode> {
  const attempts = options.attempts ?? 60;
  const delayMs = options.delayMs ?? 1_000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await getTranscode(uploadId);
    if (isCompletedTranscode(result)) return result;
    if (attempt < attempts - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Yoto transcoding timed out for upload ${uploadId}`);
}

interface CardMutationResponse {
  ok: boolean;
  status: number;
  json?(): Promise<unknown>;
  text(): Promise<string>;
}

type CardMutationRequest = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<CardMutationResponse>;

export async function postYotoCard(
  card: Record<string, unknown>,
  accessToken: string,
  request: CardMutationRequest = fetch
): Promise<unknown> {
  const response = await request("https://api.yotoplay.com/content", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(card)
  });
  if (!response.ok) {
    const body = await response.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body) as {
        message?: string;
        error?: string | { message?: string };
      };
      detail =
        parsed.message ||
        (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) ||
        body;
    } catch {
      // Preserve non-JSON validation responses verbatim.
    }
    throw new Error(
      `Yoto card mutation failed (${response.status})${detail ? `: ${detail}` : ""}`
    );
  }
  return response.json ? response.json() : undefined;
}

function iconReference(value: unknown): string | null {
  const mediaId = (value as { displayIcon?: { mediaId?: string } } | null)
    ?.displayIcon?.mediaId;
  return mediaId ? `yoto:#${mediaId}` : null;
}

function yotoFormat(format: string): string {
  return format === "m4a" ? "x-m4a" : format;
}

function chapterKey(sourceId: string): string {
  const digest = createHash("sha256").update(sourceId).digest("hex");
  return `import-${digest.slice(0, 13)}`;
}

export function buildYotoCard(input: {
  preview: PublishPreview;
  audio: CompletedTranscode[];
  cover: unknown;
  icons: Array<unknown | null>;
}): Record<string, unknown> {
  const previous = input.preview.existing?.metadata as
    | { content?: Record<string, unknown>; metadata?: Record<string, unknown> }
    | undefined;
  const existingChapters =
    (previous?.content?.chapters as unknown[] | undefined) ?? [];
  const coverUrl = (
    input.cover as { coverImage?: { mediaUrl?: string } } | null
  )?.coverImage?.mediaUrl;
  if (input.preview.operation === "repair-track-artwork") {
    const targetKeys = input.preview.targetChapterKeys ?? [];
    const iconByChapterKey = new Map(
      targetKeys.map((key, index) => [key, iconReference(input.icons[index])])
    );
    const chapters = existingChapters.map((chapterValue) => {
      const chapter = chapterValue as {
        key?: string;
        tracks?: Array<Record<string, unknown>>;
        display?: Record<string, unknown>;
        [key: string]: unknown;
      };
      const icon16x16 = chapter.key ? iconByChapterKey.get(chapter.key) : undefined;
      if (icon16x16 === undefined) return chapter;
      return {
        ...chapter,
        display: { ...(chapter.display ?? {}), icon16x16 },
        tracks: (chapter.tracks ?? []).map((track) => ({
          ...track,
          display: {
            ...((track.display as Record<string, unknown> | undefined) ?? {}),
            icon16x16
          }
        }))
      };
    });
    return {
      cardId: input.preview.cardId,
      title: input.preview.existing?.title || input.preview.package.title,
      content: { ...(previous?.content ?? {}), chapters },
      metadata: { ...(previous?.metadata ?? {}) }
    };
  }
  if (input.preview.operation === "repair-track-labels") {
    let trackIndex = 0;
    const chapters = existingChapters.map((chapterValue) => {
      const chapter = chapterValue as {
        tracks?: Array<Record<string, unknown>>;
        [key: string]: unknown;
      };
      return {
        ...chapter,
        tracks: (chapter.tracks ?? []).map((track) => ({
          ...track,
          overlayLabel: String(++trackIndex)
        }))
      };
    });
    return {
      cardId: input.preview.cardId,
      title: input.preview.existing?.title || input.preview.package.title,
      content: { ...(previous?.content ?? {}), chapters },
      metadata: { ...(previous?.metadata ?? {}) }
    };
  }
  if (input.preview.operation === "repair-song-layout") {
    const targetKey = input.preview.targetChapterKey;
    const targetIndex = existingChapters.findIndex(
      (chapterValue) => (chapterValue as { key?: string }).key === targetKey
    );
    if (targetIndex < 0) throw new Error(`Target chapter ${targetKey} was not found`);
    const target = existingChapters[targetIndex] as {
      tracks?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const replacement = (target.tracks ?? []).map((track, index) => {
      const manifestTrack = input.preview.package.tracks[index];
      if (!manifestTrack) throw new Error(`Missing repair track at position ${index + 1}`);
      const overlayLabel = String(targetIndex + index + 1);
      return {
        ...target,
        key: chapterKey(manifestTrack.sourceId),
        title: track.title,
        overlayLabel,
        duration: track.duration,
        fileSize: track.fileSize,
        display: track.display ?? target.display,
        tracks: [{ ...track, key: "01", overlayLabel }]
      };
    });
    return {
      cardId: input.preview.cardId,
      title: input.preview.existing?.title || input.preview.package.title,
      content: {
        ...(previous?.content ?? {}),
        chapters: [
          ...existingChapters.slice(0, targetIndex),
          ...replacement,
          ...existingChapters.slice(targetIndex + 1)
        ]
      },
      metadata: { ...(previous?.metadata ?? {}) }
    };
  }
  if (input.preview.operation === "repair-artwork") {
    let iconIndex = 0;
    const chapters = existingChapters.map((chapterValue) => {
      const chapter = chapterValue as {
        tracks?: Array<Record<string, unknown>>;
        display?: Record<string, unknown>;
        [key: string]: unknown;
      };
      const tracks = (chapter.tracks ?? []).map((track) => ({
        ...track,
        display: {
          ...((track.display as Record<string, unknown> | undefined) ?? {}),
          icon16x16: iconReference(input.icons[iconIndex++])
        }
      }));
      return {
        ...chapter,
        display: {
          ...(chapter.display ?? {}),
          icon16x16:
            tracks[0]?.display &&
            (tracks[0].display as { icon16x16?: string }).icon16x16
        },
        tracks
      };
    });
    return {
      cardId: input.preview.cardId,
      title: input.preview.existing?.title || input.preview.package.title,
      content: { ...(previous?.content ?? {}), chapters },
      metadata: {
        ...(previous?.metadata ?? {}),
        ...(coverUrl ? { cover: { imageL: coverUrl } } : {})
      }
    };
  }
  const tracks = input.preview.tracksToAdd.map((track, index) => {
    const transcode = input.audio[index];
    if (!transcode) throw new Error(`Missing completed transcode for ${track.title}`);
    const icon16x16 = iconReference(input.icons[index]);
    return {
      key: String(index + 1).padStart(2, "0"),
      uid: track.sourceId,
      title: track.title,
      trackUrl: `yoto:#${transcode.transcodedSha256}`,
      format: yotoFormat(transcode.transcodedInfo.format),
      type: "audio",
      duration: transcode.transcodedInfo.duration,
      fileSize: transcode.transcodedInfo.fileSize,
      ...(transcode.transcodedInfo.channels
        ? { channels: transcode.transcodedInfo.channels }
        : {}),
      overlayLabel: String(index + 1),
      display: { icon16x16 }
    };
  });
  const duration = tracks.reduce((sum, track) => sum + track.duration, 0);
  const fileSize = tracks.reduce((sum, track) => sum + track.fileSize, 0);
  const groupedChapter = {
    key: chapterKey(input.preview.package.source.id),
    title: input.preview.package.title,
    overlayLabel: "1",
    defaultTrackDisplay: "1",
    defaultTrackAmbient: "none",
    duration,
    fileSize,
    display: { icon16x16: iconReference(input.icons[0]) },
    tracks
  };
  const isAppend = input.preview.operation === "append";
  const preservesSongLayout =
    isAppend &&
    existingChapters.length > 0 &&
    existingChapters.every((chapterValue) => {
      const chapter = chapterValue as { tracks?: unknown[] };
      return chapter.tracks?.length === 1;
    });
  const usesSingleTrackLayout =
    preservesSongLayout ||
    (!isAppend && input.preview.chapterLayout === "single-track-chapters");
  const appendedChapters = usesSingleTrackLayout
    ? tracks.map((track, index) => {
        const overlayLabel = String((isAppend ? existingChapters.length : 0) + index + 1);
        return {
          key: chapterKey(input.preview.tracksToAdd[index]!.sourceId),
          title: track.title,
          overlayLabel,
          defaultTrackDisplay: "1",
          defaultTrackAmbient: "none",
          duration: track.duration,
          fileSize: track.fileSize,
          display: track.display,
          tracks: [{ ...track, key: "01", overlayLabel }]
        };
      })
    : [groupedChapter];
  const previousMetadata =
    (previous?.metadata as Record<string, unknown> | undefined) ?? {};
  const previousMedia =
    (previousMetadata.media as { duration?: number; fileSize?: number } | undefined) ?? {};
  const metadata = {
    ...previousMetadata,
    ...(!isAppend
      ? { description: input.preview.package.source.description }
      : {}),
    media: {
      duration: duration + (isAppend ? previousMedia.duration ?? 0 : 0),
      fileSize: fileSize + (isAppend ? previousMedia.fileSize ?? 0 : 0)
    },
    ...(input.preview.operation === "create" && coverUrl
      ? { cover: { imageL: coverUrl } }
      : {})
  };
  return {
    ...(input.preview.cardId ? { cardId: input.preview.cardId } : {}),
    title:
      input.preview.finalTitle ||
      input.preview.existing?.title ||
      input.preview.package.title,
    content: {
      ...(previous?.content ?? {}),
      playbackType:
        (previous?.content?.playbackType as string | undefined) ?? "linear",
      chapters: [...existingChapters, ...appendedChapters]
    },
    metadata
  };
}
