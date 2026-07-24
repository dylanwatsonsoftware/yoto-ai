import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildPublicCatalogue,
  type DriveSnapshotItem
} from "./cache.js";
import { IDEA_EXCHANGE_ROOT_ID } from "./layout.js";

function item(
  value: Partial<DriveSnapshotItem> & Pick<DriveSnapshotItem, "id" | "title">
): DriveSnapshotItem {
  const { id, title, ...rest } = value;
  return {
    id,
    title,
    parentId: value.parentId ?? IDEA_EXCHANGE_ROOT_ID,
    path: value.path ?? value.title,
    mimeType: value.mimeType ?? "application/octet-stream",
    size: value.size ?? null,
    modifiedTime: value.modifiedTime ?? "2026-07-24T00:00:00Z",
    checksum: value.checksum ?? null,
    ...rest
  };
}

describe("public catalogue cache", () => {
  it("exports archives, expanded albums, hierarchy, tracks, and public covers", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "catalogue-cache-"));
    const covers = join(temporary, "covers");
    const output = join(temporary, "output");
    await mkdir(covers);
    await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: "#6f4aa8"
      }
    })
      .png()
      .toFile(join(covers, "archive-cover.png"));
    await sharp({
      create: {
        width: 300,
        height: 400,
        channels: 4,
        background: "#ef8f55"
      }
    })
      .png()
      .toFile(join(covers, "folder-cover.png"));

    const items = [
      item({
        id: IDEA_EXCHANGE_ROOT_ID,
        parentId: IDEA_EXCHANGE_ROOT_ID,
        title: "MYO",
        path: "MYO",
        mimeType: "application/vnd.google-apps.folder"
      }),
      item({
        id: "collection",
        title: "Science",
        path: "MYO/Science",
        mimeType: "application/vnd.google-apps.folder"
      }),
      item({
        id: "archive",
        parentId: "collection",
        title: "Ada.zip",
        path: "MYO/Science/Ada.zip",
        mimeType: "application/zip",
        size: 123,
        checksum: "archive-sum"
      }),
      item({
        id: "archive-cover",
        parentId: "collection",
        title: "Ada.png",
        path: "MYO/Science/Ada.png",
        mimeType: "image/png",
        checksum: "archive-cover-sum"
      }),
      item({
        id: "expanded",
        parentId: "collection",
        title: "Questioneers",
        path: "MYO/Science/Questioneers",
        mimeType: "application/vnd.google-apps.folder"
      }),
      item({
        id: "track-2",
        parentId: "expanded",
        title: "02 Iggy Peck.mp3",
        path: "MYO/Science/Questioneers/02 Iggy Peck.mp3",
        mimeType: "audio/mpeg"
      }),
      item({
        id: "track-1",
        parentId: "expanded",
        title: "01 Ada Twist.mp3",
        path: "MYO/Science/Questioneers/01 Ada Twist.mp3",
        mimeType: "audio/mpeg"
      }),
      item({
        id: "folder-cover",
        parentId: "expanded",
        title: "cover_image.png",
        path: "MYO/Science/Questioneers/cover_image.png",
        mimeType: "image/png",
        checksum: "folder-cover-sum",
        owners: [{ emailAddress: "private@example.com" }]
      } as unknown as DriveSnapshotItem)
    ];

    const catalogue = await buildPublicCatalogue({
      items,
      coversDirectory: covers,
      outputDirectory: output,
      generatedAt: "2026-07-24T01:00:00Z",
      scanComplete: true
    });

    expect(catalogue.stats).toEqual({ albums: 2, collections: 1, covers: 2 });
    expect(catalogue.collections[0]).toMatchObject({
      id: "collection",
      path: "MYO/Science",
      albumIds: ["archive", "expanded"]
    });
    expect(catalogue.albums).toEqual([
      expect.objectContaining({
        id: "archive",
        kind: "archive",
        archiveFormat: "zip",
        tracks: [],
        pathSegments: [
          { id: IDEA_EXCHANGE_ROOT_ID, name: "MYO" },
          { id: "collection", name: "Science" },
          { id: "archive", name: "Ada.zip" }
        ],
        cover: expect.objectContaining({
          sourceId: "archive-cover",
          path: "covers/archive.webp"
        })
      }),
      expect.objectContaining({
        id: "expanded",
        kind: "expanded",
        tracks: [
          { id: "track-1", position: 1, title: "Ada Twist" },
          { id: "track-2", position: 2, title: "Iggy Peck" }
        ],
        cover: expect.objectContaining({
          sourceId: "folder-cover",
          path: "covers/expanded.webp"
        })
      })
    ]);
    expect(JSON.stringify(catalogue)).not.toContain("private@example.com");
    expect(
      JSON.parse(await readFile(join(output, "catalogue.json"), "utf8"))
    ).toEqual(catalogue);
  });

  it("finds a canonical cover nested inside an expanded playlist", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "catalogue-cache-"));
    const covers = join(temporary, "covers");
    await mkdir(covers);
    await sharp({
      create: {
        width: 300,
        height: 400,
        channels: 4,
        background: "#d3263f"
      }
    })
      .png()
      .toFile(join(covers, "nested-cover.png"));

    const catalogue = await buildPublicCatalogue({
      items: [
        item({
          id: IDEA_EXCHANGE_ROOT_ID,
          parentId: IDEA_EXCHANGE_ROOT_ID,
          title: "MYO",
          path: "MYO",
          mimeType: "application/vnd.google-apps.folder"
        }),
        item({
          id: "album",
          title: "5 Minute Spider-Man Stories",
          path: "MYO/5 Minute Spider-Man Stories",
          mimeType: "application/vnd.google-apps.folder"
        }),
        item({
          id: "audio",
          parentId: "album",
          title: "audio_files",
          path: "MYO/5 Minute Spider-Man Stories/audio_files",
          mimeType: "application/vnd.google-apps.folder"
        }),
        item({
          id: "track",
          parentId: "audio",
          title: "01 Spider-Man.mp3",
          path: "MYO/5 Minute Spider-Man Stories/audio_files/01 Spider-Man.mp3",
          mimeType: "audio/mpeg"
        }),
        item({
          id: "images",
          parentId: "album",
          title: "images",
          path: "MYO/5 Minute Spider-Man Stories/images",
          mimeType: "application/vnd.google-apps.folder"
        }),
        item({
          id: "nested-cover",
          parentId: "images",
          title: "cover_image.png",
          path: "MYO/5 Minute Spider-Man Stories/images/cover_image.png",
          mimeType: "image/png"
        })
      ],
      coversDirectory: covers,
      outputDirectory: join(temporary, "output")
    });

    expect(catalogue.albums[0].cover).toMatchObject({
      sourceId: "nested-cover",
      path: "covers/album.webp"
    });
  });

  it("uses the only descendant image when an expanded playlist has no canonical cover name", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "catalogue-cache-"));
    const covers = join(temporary, "covers");
    await mkdir(covers);
    await sharp({
      create: {
        width: 300,
        height: 400,
        channels: 4,
        background: "#6f4aa8"
      }
    })
      .jpeg()
      .toFile(join(covers, "only-image.jpg"));

    const catalogue = await buildPublicCatalogue({
      items: [
        item({
          id: IDEA_EXCHANGE_ROOT_ID,
          parentId: IDEA_EXCHANGE_ROOT_ID,
          title: "MYO",
          path: "MYO",
          mimeType: "application/vnd.google-apps.folder"
        }),
        item({
          id: "album",
          title: "5 Minute Ada Twist Scientist Stories",
          path: "MYO/5 Minute Ada Twist Scientist Stories",
          mimeType: "application/vnd.google-apps.folder"
        }),
        item({
          id: "track",
          parentId: "album",
          title: "01 Introduction.mp3",
          path: "MYO/5 Minute Ada Twist Scientist Stories/01 Introduction.mp3",
          mimeType: "audio/mpeg"
        }),
        item({
          id: "only-image",
          parentId: "album",
          title: "5 Minute Ada Twist.jpg",
          path: "MYO/5 Minute Ada Twist Scientist Stories/5 Minute Ada Twist.jpg",
          mimeType: "image/jpeg"
        })
      ],
      coversDirectory: covers,
      outputDirectory: join(temporary, "output")
    });

    expect(catalogue.albums[0].cover).toMatchObject({
      sourceId: "only-image",
      path: "covers/album.webp"
    });
  });

  it("reuses unchanged covers and removes orphaned output atomically", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "catalogue-cache-"));
    const covers = join(temporary, "covers");
    const output = join(temporary, "output");
    await mkdir(covers);
    await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 4,
        background: "#000"
      }
    })
      .png()
      .toFile(join(covers, "cover.png"));
    const firstItems = [
      item({
        id: IDEA_EXCHANGE_ROOT_ID,
        parentId: IDEA_EXCHANGE_ROOT_ID,
        title: "MYO",
        path: "MYO",
        mimeType: "application/vnd.google-apps.folder"
      }),
      item({
        id: "album",
        title: "Album.zip",
        mimeType: "application/zip"
      }),
      item({
        id: "cover",
        title: "Album.png",
        mimeType: "image/png",
        checksum: "same"
      })
    ];
    await buildPublicCatalogue({
      items: firstItems,
      coversDirectory: covers,
      outputDirectory: output
    });
    await writeFile(join(output, "covers", "orphan.webp"), "old");

    await buildPublicCatalogue({
      items: firstItems,
      coversDirectory: join(temporary, "now-missing"),
      outputDirectory: output
    });

    await expect(readFile(join(output, "covers", "album.webp"))).resolves.toBeTruthy();
    await expect(readFile(join(output, "covers", "orphan.webp"))).rejects.toThrow();
  });

  it("rejects items outside the configured root without replacing the old cache", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "catalogue-cache-"));
    const output = join(temporary, "output");
    await mkdir(output);
    await writeFile(join(output, "catalogue.json"), "previous");

    await expect(
      buildPublicCatalogue({
        items: [
          item({
            id: "outside",
            parentId: "unknown",
            title: "Outside.zip",
            mimeType: "application/zip"
          })
        ],
        coversDirectory: join(temporary, "covers"),
        outputDirectory: output
      })
    ).rejects.toThrow(/outside/i);
    await expect(readFile(join(output, "catalogue.json"), "utf8")).resolves.toBe(
      "previous"
    );
  });

  it("rejects ambiguous same-precedence cover mappings", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "catalogue-cache-"));
    await expect(
      buildPublicCatalogue({
        items: [
          item({
            id: IDEA_EXCHANGE_ROOT_ID,
            parentId: IDEA_EXCHANGE_ROOT_ID,
            title: "MYO",
            path: "MYO",
            mimeType: "application/vnd.google-apps.folder"
          }),
          item({
            id: "album",
            title: "Album.zip",
            mimeType: "application/zip"
          }),
          item({
            id: "cover-one",
            title: "Album.png",
            mimeType: "image/png"
          }),
          item({
            id: "cover-two",
            title: "Album.jpg",
            mimeType: "image/jpeg"
          })
        ],
        coversDirectory: join(temporary, "covers"),
        outputDirectory: join(temporary, "output")
      })
    ).rejects.toThrow(/ambiguous cover/i);
  });
});
