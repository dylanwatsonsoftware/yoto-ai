export interface PathSegment {
  id: string;
  name: string;
}

export interface Cover {
  sourceId: string;
  sourceName: string;
  checksum: string | null;
  path: string;
  width: number;
  height: number;
}

export interface Track {
  id: string;
  position: number;
  title: string;
}

export interface Album {
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
  cover: Cover | null;
  tracks: Track[];
}

export interface Collection {
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

export interface Catalogue {
  schemaVersion: 1;
  generatedAt: string;
  root: { id: string; title: string };
  scan: { complete: boolean };
  stats: { albums: number; collections: number; covers: number };
  collections: Collection[];
  albums: Album[];
}

export type AlbumKindFilter = "all" | Album["kind"];
export type CoverFilter = "all" | "available" | "missing";
export type DepthFilter = "all" | "1" | "2" | "3+";
export type SortOrder = "title" | "path" | "modified";

export interface CatalogueFilters {
  query: string;
  kind: AlbumKindFilter;
  collection: string;
  cover: CoverFilter;
  depth: DepthFilter;
  sort: SortOrder;
}

export interface CatalogueQuery extends CatalogueFilters {
  selected?: string;
}

export const defaultFilters: CatalogueFilters = {
  query: "",
  kind: "all",
  collection: "all",
  cover: "all",
  depth: "all",
  sort: "title"
};

export function validateCatalogue(value: unknown): Catalogue {
  if (!value || typeof value !== "object") {
    throw new Error("Catalogue data is not an object");
  }
  const candidate = value as Partial<Catalogue>;
  if (candidate.schemaVersion !== 1) {
    throw new Error("Unsupported catalogue schema version");
  }
  if (
    !candidate.root ||
    typeof candidate.root.id !== "string" ||
    typeof candidate.root.title !== "string" ||
    !candidate.scan ||
    typeof candidate.scan.complete !== "boolean" ||
    !candidate.stats ||
    !Number.isFinite(candidate.stats.albums) ||
    !Number.isFinite(candidate.stats.collections) ||
    !Number.isFinite(candidate.stats.covers) ||
    !Array.isArray(candidate.collections) ||
    !Array.isArray(candidate.albums) ||
    typeof candidate.generatedAt !== "string"
  ) {
    throw new Error("Catalogue data is malformed");
  }
  for (const album of candidate.albums) {
    if (
      !album ||
      typeof album.id !== "string" ||
      typeof album.title !== "string" ||
      !["archive", "expanded"].includes(album.kind) ||
      !Array.isArray(album.pathSegments) ||
      !Array.isArray(album.tracks)
    ) {
      throw new Error("Catalogue contains a malformed album");
    }
  }
  return candidate as Catalogue;
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type CatalogueSearchIndex = ReadonlyMap<string, string>;

export function buildCatalogueSearchIndex(
  catalogue: Catalogue
): CatalogueSearchIndex {
  return new Map(
    catalogue.albums.map((album) => [
      album.id,
      normalize(
        [
          album.title,
          album.path,
          ...album.pathSegments.map((part) => part.name),
          ...album.tracks.map((track) => track.title)
        ].join(" ")
      )
    ])
  );
}

function matchesQuery(haystack: string, terms: string[]): boolean {
  if (!terms.length) return true;
  return terms.every((term) => haystack.includes(term));
}

function matchesDepth(depth: number, filter: DepthFilter): boolean {
  if (filter === "all") return true;
  if (filter === "3+") return depth >= 3;
  return depth === Number(filter);
}

export function filterAlbums(
  catalogue: Catalogue,
  filters: CatalogueFilters,
  searchIndex: CatalogueSearchIndex = buildCatalogueSearchIndex(catalogue)
): Album[] {
  const normalizedQuery = normalize(filters.query);
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  return catalogue.albums
    .filter(
      (album) =>
        matchesQuery(searchIndex.get(album.id) ?? "", terms) &&
        (filters.kind === "all" || album.kind === filters.kind) &&
        (filters.collection === "all" ||
          album.parentCollectionId === filters.collection ||
          album.pathSegments.some((part) => part.id === filters.collection)) &&
        (filters.cover === "all" ||
          (filters.cover === "available" ? Boolean(album.cover) : !album.cover)) &&
        matchesDepth(album.depth, filters.depth)
    )
    .sort((left, right) => {
      if (terms.length && filters.sort === "title") {
        const relevance = (album: Album) => {
          const title = normalize(album.title);
          if (title === normalizedQuery) return 0;
          if (title.startsWith(normalizedQuery)) return 1;
          if (title.includes(normalizedQuery)) return 2;
          if (terms.every((term) => title.includes(term))) return 3;
          return 4;
        };
        const relevanceDifference = relevance(left) - relevance(right);
        if (relevanceDifference) return relevanceDifference;
      }
      if (filters.sort === "modified") {
        return (
          Date.parse(right.modifiedTime) - Date.parse(left.modifiedTime) ||
          left.title.localeCompare(right.title)
        );
      }
      const a = filters.sort === "path" ? left.path : left.title;
      const b = filters.sort === "path" ? right.path : right.title;
      return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    });
}

function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T
): T {
  return value && allowed.includes(value as T) ? (value as T) : fallback;
}

export function readCatalogueQuery(
  query: string | URLSearchParams
): CatalogueQuery {
  const params =
    typeof query === "string"
      ? new URLSearchParams(query.startsWith("?") ? query.slice(1) : query)
      : query;
  const selected = params.get("album") || undefined;
  return {
    query: params.get("q") ?? "",
    kind: oneOf(params.get("kind"), ["all", "archive", "expanded"], "all"),
    collection: params.get("collection") ?? "all",
    cover: oneOf(params.get("cover"), ["all", "available", "missing"], "all"),
    depth: oneOf(params.get("depth"), ["all", "1", "2", "3+"], "all"),
    sort: oneOf(params.get("sort"), ["title", "path", "modified"], "title"),
    ...(selected ? { selected } : {})
  };
}

export function writeCatalogueQuery(state: CatalogueQuery): string {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.kind !== "all") params.set("kind", state.kind);
  if (state.collection !== "all") params.set("collection", state.collection);
  if (state.cover !== "all") params.set("cover", state.cover);
  if (state.depth !== "all") params.set("depth", state.depth);
  if (state.sort !== "title") params.set("sort", state.sort);
  if (state.selected) params.set("album", state.selected);
  return params.toString();
}
