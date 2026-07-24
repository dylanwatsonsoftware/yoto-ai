import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import sharp from "sharp";
import { IDEA_EXCHANGE_ROOT_ID, assertUnderIdeaExchangeRoot } from "./layout.js";

const folderMimeType = "application/vnd.google-apps.folder";
const audioExtensions = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".flac",
  ".ogg",
  ".opus"
]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const archiveExtensions = new Set([".zip", ".7z"]);
const technicalFolders = new Set(["audio", "audio_files", "image_files", "images", "icons"]);
const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base"
});

export interface DriveSnapshotItem {
  id: string;
  parentId: string;
  path: string;
  title: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string;
  checksum: string | null;
}

export interface PathSegment {
  id: string;
  name: string;
}

export interface PublicCover {
  sourceId: string;
  sourceName: string;
  checksum: string | null;
  path: string;
  width: number;
  height: number;
}

export interface PublicTrack {
  id: string;
  position: number;
  title: string;
}

export interface PublicAlbum {
  id: string;
  title: string;
  kind: "archive" | "expanded";
  archiveFormat: "zip" | "7z" | null;
  driveUrl: string;
  path: string;
  pathSegments: PathSegment[];
  depth: number;
  parentId: string;
  parentCollectionId: string | null;
  nestedAlbumIds: string[];
  size: number | null;
  modifiedTime: string;
  checksum: string | null;
  cover: PublicCover | null;
  tracks: PublicTrack[];
}

export interface PublicCollection {
  id: string;
  title: string;
  path: string;
  pathSegments: PathSegment[];
  depth: number;
  parentId: string;
  childCollectionIds: string[];
  albumIds: string[];
  nestedAlbumIds: string[];
}

export interface PublicCatalogue {
  schemaVersion: 1;
  generatedAt: string;
  root: { id: string; title: string };
  scan: { complete: boolean };
  stats: { albums: number; collections: number; covers: number };
  collections: PublicCollection[];
  albums: PublicAlbum[];
}

function isFolder(item: DriveSnapshotItem): boolean {
  return item.mimeType === folderMimeType;
}

function extension(item: DriveSnapshotItem): string {
  return extname(item.title).toLowerCase();
}

function isAudio(item: DriveSnapshotItem): boolean {
  return audioExtensions.has(extension(item));
}

function isImage(item: DriveSnapshotItem): boolean {
  return imageExtensions.has(extension(item));
}

function isArchive(item: DriveSnapshotItem): boolean {
  return archiveExtensions.has(extension(item));
}

function stem(name: string): string {
  return basename(name, extname(name)).normalize("NFKC").toLocaleLowerCase();
}

function coverRank(item: DriveSnapshotItem): number | null {
  const name = stem(item.title);
  if (name === "cover_image") return 0;
  if (name === "cover") return 1;
  if (name === "folder") return 2;
  return null;
}

function trackPosition(item: DriveSnapshotItem, fallback: number): number {
  const match = item.title.match(/^0*(\d+)(?:\D|$)/);
  return match ? Number(match[1]) : fallback;
}

function trackTitle(item: DriveSnapshotItem): string {
  return basename(item.title, extname(item.title))
    .replace(/^0*\d+\s*[-._)]?\s*/, "")
    .trim();
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}

function chainFor(
  item: DriveSnapshotItem,
  byId: Map<string, DriveSnapshotItem>
): DriveSnapshotItem[] {
  const result: DriveSnapshotItem[] = [];
  const seen = new Set<string>();
  let current: DriveSnapshotItem | undefined = item;
  while (current && !seen.has(current.id)) {
    result.unshift(current);
    if (current.id === IDEA_EXCHANGE_ROOT_ID) break;
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return result;
}

function segmentsFor(
  item: DriveSnapshotItem,
  byId: Map<string, DriveSnapshotItem>
): PathSegment[] {
  return chainFor(item, byId).map((entry) => ({
    id: entry.id,
    name: entry.title
  }));
}

function descendantsOf(
  parentId: string,
  children: Map<string, DriveSnapshotItem[]>
): DriveSnapshotItem[] {
  const result: DriveSnapshotItem[] = [];
  const pending = [...(children.get(parentId) ?? [])];
  while (pending.length) {
    const item = pending.shift()!;
    result.push(item);
    if (isFolder(item)) pending.push(...(children.get(item.id) ?? []));
  }
  return result;
}

function selectCovers(
  albums: DriveSnapshotItem[],
  children: Map<string, DriveSnapshotItem[]>
): Map<string, DriveSnapshotItem> {
  const result = new Map<string, DriveSnapshotItem>();
  const albumsByParent = new Map<string, DriveSnapshotItem[]>();
  for (const album of albums) {
    const siblings = albumsByParent.get(album.parentId) ?? [];
    siblings.push(album);
    albumsByParent.set(album.parentId, siblings);
  }
  for (const album of albums) {
    const directChildren = children.get(album.id) ?? [];
    if (isFolder(album)) {
      const ranked = directChildren
        .filter(isImage)
        .map((item) => ({ item, rank: coverRank(item) }))
        .filter(
          (entry): entry is { item: DriveSnapshotItem; rank: number } =>
            entry.rank !== null
        )
        .sort(
          (a, b) => a.rank - b.rank || collator.compare(a.item.title, b.item.title)
        );
      if (ranked[0] && ranked[1] && ranked[0].rank === ranked[1].rank) {
        throw new Error(`Ambiguous cover mapping for ${album.path}`);
      }
      const selected = ranked[0]?.item;
      if (selected) {
        result.set(album.id, selected);
        continue;
      }
    } else {
      const adjacentCandidates = (children.get(album.parentId) ?? [])
        .filter((item) => isImage(item) && stem(item.title) === stem(album.title))
        .sort((a, b) => collator.compare(a.title, b.title));
      if (adjacentCandidates.length > 1) {
        throw new Error(`Ambiguous cover mapping for ${album.path}`);
      }
      const adjacent = adjacentCandidates[0];
      if (adjacent) {
        result.set(album.id, adjacent);
        continue;
      }
    }
    if ((albumsByParent.get(album.parentId) ?? []).length === 1) {
      const rankedFallbacks = (children.get(album.parentId) ?? [])
        .filter(isImage)
        .map((item) => ({ item, rank: coverRank(item) }))
        .filter(
          (entry): entry is { item: DriveSnapshotItem; rank: number } =>
            entry.rank !== null
        )
        .sort(
          (a, b) => a.rank - b.rank || collator.compare(a.item.title, b.item.title)
        );
      if (
        rankedFallbacks[0] &&
        rankedFallbacks[1] &&
        rankedFallbacks[0].rank === rankedFallbacks[1].rank
      ) {
        throw new Error(`Ambiguous cover mapping for ${album.path}`);
      }
      const fallback = rankedFallbacks[0]?.item;
      if (fallback) result.set(album.id, fallback);
    }
  }
  return result;
}

async function coverSource(
  directory: string,
  sourceId: string
): Promise<string | null> {
  if (!(await exists(directory))) return null;
  const names = await readdir(directory);
  const name = names.find(
    (candidate) => basename(candidate, extname(candidate)) === sourceId
  );
  return name ? join(directory, name) : null;
}

async function previousCatalogue(
  outputDirectory: string
): Promise<PublicCatalogue | null> {
  try {
    return JSON.parse(
      await readFile(join(outputDirectory, "catalogue.json"), "utf8")
    ) as PublicCatalogue;
  } catch {
    return null;
  }
}

async function cacheCover(input: {
  albumId: string;
  source: DriveSnapshotItem;
  coversDirectory: string;
  stageDirectory: string;
  outputDirectory: string;
  previous: PublicCatalogue | null;
}): Promise<PublicCover | null> {
  const relativePath = `covers/${input.albumId}.webp`;
  const stagedPath = join(input.stageDirectory, relativePath);
  await mkdir(dirname(stagedPath), { recursive: true });
  const oldAlbum = input.previous?.albums.find(
    (album) => album.id === input.albumId
  );
  if (
    oldAlbum?.cover?.sourceId === input.source.id &&
    oldAlbum.cover.checksum === input.source.checksum &&
    (await exists(join(input.outputDirectory, oldAlbum.cover.path)))
  ) {
    await copyFile(join(input.outputDirectory, oldAlbum.cover.path), stagedPath);
    return { ...oldAlbum.cover, path: relativePath };
  }
  const sourcePath = await coverSource(input.coversDirectory, input.source.id);
  if (!sourcePath) return null;
  await sharp(sourcePath)
    .rotate()
    .resize(320, 320, { fit: "cover", position: "centre" })
    .webp({ quality: 82 })
    .toFile(stagedPath);
  const metadata = await sharp(stagedPath).metadata();
  return {
    sourceId: input.source.id,
    sourceName: input.source.title,
    checksum: input.source.checksum,
    path: relativePath,
    width: metadata.width ?? 320,
    height: metadata.height ?? 320
  };
}

async function swapDirectory(stage: string, output: string): Promise<void> {
  const backup = `${output}.previous`;
  await rm(backup, { recursive: true, force: true });
  const hadOutput = await exists(output);
  if (hadOutput) await rename(output, backup);
  try {
    await rename(stage, output);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (hadOutput && (await exists(backup))) await rename(backup, output);
    throw error;
  }
}

export async function buildPublicCatalogue(input: {
  items: DriveSnapshotItem[];
  coversDirectory: string;
  outputDirectory: string;
  generatedAt?: string;
  scanComplete?: boolean;
}): Promise<PublicCatalogue> {
  const byId = new Map(input.items.map((item) => [item.id, item]));
  const parents = new Map<string, string[]>();
  for (const item of input.items) {
    parents.set(
      item.id,
      item.id === IDEA_EXCHANGE_ROOT_ID ? [] : [item.parentId]
    );
  }
  for (const item of input.items) {
    assertUnderIdeaExchangeRoot(item.id, parents);
  }
  const root = byId.get(IDEA_EXCHANGE_ROOT_ID);
  if (!root) throw new Error("Drive snapshot is missing the configured root");

  const children = new Map<string, DriveSnapshotItem[]>();
  for (const item of input.items) {
    if (item.id === IDEA_EXCHANGE_ROOT_ID) continue;
    const entries = children.get(item.parentId) ?? [];
    entries.push(item);
    children.set(item.parentId, entries);
  }
  for (const entries of children.values()) {
    entries.sort((a, b) => collator.compare(a.title, b.title));
  }

  const expandedFolders = input.items.filter((candidate) => {
    if (
      !isFolder(candidate) ||
      candidate.id === IDEA_EXCHANGE_ROOT_ID ||
      technicalFolders.has(candidate.title.toLocaleLowerCase())
    ) {
      return false;
    }
    const descendants = descendantsOf(candidate.id, children);
    if (!descendants.some(isAudio)) return false;
    return !(children.get(candidate.id) ?? []).some(
      (child) =>
        isFolder(child) &&
        !technicalFolders.has(child.title.toLocaleLowerCase()) &&
        descendantsOf(child.id, children).some(isAudio)
    );
  });
  const albumItems = [
    ...input.items.filter(isArchive),
    ...expandedFolders
  ].sort((a, b) => collator.compare(a.path, b.path));
  const albumIds = new Set(albumItems.map((item) => item.id));
  const collectionItems = input.items
    .filter(
      (candidate) =>
        isFolder(candidate) &&
        candidate.id !== IDEA_EXCHANGE_ROOT_ID &&
        !albumIds.has(candidate.id) &&
        albumItems.some((album) =>
          chainFor(album, byId).some((ancestor) => ancestor.id === candidate.id)
        )
    )
    .sort((a, b) => collator.compare(a.path, b.path));
  const collectionIds = new Set(collectionItems.map((item) => item.id));
  const selectedCovers = selectCovers(albumItems, children);

  await mkdir(dirname(input.outputDirectory), { recursive: true });
  const stage = await mkdtemp(
    join(dirname(input.outputDirectory), ".catalogue-stage-")
  );
  const previous = await previousCatalogue(input.outputDirectory);
  try {
    const albums: PublicAlbum[] = [];
    for (const album of albumItems) {
      const chain = chainFor(album, byId);
      const parentCollectionId =
        [...chain]
          .reverse()
          .find(
            (entry) => entry.id !== album.id && collectionIds.has(entry.id)
          )?.id ?? null;
      const allDescendants = isFolder(album)
        ? descendantsOf(album.id, children)
        : [];
      const audio = allDescendants.filter(isAudio).sort((a, b) =>
        collator.compare(a.path, b.path)
      );
      const tracks = audio
        .map((track, index) => ({
          id: track.id,
          position: trackPosition(track, index + 1),
          title: trackTitle(track)
        }))
        .sort((a, b) => a.position - b.position || collator.compare(a.title, b.title));
      const sourceCover = selectedCovers.get(album.id);
      const cover = sourceCover
        ? await cacheCover({
            albumId: album.id,
            source: sourceCover,
            coversDirectory: input.coversDirectory,
            stageDirectory: stage,
            outputDirectory: input.outputDirectory,
            previous
          })
        : null;
      albums.push({
        id: album.id,
        title: basename(album.title, extname(album.title)),
        kind: isArchive(album) ? "archive" : "expanded",
        archiveFormat: isArchive(album)
          ? (extension(album).slice(1) as "zip" | "7z")
          : null,
        driveUrl: `https://drive.google.com/open?id=${encodeURIComponent(album.id)}`,
        path: album.path,
        pathSegments: segmentsFor(album, byId),
        depth: Math.max(0, chain.length - 1),
        parentId: album.parentId,
        parentCollectionId,
        nestedAlbumIds: albumItems
          .filter(
            (candidate) =>
              candidate.id !== album.id &&
              chainFor(candidate, byId).some((entry) => entry.id === album.id)
          )
          .map((candidate) => candidate.id)
          .sort(collator.compare),
        size: album.size,
        modifiedTime: album.modifiedTime,
        checksum: album.checksum,
        cover,
        tracks
      });
    }

    const collections: PublicCollection[] = collectionItems.map((collection) => {
      const chain = chainFor(collection, byId);
      const descendantAlbums = albumItems.filter((album) =>
        chainFor(album, byId).some((entry) => entry.id === collection.id)
      );
      return {
        id: collection.id,
        title: collection.title,
        path: collection.path,
        pathSegments: segmentsFor(collection, byId),
        depth: Math.max(0, chain.length - 1),
        parentId: collection.parentId,
        childCollectionIds: collectionItems
          .filter((candidate) => candidate.parentId === collection.id)
          .map((candidate) => candidate.id)
          .sort(collator.compare),
        albumIds: albumItems
          .filter((album) => album.parentId === collection.id)
          .map((album) => album.id)
          .sort(collator.compare),
        nestedAlbumIds: descendantAlbums
          .map((album) => album.id)
          .sort(collator.compare)
      };
    });
    const catalogue: PublicCatalogue = {
      schemaVersion: 1,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      root: { id: root.id, title: root.title },
      scan: { complete: input.scanComplete ?? true },
      stats: {
        albums: albums.length,
        collections: collections.length,
        covers: albums.filter((album) => album.cover).length
      },
      collections,
      albums
    };
    await writeFile(
      join(stage, "catalogue.json"),
      `${JSON.stringify(catalogue, null, 2)}\n`
    );
    await swapDirectory(stage, input.outputDirectory);
    return catalogue;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
