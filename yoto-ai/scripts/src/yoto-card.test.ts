import { describe, expect, it, vi } from "vitest";
import {
  buildYotoCard,
  postYotoCard,
  waitForTranscode
} from "./yoto-card.js";
import { previewCreate } from "./publishing.js";
import type { PlaylistPackage } from "./package-contract.js";

const manifest: PlaylistPackage = {
  schemaVersion: 1,
  title: "Stories",
  source: {
    type: "drive",
    id: "folder-1",
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
