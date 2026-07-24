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
  const coverUrl = (
    input.cover as { coverImage?: { mediaUrl?: string } } | null
  )?.coverImage?.mediaUrl;
  const chapter = {
    key: `import-${input.preview.package.source.id}`,
    title: input.preview.package.title,
    overlayLabel: "1",
    defaultTrackDisplay: "1",
    defaultTrackAmbient: "none",
    duration,
    fileSize,
    display: { icon16x16: iconReference(input.icons[0]) },
    tracks
  };
  const metadata = {
    ...(previous?.metadata ?? {}),
    description: input.preview.package.source.description,
    media: { duration, fileSize },
    ...(input.preview.operation === "create" && coverUrl
      ? { cover: { imageL: coverUrl } }
      : {})
  };
  return {
    ...(input.preview.cardId ? { cardId: input.preview.cardId } : {}),
    title: input.preview.existing?.title || input.preview.package.title,
    content: {
      ...(previous?.content ?? {}),
      playbackType:
        (previous?.content?.playbackType as string | undefined) ?? "linear",
      chapters: [...existingChapters, chapter]
    },
    metadata
  };
}
