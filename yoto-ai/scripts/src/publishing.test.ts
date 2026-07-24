import { describe, expect, it, vi } from "vitest";
import {
  applyPreview,
  createConfirmationToken,
  previewCreate
} from "./publishing.js";
import type { PlaylistPackage } from "./package-contract.js";

const packageManifest: PlaylistPackage = {
  schemaVersion: 1,
  title: "Dance Mix",
  source: {
    type: "local",
    id: "mix-1",
    description: "test",
    permission: "I have permission"
  },
  cover: { path: "cover.png", sha256: "a".repeat(64) },
  tracks: [
    {
      position: 1,
      sourceId: "track-1",
      title: "One",
      artist: "Artist",
      audio: {
        path: "one.mp3",
        sha256: "b".repeat(64),
        duration: 60,
        format: "mp3"
      },
      icon: { path: "one.png", sha256: "c".repeat(64) }
    },
    {
      position: 2,
      sourceId: "track-2",
      title: "Two",
      artist: "Artist",
      audio: {
        path: "two.mp3",
        sha256: "d".repeat(64),
        duration: 61,
        format: "mp3"
      },
      icon: { path: "two.png", sha256: "e".repeat(64) }
    }
  ]
};

describe("Yoto publishing", () => {
  it("uploads every asset only after one confirmation and mutates once", async () => {
    const preview = previewCreate("/package", packageManifest);
    const api = {
      uploadAudio: vi.fn(async (track: unknown) => ({ mediaId: String(track) })),
      uploadCover: vi.fn(async () => ({ mediaUrl: "cover-url" })),
      uploadIcon: vi.fn(async () => ({ mediaUrl: "icon-url" })),
      mutateCard: vi.fn(async () => ({ cardId: "new-card" }))
    };

    await expect(
      applyPreview(preview, "bad", "secret", api)
    ).rejects.toThrow();
    expect(api.uploadAudio).not.toHaveBeenCalled();

    const token = createConfirmationToken(preview, "secret");
    await applyPreview(preview, token, "secret", api);
    expect(api.uploadAudio).toHaveBeenCalledTimes(2);
    expect(api.uploadIcon).toHaveBeenCalledTimes(2);
    expect(api.uploadCover).toHaveBeenCalledTimes(1);
    expect(api.mutateCard).toHaveBeenCalledTimes(1);
  });

  it("detects duplicates by stable source id before append", () => {
    const preview = previewCreate("/package", packageManifest, {
      cardId: "card-1",
      title: "Dance Mix",
      tracks: [
        {
          sourceId: "track-1",
          title: "Old title",
          artist: "",
          duration: 1
        }
      ]
    });
    expect(preview.duplicates).toEqual([
      expect.objectContaining({ sourceId: "track-1", reason: "sourceId" })
    ]);
    expect(preview.tracksToAdd).toHaveLength(1);
  });

  it("resumes uploaded media by checksum and never retries final mutation", async () => {
    const preview = previewCreate("/package", packageManifest);
    const stored = new Map<string, unknown>([
      [packageManifest.tracks[0].audio.sha256, { url: "already-uploaded" }]
    ]);
    const checkpoint = {
      get: vi.fn(async (checksum: string) => stored.get(checksum)),
      put: vi.fn(async (checksum: string, result: unknown) => {
        stored.set(checksum, result);
      })
    };
    const api = {
      uploadAudio: vi.fn(async () => ({ url: "uploaded" })),
      uploadCover: vi.fn(async () => ({ mediaUrl: "cover" })),
      uploadIcon: vi.fn(async () => ({ mediaUrl: "icon" })),
      mutateCard: vi.fn(async () => {
        throw new Error("final mutation failed");
      })
    };
    const token = createConfirmationToken(preview, "secret");

    await expect(
      applyPreview(preview, token, "secret", api, checkpoint)
    ).rejects.toThrow("final mutation failed");
    expect(api.uploadAudio).toHaveBeenCalledTimes(1);
    expect(api.mutateCard).toHaveBeenCalledTimes(1);
  });
});
