import { describe, expect, it } from "vitest";
import {
  buildCatalogueSearchIndex,
  filterAlbums,
  readCatalogueQuery,
  validateCatalogue,
  writeCatalogueQuery,
  type Catalogue
} from "./catalogue";

const catalogue: Catalogue = {
  schemaVersion: 1,
  generatedAt: "2026-07-24T00:00:00Z",
  root: { id: "root", title: "MYO" },
  scan: { complete: true },
  stats: { albums: 3, collections: 2, covers: 1 },
  collections: [
    {
      id: "science",
      title: "Science",
      path: "MYO/Science",
      pathSegments: [
        { id: "root", name: "MYO" },
        { id: "science", name: "Science" }
      ],
      depth: 1,
      parentId: "root",
      childCollectionIds: [],
      albumIds: ["ada"],
      nestedAlbumIds: ["ada"]
    },
    {
      id: "stories",
      title: "Stories",
      path: "MYO/Stories",
      pathSegments: [
        { id: "root", name: "MYO" },
        { id: "stories", name: "Stories" }
      ],
      depth: 1,
      parentId: "root",
      childCollectionIds: [],
      albumIds: ["bluey", "deep"],
      nestedAlbumIds: ["bluey", "deep"]
    }
  ],
  albums: [
    {
      id: "ada",
      title: "Ada Twist",
      kind: "expanded",
      archiveFormat: null,
      driveUrl: "https://drive.google.com/open?id=ada",
      path: "MYO/Science/Ada Twist",
      pathSegments: [
        { id: "root", name: "MYO" },
        { id: "science", name: "Science" },
        { id: "ada", name: "Ada Twist" }
      ],
      depth: 2,
      parentId: "science",
      parentCollectionId: "science",
      nestedAlbumIds: [],
      size: null,
      modifiedTime: "2026-07-20T00:00:00Z",
      checksum: null,
      cover: {
        sourceId: "cover",
        sourceName: "cover.png",
        checksum: "sum",
        path: "covers/ada.webp",
        width: 320,
        height: 320
      },
      tracks: [{ id: "track", position: 1, title: "Scientist Song" }]
    },
    {
      id: "bluey",
      title: "Bluey Dance",
      kind: "archive",
      archiveFormat: "zip",
      driveUrl: "https://drive.google.com/open?id=bluey",
      path: "MYO/Stories/Bluey Dance.zip",
      pathSegments: [
        { id: "root", name: "MYO" },
        { id: "stories", name: "Stories" },
        { id: "bluey", name: "Bluey Dance.zip" }
      ],
      depth: 2,
      parentId: "stories",
      parentCollectionId: "stories",
      nestedAlbumIds: [],
      size: 100,
      modifiedTime: "2026-07-22T00:00:00Z",
      checksum: "bluey",
      cover: null,
      tracks: []
    },
    {
      id: "deep",
      title: "Deep Story",
      kind: "archive",
      archiveFormat: "7z",
      driveUrl: "https://drive.google.com/open?id=deep",
      path: "MYO/Stories/Nested/Deep Story.7z",
      pathSegments: [
        { id: "root", name: "MYO" },
        { id: "stories", name: "Stories" },
        { id: "nested", name: "Nested" },
        { id: "deep", name: "Deep Story.7z" }
      ],
      depth: 3,
      parentId: "nested",
      parentCollectionId: "stories",
      nestedAlbumIds: [],
      size: 200,
      modifiedTime: "2026-07-21T00:00:00Z",
      checksum: "deep",
      cover: null,
      tracks: []
    }
  ]
};

describe("catalogue discovery", () => {
  it("builds a reusable search index for playlist metadata and tracks", () => {
    const index = buildCatalogueSearchIndex(catalogue);

    expect(index.get("ada")).toContain("scientist song");
    expect(index.get("deep")).toContain("stories nested");
    expect(
      filterAlbums(
        catalogue,
        {
          query: "scientist",
          kind: "all",
          collection: "all",
          cover: "all",
          depth: "all",
          sort: "title"
        },
        index
      ).map((album) => album.id)
    ).toEqual(["ada"]);
  });

  it("searches titles, paths, collections, and expanded track names", () => {
    expect(
      filterAlbums(catalogue, {
        query: "scientist",
        kind: "all",
        collection: "all",
        cover: "all",
        depth: "all",
        sort: "title"
      }).map((album) => album.id)
    ).toEqual(["ada"]);
    expect(
      filterAlbums(catalogue, {
        query: "stories",
        kind: "archive",
        collection: "stories",
        cover: "missing",
        depth: "all",
        sort: "title"
      }).map((album) => album.id)
    ).toEqual(["bluey", "deep"]);
  });

  it("ranks title matches ahead of matches found only in tracks or folders", () => {
    const titleMatch = {
      ...catalogue.albums[1],
      id: "scientist",
      title: "Scientist Stories",
      path: "MYO/Stories/Scientist Stories.zip"
    };

    expect(
      filterAlbums(
        { ...catalogue, albums: [...catalogue.albums, titleMatch] },
        {
          query: "scientist",
          kind: "all",
          collection: "all",
          cover: "all",
          depth: "all",
          sort: "title"
        }
      ).map((album) => album.id)
    ).toEqual(["scientist", "ada"]);
  });

  it("filters nesting depth and sorts modified dates", () => {
    expect(
      filterAlbums(catalogue, {
        query: "",
        kind: "all",
        collection: "all",
        cover: "all",
        depth: "3+",
        sort: "modified"
      }).map((album) => album.id)
    ).toEqual(["deep"]);
  });

  it("round-trips shareable search, filters, and selected album", () => {
    const state = {
      query: "ada",
      kind: "expanded" as const,
      collection: "science",
      cover: "available" as const,
      depth: "2" as const,
      sort: "path" as const,
      includeOtherLanguages: false,
      selected: "ada"
    };
    expect(readCatalogueQuery(writeCatalogueQuery(state))).toEqual(state);
  });

  it("rejects incompatible or malformed public catalogue data", () => {
    expect(() => validateCatalogue({ schemaVersion: 2 })).toThrow(/schema/i);
    expect(() =>
      validateCatalogue({ schemaVersion: 1, albums: [], collections: [] })
    ).toThrow(/catalogue/i);
    expect(validateCatalogue(catalogue)).toBe(catalogue);
  });
});
