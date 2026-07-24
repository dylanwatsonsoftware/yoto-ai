import { describe, expect, it } from "vitest";
import {
  buildBatchPreview,
  buildSpotdlDownloadArgs,
  createConfirmationToken,
  verifyConfirmationToken
} from "./spotdl.js";

const tracks = [
  {
    sourceId: "spotify:track:1",
    title: "One",
    artist: "Artist",
    sourceUrl: "https://open.spotify.com/track/1",
    matchedUrl: "https://www.youtube.com/watch?v=one"
  },
  {
    sourceId: "spotify:track:2",
    title: "Two",
    artist: "Artist",
    sourceUrl: "https://open.spotify.com/track/2",
    matchedUrl: "https://www.youtube.com/watch?v=two"
  }
];

describe("spotDL batch workflow", () => {
  it("builds one consolidated preview for every resolved track", () => {
    const preview = buildBatchPreview({
      title: "Album",
      destination: "Yoto Album",
      permission: "I am permitted to copy all listed tracks",
      tracks
    });

    expect(preview.confirmationsRequired).toBe(1);
    expect(preview.tracks).toHaveLength(2);
    expect(preview.summary).toContain("2 tracks");
  });

  it("rejects an unresolved track before confirmation", () => {
    expect(() =>
      buildBatchPreview({
        title: "Album",
        destination: "Yoto Album",
        permission: "Permitted",
        tracks: [{ ...tracks[0]!, matchedUrl: undefined }]
      })
    ).toThrow(/unresolved/i);
  });

  it("binds a short-lived confirmation to the complete preview", () => {
    const preview = buildBatchPreview({
      title: "Album",
      destination: "Yoto Album",
      permission: "Permitted",
      tracks
    });
    const token = createConfirmationToken(preview, "secret", 1_000);

    expect(
      verifyConfirmationToken(token, preview, "secret", 1_500)
    ).toBe(true);
    expect(() =>
      verifyConfirmationToken(token, preview, "secret", 1_000 + 16 * 60_000)
    ).toThrow(/expired/i);
  });

  it("downloads the exact resolved batch without credential options", () => {
    const args = buildSpotdlDownloadArgs(
      buildBatchPreview({
        title: "Album",
        destination: "Yoto Album",
        permission: "Permitted",
        tracks
      }),
      "/tmp/output"
    );

    expect(args).toContain(
      "https://www.youtube.com/watch?v=one|https://open.spotify.com/track/1"
    );
    expect(args.join(" ")).not.toMatch(/cookie|user-auth|password/i);
  });
});
