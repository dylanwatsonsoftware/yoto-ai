import { describe, expect, it, vi } from "vitest";
import { executeCommand, UnsupportedOperationError } from "./commands.js";
import { MemoryTokenStore } from "./auth.js";
import { YotoService } from "./yoto-service.js";

const service = new YotoService({
  devices: {
    getMyDevices: async () => [
      { id: "player-1", name: "Bedroom", type: "mini", status: "online" }
    ]
  },
  content: {
    getMyCards: async () => [{ cardId: "card-1", title: "Stories" }],
    getCard: async () => ({ content: {}, metadata: {} })
  }
});

const auth = {
  login: async () => ({ authenticated: true }),
  status: async () => ({ authenticated: false }),
  logout: async () => ({ authenticated: false })
};

describe("executeCommand", () => {
  it("routes device list to the read-only service", async () => {
    await expect(
      executeCommand(["devices", "list"], {
        auth,
        service,
        readFile: async () => "",
        tokenStore: new MemoryTokenStore()
      })
    ).resolves.toMatchObject({ devices: [{ id: "player-1" }] });
  });

  it("validates playlist input without publishing it", async () => {
    const draft = {
      title: "Draft",
      content: {
        chapters: [
          {
            key: "c1",
            title: "One",
            defaultTrackDisplay: "1",
            defaultTrackAmbient: "none",
            display: {},
            tracks: [
              {
                key: "t1",
                uid: "t1",
                title: "Track",
                trackUrl: "https://example.com/audio.mp3",
                format: "mp3",
                type: "audio",
                duration: 1,
                fileSize: 1,
                display: {}
              }
            ]
          }
        ]
      },
      metadata: {
        source: { description: "Original", permission: "Owner-created" }
      }
    };

    const result = await executeCommand(["playlist", "draft", "--input", "draft.json"], {
      auth,
      service,
      readFile: async () => JSON.stringify(draft),
      tokenStore: new MemoryTokenStore()
    });

    expect(result).toMatchObject({ published: false, draft: { title: "Draft" } });
  });

  it("rejects publishing and player-control commands", async () => {
    await expect(
      executeCommand(["devices", "play", "player-1"], {
        auth,
        service,
        readFile: async () => "",
        tokenStore: new MemoryTokenStore()
      })
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  it("applies an explicitly confirmed preview without a shared secret", async () => {
    const preview = {
      version: 1 as const,
      operation: "create" as const,
      packageDirectory: "/package",
      package: {
        schemaVersion: 1 as const,
        title: "Stories",
        source: {
          type: "local" as const,
          id: "stories",
          description: "test",
          permission: "Owner-created"
        },
        cover: { path: "cover.png", sha256: "a".repeat(64) },
        tracks: []
      },
      tracksToAdd: [],
      duplicates: [],
      confirmationsRequired: 1 as const
    };
    const mutateCard = vi.fn(async () => ({ cardId: "new-card" }));
    const dependencies = {
      auth,
      service,
      readFile: async () => JSON.stringify(preview),
      tokenStore: new MemoryTokenStore(),
      writeApi: {
        uploadAudio: vi.fn(),
        uploadCover: vi.fn(async () => ({ mediaUrl: "cover" })),
        uploadIcon: vi.fn(),
        mutateCard
      }
    };

    await executeCommand(
      ["playlist", "apply", "--preview", "preview.json"],
      dependencies
    );
    expect(mutateCard).toHaveBeenCalledOnce();
  });

  it("reads back a successful mutation and reports a broken persisted layout without retrying it", async () => {
    const preview = {
      version: 1 as const,
      operation: "create" as const,
      chapterLayout: "single-track-chapters" as const,
      packageDirectory: "/package",
      package: {
        schemaVersion: 1 as const,
        title: "Story Collection",
        source: {
          type: "local" as const,
          id: "stories",
          description: "test",
          permission: "Owner-created"
        },
        cover: { path: "cover.png", sha256: "a".repeat(64) },
        tracks: [
          {
            position: 1,
            sourceId: "story-1",
            title: "One",
            artist: "",
            audio: { path: "one.mp3", sha256: "b".repeat(64), duration: 60, format: "mp3" }
          },
          {
            position: 2,
            sourceId: "story-2",
            title: "Two",
            artist: "",
            audio: { path: "two.mp3", sha256: "c".repeat(64), duration: 61, format: "mp3" }
          }
        ]
      },
      tracksToAdd: [],
      duplicates: [],
      confirmationsRequired: 1 as const
    };
    const getCard = vi.fn(async () => ({
      cardId: "new-card",
      title: "Story Collection",
      content: {
        chapters: [{
          key: "00",
          title: "Story Collection",
          tracks: [
            { key: "01", title: "One", overlayLabel: "1" },
            { key: "02", title: "Two", overlayLabel: "1" }
          ]
        }]
      },
      metadata: {}
    }));
    const readbackService = new YotoService({
      devices: { getMyDevices: async () => [] },
      content: { getMyCards: async () => [], getCard }
    });
    const mutateCard = vi.fn(async () => ({ cardId: "new-card" }));

    const result = await executeCommand(
      ["playlist", "apply", "--preview", "preview.json"],
      {
        auth,
        service: readbackService,
        readFile: async () => JSON.stringify(preview),
        tokenStore: new MemoryTokenStore(),
        writeApi: {
          uploadAudio: vi.fn(),
          uploadCover: vi.fn(async () => null),
          uploadIcon: vi.fn(),
          mutateCard
        }
      }
    ) as { verification: { verified: boolean; issues: string[] } };

    expect(mutateCard).toHaveBeenCalledOnce();
    expect(getCard).toHaveBeenCalledOnce();
    expect(result.verification.verified).toBe(false);
    expect(result.verification.issues.join(" ")).toContain("single-track chapter");
  });

  it("previews a new collection as one single-track chapter per item when requested", async () => {
    const packageManifest = {
      schemaVersion: 1 as const,
      title: "Story Collection",
      source: {
        type: "local" as const,
        id: "stories",
        description: "test",
        permission: "Owner-created"
      },
      cover: { path: "cover.png", sha256: "a".repeat(64) },
      tracks: []
    };
    const emptyService = new YotoService({
      devices: { getMyDevices: async () => [] },
      content: { getMyCards: async () => [], getCard: async () => ({}) }
    });

    const result = await executeCommand(
      [
        "playlist",
        "preview-create",
        "--input",
        "/package",
        "--single-track-chapters"
      ],
      {
        auth,
        service: emptyService,
        readFile: async () => "",
        tokenStore: new MemoryTokenStore(),
        inspectPackage: async () => packageManifest
      }
    );

    expect(result).toMatchObject({ chapterLayout: "single-track-chapters" });
  });

  it("previews an artwork-only repair for an existing card", async () => {
    const packageManifest = {
      schemaVersion: 1,
      title: "Stories",
      source: {
        type: "local",
        id: "stories",
        description: "test",
        permission: "Owner-created"
      },
      cover: { path: "cover.png", sha256: "a".repeat(64) },
      tracks: []
    };
    const result = await executeCommand(
      [
        "playlist",
        "preview-repair-artwork",
        "--input",
        "/package",
        "--card-id",
        "card-1"
      ],
      {
        auth,
        service,
        readFile: async () => JSON.stringify(packageManifest),
        tokenStore: new MemoryTokenStore(),
        inspectPackage: async () => packageManifest
      }
    );

    expect(result).toMatchObject({
      operation: "repair-artwork",
      cardId: "card-1",
      tracksToAdd: []
    });
  });

  it("previews an append with an explicit final title", async () => {
    const packageManifest = {
      schemaVersion: 1 as const,
      title: "The InBESTigators - Season 2 (2020)",
      source: {
        type: "local" as const,
        id: "inbestigators-season-2",
        description: "test",
        permission: "Owner-created"
      },
      cover: { path: "cover.png", sha256: "a".repeat(64) },
      tracks: []
    };
    const appendService = new YotoService({
      devices: { getMyDevices: async () => [] },
      content: {
        getMyCards: async () => [],
        getCard: async () => ({
          cardId: "card-1",
          title: "The InBESTigators - Season 1 (2019)",
          content: { chapters: [{ key: "season-1", tracks: [] }] },
          metadata: {}
        })
      }
    });

    const result = await executeCommand(
      [
        "playlist",
        "preview-append",
        "--input",
        "/package",
        "--card-id",
        "card-1",
        "--title",
        "The InBESTigators - Seasons 1 & 2"
      ],
      {
        auth,
        service: appendService,
        readFile: async () => "",
        tokenStore: new MemoryTokenStore(),
        inspectPackage: async () => packageManifest
      }
    );

    expect(result).toMatchObject({
      operation: "append",
      cardId: "card-1",
      finalTitle: "The InBESTigators - Seasons 1 & 2"
    });
  });

  it("previews splitting the final imported chapter into song entries", async () => {
    const packageManifest = {
      schemaVersion: 1 as const,
      title: "Songs",
      source: {
        type: "local" as const,
        id: "songs",
        description: "test",
        permission: "Owner-created"
      },
      cover: { path: "cover.png", sha256: "a".repeat(64) },
      tracks: [
        {
          position: 1,
          sourceId: "song-1",
          title: "One",
          artist: "Artist",
          audio: { path: "one.mp3", sha256: "b".repeat(64), duration: 60, format: "mp3" }
        },
        {
          position: 2,
          sourceId: "song-2",
          title: "Two",
          artist: "Artist",
          audio: { path: "two.mp3", sha256: "c".repeat(64), duration: 61, format: "mp3" }
        }
      ]
    };
    const repairService = new YotoService({
      devices: { getMyDevices: async () => [] },
      content: {
        getMyCards: async () => [],
        getCard: async () => ({
          cardId: "card-1",
          title: "Songs",
          content: {
            chapters: [{
              key: "grouped",
              tracks: [{ title: "One", duration: 60 }, { title: "Two", duration: 61 }]
            }]
          },
          metadata: {}
        })
      }
    });

    const result = await executeCommand(
      [
        "playlist",
        "preview-repair-song-layout",
        "--input",
        "/package",
        "--card-id",
        "card-1",
        "--chapter-key",
        "grouped"
      ],
      {
        auth,
        service: repairService,
        readFile: async () => "",
        tokenStore: new MemoryTokenStore(),
        inspectPackage: async () => packageManifest
      }
    );

    expect(result).toMatchObject({
      operation: "repair-song-layout",
      cardId: "card-1",
      targetChapterKey: "grouped",
      tracksToAdd: []
    });
  });

  it("previews artwork repair for exact song chapter keys", async () => {
    const packageManifest = {
      schemaVersion: 1 as const,
      title: "Songs",
      source: {
        type: "local" as const,
        id: "songs",
        description: "test",
        permission: "Owner-created"
      },
      cover: { path: "cover.png", sha256: "a".repeat(64) },
      tracks: [
        {
          position: 1,
          sourceId: "song-1",
          title: "One",
          artist: "Artist",
          audio: { path: "one.mp3", sha256: "b".repeat(64), duration: 60, format: "mp3" },
          icon: { path: "one.png", sha256: "d".repeat(64) }
        },
        {
          position: 2,
          sourceId: "song-2",
          title: "Two",
          artist: "Artist",
          audio: { path: "two.mp3", sha256: "c".repeat(64), duration: 61, format: "mp3" },
          icon: { path: "two.png", sha256: "e".repeat(64) }
        }
      ]
    };
    const repairService = new YotoService({
      devices: { getMyDevices: async () => [] },
      content: {
        getMyCards: async () => [],
        getCard: async () => ({
          cardId: "card-1",
          title: "Songs",
          content: {
            chapters: [
              { key: "keep", title: "Keep", tracks: [{ title: "Keep" }] },
              { key: "one", title: "One", tracks: [{ title: "One" }] },
              { key: "two", title: "Two", tracks: [{ title: "Two" }] }
            ]
          },
          metadata: {}
        })
      }
    });

    const result = await executeCommand(
      [
        "playlist",
        "preview-repair-track-artwork",
        "--input",
        "/package",
        "--card-id",
        "card-1",
        "--chapter-keys",
        "one,two"
      ],
      {
        auth,
        service: repairService,
        readFile: async () => "",
        tokenStore: new MemoryTokenStore(),
        inspectPackage: async () => packageManifest
      }
    );

    expect(result).toMatchObject({
      operation: "repair-track-artwork",
      cardId: "card-1",
      targetChapterKeys: ["one", "two"],
      tracksToAdd: []
    });
  });

  it("previews a global track-label repair after exact title matching", async () => {
    const packageManifest = {
      schemaVersion: 1 as const,
      title: "Stories",
      source: {
        type: "local" as const,
        id: "stories",
        description: "test",
        permission: "Owner-created"
      },
      cover: { path: "cover.png", sha256: "a".repeat(64) },
      tracks: [
        {
          position: 1,
          sourceId: "story-1",
          title: "One",
          artist: "",
          audio: { path: "one.mp3", sha256: "b".repeat(64), duration: 60, format: "mp3" as const }
        },
        {
          position: 2,
          sourceId: "story-2",
          title: "Two",
          artist: "",
          audio: { path: "two.mp3", sha256: "c".repeat(64), duration: 61, format: "mp3" as const }
        }
      ]
    };
    const repairService = new YotoService({
      devices: { getMyDevices: async () => [] },
      content: {
        getMyCards: async () => [],
        getCard: async () => ({
          cardId: "card-1",
          title: "Stories",
          content: {
            chapters: [
              { key: "season-1", tracks: [{ title: "One", duration: 60, overlayLabel: "1" }] },
              { key: "season-2", tracks: [{ title: "Two", duration: 61, overlayLabel: "2" }] }
            ]
          },
          metadata: {}
        })
      }
    });

    await expect(executeCommand(
      [
        "playlist",
        "preview-repair-track-labels",
        "--input",
        "/package",
        "--card-id",
        "card-1"
      ],
      {
        auth,
        service: repairService,
        readFile: async () => "",
        tokenStore: new MemoryTokenStore(),
        inspectPackage: async () => packageManifest
      }
    )).resolves.toMatchObject({
      operation: "repair-track-labels",
      cardId: "card-1",
      tracksToAdd: []
    });
  });
});
