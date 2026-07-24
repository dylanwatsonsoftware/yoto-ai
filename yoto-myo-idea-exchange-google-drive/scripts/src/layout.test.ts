import { describe, expect, it } from "vitest";
import {
  IDEA_EXCHANGE_ROOT_ID,
  assertUnderIdeaExchangeRoot,
  discoverPlaylistLayout
} from "./layout.js";

describe("MYO Idea Exchange playlist discovery", () => {
  it("discovers nested audio and explicit icons", () => {
    const layout = discoverPlaylistLayout([
      "audio_files/2. Two.m4a",
      "audio_files/1. One.m4a",
      "image_files/cover_image.png",
      "image_files/Icon 01.png",
      "image_files/Icon 02.png"
    ]);

    expect(layout.cover).toBe("image_files/cover_image.png");
    expect(layout.tracks.map((track) => track.audio)).toEqual([
      "audio_files/1. One.m4a",
      "audio_files/2. Two.m4a"
    ]);
    expect(layout.tracks.map((track) => track.icon)).toEqual([
      "image_files/Icon 01.png",
      "image_files/Icon 02.png"
    ]);
  });

  it("discovers root audio and positional numeric images", () => {
    const layout = discoverPlaylistLayout([
      "02 - Two.mp3",
      "01 - One.mp3",
      "cover.png",
      "1.png",
      "2.png"
    ]);

    expect(layout.cover).toBe("cover.png");
    expect(layout.tracks.map((track) => track.icon)).toEqual([
      "1.png",
      "2.png"
    ]);
  });

  it("rejects ambiguous icon positions", () => {
    expect(() =>
      discoverPlaylistLayout([
        "1.mp3",
        "image_files/Icon 01.png",
        "image_files/Icon 1.png"
      ])
    ).toThrow(/ambiguous icon/i);
  });

  it("rejects nodes outside the configured root", () => {
    const parents = new Map([
      ["playlist", ["other-root"]],
      ["other-root", []]
    ]);

    expect(() =>
      assertUnderIdeaExchangeRoot("playlist", parents)
    ).toThrow(/outside/i);
    expect(() =>
      assertUnderIdeaExchangeRoot(
        "playlist",
        new Map([["playlist", [IDEA_EXCHANGE_ROOT_ID]]])
      )
    ).not.toThrow();
  });
});
