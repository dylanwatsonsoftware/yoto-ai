import { describe, expect, it, vi } from "vitest";
import {
  buildYotoCard,
  postYotoCard,
  waitForTranscode
} from "./yoto-card.js";
import { previewCreate, previewRepairArtwork } from "./publishing.js";
import type { PublishPreview } from "./publishing.js";
import type { PlaylistPackage } from "./package-contract.js";

const manifest: PlaylistPackage = {
  schemaVersion: 1,
  title: "Stories",
  source: {
    type: "drive",
    id: "1mDJTHB-UPWAzWJYudJ0EhYeS-lT0ROrd",
    description: "MYO exchange",
    permission: "User confirmed permission"
  },
  cover: { path: "cover.png", sha256: "a".repeat(64) },
  tracks: [
    {
      position: 1,
      sourceId: "source-track-1",
      title: "Ada",
      artist: "",
      audio: {
        path: "ada.m4a",
        sha256: "b".repeat(64),
        duration: 10,
        format: "m4a"
      },
      icon: { path: "ada.png", sha256: "c".repeat(64) }
    }
  ]
};

describe("Yoto card payload", () => {
  it("waits for a completed transcode instead of accepting a started job", async () => {
    const getTranscode = vi
      .fn()
      .mockResolvedValueOnce({ uploadId: "upload-1", startedAt: "now" })
      .mockResolvedValueOnce({
        transcodedSha256: "d".repeat(43),
        transcodedInfo: {
          duration: 10,
          fileSize: 1234,
          channels: "stereo",
          format: "aac"
        }
      });

    const result = await waitForTranscode("upload-1", getTranscode, {
      attempts: 2,
      delayMs: 0
    });

    expect(result.transcodedSha256).toBe("d".repeat(43));
    expect(getTranscode).toHaveBeenCalledTimes(2);
  });

  it("maps completed media, icons, and cover into the Yoto schema", () => {
    const preview = previewCreate("/package", manifest);
    const card = buildYotoCard({
      preview,
      audio: [
        {
          transcodedSha256: "d".repeat(43),
          transcodedInfo: {
            duration: 10,
            fileSize: 1234,
            channels: "stereo",
            format: "m4a"
          }
        }
      ],
      icons: [
        {
          displayIcon: {
            mediaId: "e".repeat(43)
          }
        }
      ],
      cover: {
        coverImage: {
          mediaUrl: "https://example.com/cover.png"
        }
      }
    });

    expect(card).toMatchObject({
      title: "Stories",
      content: {
        playbackType: "linear",
        chapters: [
          {
            display: { icon16x16: `yoto:#${"e".repeat(43)}` },
            tracks: [
              {
                trackUrl: `yoto:#${"d".repeat(43)}`,
                format: "x-m4a",
                fileSize: 1234,
                display: { icon16x16: `yoto:#${"e".repeat(43)}` }
              }
            ]
          }
        ]
      },
      metadata: {
        cover: { imageL: "https://example.com/cover.png" },
        media: { duration: 10, fileSize: 1234 }
      }
    });
    const chapterKey = (
      card.content as { chapters: Array<{ key: string }> }
    ).chapters[0].key;
    expect(chapterKey.length).toBeLessThanOrEqual(20);
  });

  it("creates standalone collection items as numbered single-track chapters", () => {
    const twoTrackManifest: PlaylistPackage = {
      ...manifest,
      tracks: [
        manifest.tracks[0]!,
        {
          ...manifest.tracks[0]!,
          position: 2,
          sourceId: "source-track-2",
          title: "Grace",
          audio: {
            ...manifest.tracks[0]!.audio,
            path: "grace.m4a",
            sha256: "f".repeat(64)
          }
        }
      ]
    };
    const preview = previewCreate(
      "/package",
      twoTrackManifest,
      undefined,
      undefined,
      "single-track-chapters"
    );

    const card = buildYotoCard({
      preview,
      audio: [
        { transcodedSha256: "d".repeat(43), transcodedInfo: { duration: 10, fileSize: 100, format: "mp3" } },
        { transcodedSha256: "e".repeat(43), transcodedInfo: { duration: 11, fileSize: 110, format: "mp3" } }
      ],
      icons: [null, null],
      cover: null
    });
    const chapters = (card.content as {
      chapters: Array<{
        key: string;
        overlayLabel: string;
        tracks: Array<{ key: string; title: string; overlayLabel: string }>;
      }>;
    }).chapters;

    expect(chapters).toHaveLength(2);
    expect(chapters.map((chapter) => chapter.overlayLabel)).toEqual(["1", "2"]);
    expect(chapters.map((chapter) => chapter.tracks[0]?.overlayLabel)).toEqual(["1", "2"]);
    expect(chapters.map((chapter) => chapter.tracks[0]?.title)).toEqual(["Ada", "Grace"]);
    expect(chapters.every((chapter) => chapter.tracks.length === 1)).toBe(true);
    expect(chapters.every((chapter) => chapter.key.length <= 20)).toBe(true);
  });

  it("preserves existing metadata and aggregates media totals when appending", () => {
    const existingCard = {
      content: {
        playbackType: "linear",
        chapters: [{ key: "existing", title: "Existing", tracks: [] }]
      },
      metadata: {
        description: "Original description",
        cover: { imageL: "https://example.com/original.png" },
        media: { duration: 20, fileSize: 2000 }
      }
    };
    const preview = previewCreate("/package", manifest, {
      cardId: "card-1",
      title: "Stories",
      tracks: [],
      metadata: existingCard
    });

    const card = buildYotoCard({
      preview,
      audio: [{
        transcodedSha256: "d".repeat(43),
        transcodedInfo: {
          duration: 10,
          fileSize: 1234,
          channels: "stereo",
          format: "mp3"
        }
      }],
      icons: [{ displayIcon: { mediaId: "new-icon" } }],
      cover: { coverImage: { mediaUrl: "https://example.com/new.png" } }
    });

    expect(card).toMatchObject({
      cardId: "card-1",
      title: "Stories",
      content: { chapters: [{ key: "existing" }, {}] },
      metadata: {
        description: "Original description",
        cover: { imageL: "https://example.com/original.png" },
        media: { duration: 30, fileSize: 3234 }
      }
    });
  });

  it("uses an explicit final title when appending", () => {
    const preview = previewCreate("/package", manifest, {
      cardId: "card-1",
      title: "The InBESTigators - Season 1 (2019)",
      tracks: [],
      metadata: {
        content: { chapters: [{ key: "season-1", title: "Season 1", tracks: [] }] },
        metadata: { media: { duration: 20, fileSize: 2000 } }
      }
    }, "The InBESTigators - Seasons 1 & 2");

    const card = buildYotoCard({
      preview,
      audio: [{
        transcodedSha256: "d".repeat(43),
        transcodedInfo: { duration: 10, fileSize: 1234, format: "mp3" }
      }],
      icons: [null],
      cover: null
    });

    expect(card.title).toBe("The InBESTigators - Seasons 1 & 2");
  });

  it("preserves a one-song-per-chapter layout when appending songs", () => {
    const twoTrackManifest: PlaylistPackage = {
      ...manifest,
      tracks: [
        manifest.tracks[0]!,
        {
          ...manifest.tracks[0]!,
          position: 2,
          sourceId: "source-track-2",
          title: "Grace",
          audio: {
            ...manifest.tracks[0]!.audio,
            path: "grace.m4a",
            sha256: "f".repeat(64)
          }
        }
      ]
    };
    const existingCard = {
      content: {
        playbackType: "linear",
        chapters: [{
          key: "existing",
          title: "Existing Song",
          tracks: [{ key: "01", title: "Existing Song" }]
        }]
      },
      metadata: { media: { duration: 20, fileSize: 2000 } }
    };
    const preview = previewCreate("/package", twoTrackManifest, {
      cardId: "card-1",
      title: "Songs",
      tracks: [{ title: "Existing Song", artist: "", duration: 20 }],
      metadata: existingCard
    });

    const card = buildYotoCard({
      preview,
      audio: [
        {
          transcodedSha256: "d".repeat(43),
          transcodedInfo: { duration: 10, fileSize: 1234, format: "m4a" }
        },
        {
          transcodedSha256: "e".repeat(43),
          transcodedInfo: { duration: 11, fileSize: 1235, format: "m4a" }
        }
      ],
      icons: [
        { displayIcon: { mediaId: "icon-1" } },
        { displayIcon: { mediaId: "icon-2" } }
      ],
      cover: null
    });
    const chapters = (card.content as {
      chapters: Array<{ title: string; tracks: Array<{ title: string }> }>;
    }).chapters;

    expect(chapters).toHaveLength(3);
    expect(chapters.slice(1)).toEqual([
      expect.objectContaining({ title: "Ada", tracks: [expect.objectContaining({ title: "Ada" })] }),
      expect.objectContaining({ title: "Grace", tracks: [expect.objectContaining({ title: "Grace" })] })
    ]);
  });

  it("keeps imported tracks grouped when the existing card is not a song playlist", () => {
    const twoTrackManifest: PlaylistPackage = {
      ...manifest,
      tracks: [
        manifest.tracks[0]!,
        { ...manifest.tracks[0]!, position: 2, sourceId: "source-track-2", title: "Grace" }
      ]
    };
    const preview = previewCreate("/package", twoTrackManifest, {
      cardId: "card-1",
      title: "Stories",
      tracks: [],
      metadata: {
        content: {
          chapters: [{
            key: "story",
            title: "Story",
            tracks: [{ title: "Part 1" }, { title: "Part 2" }]
          }]
        },
        metadata: { media: { duration: 20, fileSize: 2000 } }
      }
    });

    const card = buildYotoCard({
      preview,
      audio: [
        { transcodedSha256: "d".repeat(43), transcodedInfo: { duration: 10, fileSize: 100, format: "mp3" } },
        { transcodedSha256: "e".repeat(43), transcodedInfo: { duration: 11, fileSize: 110, format: "mp3" } }
      ],
      icons: [null, null],
      cover: null
    });
    const chapters = (card.content as { chapters: Array<{ tracks: unknown[] }> }).chapters;

    expect(chapters).toHaveLength(2);
    expect(chapters[1]?.tracks).toHaveLength(2);
  });

  it("splits one imported multi-song chapter without changing its media", () => {
    const groupedTracks = [
      {
        key: "01",
        title: "Ada",
        trackUrl: "yoto:#audio-1",
        duration: 10,
        fileSize: 100,
        display: { icon16x16: "yoto:#icon-1" }
      },
      {
        key: "02",
        title: "Grace",
        trackUrl: "yoto:#audio-2",
        duration: 11,
        fileSize: 110,
        display: { icon16x16: "yoto:#icon-2" }
      }
    ];
    const twoTrackManifest: PlaylistPackage = {
      ...manifest,
      tracks: [
        manifest.tracks[0]!,
        { ...manifest.tracks[0]!, position: 2, sourceId: "source-track-2", title: "Grace" }
      ]
    };
    const preview = {
      version: 1,
      operation: "repair-song-layout",
      packageDirectory: "/package",
      package: twoTrackManifest,
      cardId: "card-1",
      targetChapterKey: "grouped",
      existing: {
        cardId: "card-1",
        title: "Songs",
        tracks: [],
        metadata: {
          content: {
            playbackType: "linear",
            chapters: [
              { key: "old", title: "Old", tracks: [{ key: "01", title: "Old" }] },
              { key: "grouped", title: "Imported", tracks: groupedTracks }
            ]
          },
          metadata: { media: { duration: 41, fileSize: 410 } }
        }
      },
      tracksToAdd: [],
      duplicates: [],
      confirmationsRequired: 1
    } as unknown as PublishPreview;

    const card = buildYotoCard({ preview, audio: [], icons: [], cover: null });
    const chapters = (card.content as {
      chapters: Array<{ title: string; tracks: Array<Record<string, unknown>> }>;
    }).chapters;

    expect(chapters).toHaveLength(3);
    expect(chapters.slice(1).map((chapter) => ({
      title: chapter.title,
      tracks: chapter.tracks.length,
      trackUrl: chapter.tracks[0]?.trackUrl
    }))).toEqual([
      { title: "Ada", tracks: 1, trackUrl: "yoto:#audio-1" },
      { title: "Grace", tracks: 1, trackUrl: "yoto:#audio-2" }
    ]);
    expect(card.metadata).toEqual({ media: { duration: 41, fileSize: 410 } });
  });

  it("repairs artwork for only the explicitly targeted song chapters", () => {
    const existingCard = {
      content: {
        playbackType: "linear",
        chapters: [
          {
            key: "keep",
            title: "Keep",
            display: { icon16x16: "yoto:#keep-icon" },
            tracks: [{
              key: "01",
              title: "Keep",
              trackUrl: "yoto:#keep-audio",
              display: { icon16x16: "yoto:#keep-icon" }
            }]
          },
          {
            key: "replace",
            title: "Ada",
            display: { icon16x16: "yoto:#old-icon" },
            tracks: [{
              key: "01",
              title: "Ada",
              trackUrl: "yoto:#ada-audio",
              display: { icon16x16: "yoto:#old-icon" }
            }]
          }
        ]
      },
      metadata: { cover: { imageL: "https://example.com/original.png" } }
    };
    const preview = {
      ...previewCreate("/package", manifest, {
        cardId: "card-1",
        title: "Songs",
        tracks: [],
        metadata: existingCard
      }),
      operation: "repair-track-artwork",
      tracksToAdd: [],
      targetChapterKeys: ["replace"]
    } as unknown as PublishPreview;

    const card = buildYotoCard({
      preview,
      audio: [],
      icons: [{ displayIcon: { mediaId: "new-icon" } }],
      cover: null
    });
    const chapters = (card.content as {
      chapters: Array<{ display: { icon16x16: string }; tracks: Array<Record<string, unknown>> }>;
    }).chapters;

    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.display.icon16x16).toBe("yoto:#keep-icon");
    expect(chapters[1]?.display.icon16x16).toBe("yoto:#new-icon");
    expect(chapters[1]?.tracks[0]).toMatchObject({
      trackUrl: "yoto:#ada-audio",
      display: { icon16x16: "yoto:#new-icon" }
    });
    expect(card.metadata).toEqual(existingCard.metadata);
  });

  it("repairs track overlay labels in global playback order", () => {
    const twoTrackManifest: PlaylistPackage = {
      ...manifest,
      tracks: [
        manifest.tracks[0]!,
        {
          ...manifest.tracks[0]!,
          position: 2,
          sourceId: "source-track-2",
          title: "Grace"
        }
      ]
    };
    const existingCard = {
      content: {
        playbackType: "linear",
        chapters: [
          {
            key: "season-1",
            title: "Season 1",
            overlayLabel: "1",
            tracks: [{
              key: "01",
              title: "Ada",
              overlayLabel: "1",
              trackUrl: "yoto:#audio-1",
              display: { icon16x16: "yoto:#icon-1" }
            }]
          },
          {
            key: "season-2",
            title: "Season 2",
            overlayLabel: "2",
            tracks: [{
              key: "01",
              title: "Grace",
              overlayLabel: "2",
              trackUrl: "yoto:#audio-2",
              display: { icon16x16: "yoto:#icon-2" }
            }]
          }
        ]
      },
      metadata: { cover: { imageL: "https://example.com/original.png" } }
    };
    const preview = {
      ...previewCreate("/package", twoTrackManifest, {
        cardId: "card-1",
        title: "Stories",
        tracks: [],
        metadata: existingCard
      }),
      operation: "repair-track-labels",
      tracksToAdd: []
    } as unknown as PublishPreview;

    const card = buildYotoCard({ preview, audio: [], icons: [], cover: null });
    const chapters = (card.content as {
      chapters: Array<{ overlayLabel: string; tracks: Array<Record<string, unknown>> }>;
    }).chapters;

    expect(chapters.map((chapter) => chapter.overlayLabel)).toEqual(["1", "2"]);
    expect(chapters.flatMap((chapter) => chapter.tracks.map((track) => track.overlayLabel)))
      .toEqual(["1", "2"]);
    expect(chapters.flatMap((chapter) => chapter.tracks.map((track) => track.trackUrl)))
      .toEqual(["yoto:#audio-1", "yoto:#audio-2"]);
    expect(card.metadata).toEqual(existingCard.metadata);
  });

  it("replaces cover and track icons while preserving existing audio", () => {
    const existingCard = {
      content: {
        playbackType: "linear",
        chapters: [{
          key: "existing",
          title: "Stories",
          display: { icon16x16: "yoto:#old-chapter-icon" },
          tracks: [{
            key: "01",
            uid: "source-track-1",
            title: "Ada",
            trackUrl: "yoto:#existing-audio",
            format: "mp3",
            type: "audio",
            duration: 10,
            fileSize: 1234,
            display: { icon16x16: "yoto:#old-icon" }
          }]
        }]
      },
      metadata: {
        cover: { imageL: "https://example.com/old.png" },
        media: { duration: 10, fileSize: 1234 }
      }
    };
    const preview = previewRepairArtwork("/package", manifest, {
      cardId: "card-1",
      title: "Stories",
      tracks: [{ title: "Ada", artist: "", duration: 10 }],
      metadata: existingCard
    });

    const card = buildYotoCard({
      preview,
      audio: [],
      icons: [{ displayIcon: { mediaId: "new-icon" } }],
      cover: { coverImage: { mediaUrl: "https://example.com/new.png" } }
    });

    expect(card).toMatchObject({
      cardId: "card-1",
      content: {
        chapters: [{
          display: { icon16x16: "yoto:#new-icon" },
          tracks: [{
            trackUrl: "yoto:#existing-audio",
            display: { icon16x16: "yoto:#new-icon" }
          }]
        }]
      },
      metadata: { cover: { imageL: "https://example.com/new.png" } }
    });
  });

  it("preserves Yoto's validation message when card creation fails", async () => {
    const request = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            code: "bad-request",
            message: "content.chapters[0].tracks[0].format is invalid"
          }
        })
    }));

    await expect(
      postYotoCard(
        { title: "Stories", content: { chapters: [] }, metadata: {} },
        "access-token",
        request
      )
    ).rejects.toThrow(
      "Yoto card mutation failed (400): content.chapters[0].tracks[0].format is invalid"
    );
  });
});
