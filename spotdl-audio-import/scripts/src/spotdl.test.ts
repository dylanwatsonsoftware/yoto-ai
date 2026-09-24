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

  it("downloads frozen matches without re-querying Spotify metadata", () => {
    const plan = buildSpotdlDownloadArgs(
      buildBatchPreview({
        title: "Album",
        destination: "Yoto Album",
        permission: "Permitted",
        tracks
      }),
      "/tmp/output",
      "/tmp/frozen-batch.spotdl"
    );

    expect(plan.args).toContain("/tmp/frozen-batch.spotdl");
    expect(plan.args.join(" ")).not.toContain("open.spotify.com");
    expect(plan.args.join(" ")).not.toMatch(/cookie|user-auth|password/i);
    expect(plan.songs).toMatchObject([
      {
        name: "One",
        artist: "Artist",
        url: "https://open.spotify.com/track/1",
        song_id: "spotify:track:1",
        download_url: "https://www.youtube.com/watch?v=one",
        list_position: 1,
        list_length: 2
      },
      {
        name: "Two",
        list_position: 2,
        list_length: 2
      }
    ]);
    expect(plan.songs.every((song) =>
      song.genres !== null &&
      song.disc_count !== null &&
      song.tracks_count !== null &&
      song.track_number !== null &&
      song.album_id !== null &&
      song.album_artist !== null
    )).toBe(true);
  });
});
