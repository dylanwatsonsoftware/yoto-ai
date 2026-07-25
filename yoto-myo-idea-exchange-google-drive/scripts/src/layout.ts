import { basename, extname } from "node:path";

export const IDEA_EXCHANGE_ROOT_ID =
  "12ueGfirgSd21B7ShXZiATmrZCl3J4OqI";

const audioExtensions = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".flac",
  ".ogg",
  ".opus"
]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif"]);
const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base"
});

function positionFromName(path: string): number | undefined {
  const match = basename(path).match(/^0*(\d+)(?:\D|$)/);
  return match ? Number(match[1]) : undefined;
}

function titleFromAudio(path: string): string {
  return basename(path, extname(path))
    .replace(/^0*\d+\s*[-._)]?\s*/, "")
    .trim();
}

function coverRank(path: string): number | undefined {
  const name = basename(path, extname(path)).toLowerCase();
  if (name === "cover_image") return 0;
  if (name === "cover") return 1;
  if (name === "folder") return 2;
  return undefined;
}

function iconCandidate(path: string):
  | { position: number; rank: number }
  | undefined {
  const extension = extname(path).toLowerCase();
  if (!imageExtensions.has(extension)) return undefined;
  const name = basename(path, extension);
  const explicit = name.match(/^icon\s*0*(\d+)$/i);
  if (explicit) return { position: Number(explicit[1]), rank: 0 };
  const numeric =
    name.match(/^0*(\d+)$/) ??
    name.match(/^image\s*0*(\d+)(?:\D|$)/i);
  if (!numeric) return undefined;
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return {
    position: Number(numeric[1]),
    rank: normalized.includes("/image_files/") ? 1 : 2
  };
}

export interface DiscoveredTrack {
  position: number;
  title: string;
  audio: string;
  icon?: string;
}

export function discoverPlaylistLayout(paths: string[]): {
  cover?: string;
  tracks: DiscoveredTrack[];
} {
  const normalized = paths.map((path) => path.replaceAll("\\", "/"));
  const nestedAudio = normalized.filter(
    (path) =>
      path.toLowerCase().includes("/audio_files/") &&
      audioExtensions.has(extname(path).toLowerCase())
  );
  const audio =
    nestedAudio.length > 0
      ? nestedAudio
      : normalized.filter((path) =>
          audioExtensions.has(extname(path).toLowerCase())
        );
  audio.sort(collator.compare);

  const claimedPositions = new Set<number>();
  const tracks: DiscoveredTrack[] = audio.map((path, index) => {
    const explicit = positionFromName(path);
    const position = explicit ?? index + 1;
    if (claimedPositions.has(position)) {
      throw new Error(`Ambiguous track position ${position}`);
    }
    claimedPositions.add(position);
    return { position, title: titleFromAudio(path), audio: path };
  });
  tracks.sort((a, b) => a.position - b.position);

  const rankedCovers = normalized
    .map((path) => ({ path, rank: coverRank(path) }))
    .filter(
      (candidate): candidate is { path: string; rank: number } =>
        candidate.rank !== undefined
    )
    .sort((a, b) => a.rank - b.rank || collator.compare(a.path, b.path));
  const cover = rankedCovers[0]?.path;

  const byPosition = new Map<
    number,
    Array<{ path: string; rank: number }>
  >();
  for (const path of normalized) {
    if (path === cover) continue;
    const candidate = iconCandidate(path);
    if (!candidate) continue;
    const current = byPosition.get(candidate.position) ?? [];
    current.push({ path, rank: candidate.rank });
    byPosition.set(candidate.position, current);
  }

  for (const track of tracks) {
    const candidates = (byPosition.get(track.position) ?? []).sort(
      (a, b) => a.rank - b.rank || collator.compare(a.path, b.path)
    );
    if (
      candidates.length > 1 &&
      candidates[0]!.rank === candidates[1]!.rank
    ) {
      throw new Error(`Ambiguous icon position ${track.position}`);
    }
    track.icon = candidates[0]?.path;
  }
  return { cover, tracks };
}

export function assertUnderIdeaExchangeRoot(
  nodeId: string,
  parentsById: Map<string, string[]>
): void {
  const pending = [nodeId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === IDEA_EXCHANGE_ROOT_ID) return;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(parentsById.get(current) ?? []));
  }
  throw new Error(
    `Drive item is outside the configured MYO Idea Exchange root: ${nodeId}`
  );
}
