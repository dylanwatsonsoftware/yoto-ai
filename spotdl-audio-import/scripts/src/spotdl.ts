import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface ResolvedTrack {
  sourceId: string;
  title: string;
  artist: string;
  sourceUrl: string;
  matchedUrl?: string;
}

export interface BatchPreview {
  version: 1;
  title: string;
  destination: string;
  permission: string;
  tracks: Array<ResolvedTrack & { matchedUrl: string }>;
  confirmationsRequired: 1;
  summary: string;
}

export function buildBatchPreview(input: {
  title: string;
  destination: string;
  permission: string;
  tracks: ResolvedTrack[];
}): BatchPreview {
  if (!input.permission.trim()) {
    throw new Error("A batch permission statement is required");
  }
  const unresolved = input.tracks.filter((track) => !track.matchedUrl);
  if (unresolved.length > 0) {
    throw new Error(
      `Batch contains unresolved tracks: ${unresolved
        .map((track) => track.title)
        .join(", ")}`
    );
  }
  if (input.tracks.length === 0) {
    throw new Error("Batch must contain at least one track");
  }
  return {
    version: 1,
    title: input.title,
    destination: input.destination,
    permission: input.permission,
    tracks: input.tracks as Array<ResolvedTrack & { matchedUrl: string }>,
    confirmationsRequired: 1,
    summary: `${input.tracks.length} tracks will be downloaded as one confirmed batch`
  };
}

function digestPreview(preview: BatchPreview): string {
  return createHash("sha256")
    .update(JSON.stringify(preview))
    .digest("base64url");
}

export function createConfirmationToken(
  preview: BatchPreview,
  secret: string,
  now = Date.now()
): string {
  const payload = Buffer.from(
    JSON.stringify({
      preview: digestPreview(preview),
      issuedAt: now,
      expiresAt: now + 15 * 60_000
    })
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyConfirmationToken(
  token: string,
  preview: BatchPreview,
  secret: string,
  now = Date.now()
): true {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    throw new Error("Confirmation token is invalid");
  }
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Confirmation token is invalid");
  }
  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  ) as { preview: string; expiresAt: number };
  if (parsed.expiresAt < now) {
    throw new Error("Confirmation token expired");
  }
  if (parsed.preview !== digestPreview(preview)) {
    throw new Error("Confirmation token does not match this batch");
  }
  return true;
}

export function buildSpotdlDownloadArgs(
  preview: BatchPreview,
  outputDirectory: string,
  saveFile: string
) {
  const songs = preview.tracks.map((track, index) => ({
    name: track.title,
    artists: [track.artist],
    artist: track.artist,
    genres: [],
    disc_number: 1,
    disc_count: 1,
    album_name: preview.title,
    album_artist: track.artist,
    duration: 0,
    year: 0,
    date: "",
    track_number: index + 1,
    tracks_count: preview.tracks.length,
    song_id: track.sourceId,
    explicit: false,
    publisher: "",
    url: track.sourceUrl,
    isrc: null,
    cover_url: null,
    copyright_text: null,
    download_url: track.matchedUrl,
    lyrics: null,
    popularity: null,
    album_id: track.sourceId,
    list_name: preview.title,
    list_url: null,
    list_position: index + 1,
    list_length: preview.tracks.length,
    artist_id: null,
    album_type: "playlist"
  }));

  return {
    songs,
    args: [
      "download",
      saveFile,
      "--format",
      "mp3",
      "--output",
      `${outputDirectory}/{list-position}. {title}.{output-ext}`,
      "--overwrite",
      "skip"
    ]
  };
}
