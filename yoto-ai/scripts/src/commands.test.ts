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
});
