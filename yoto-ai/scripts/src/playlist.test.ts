import { describe, expect, it } from "vitest";
import { validatePlaylistDraft } from "./playlist.js";

const validDraft = {
  title: "Bedtime stories",
  content: {
    chapters: [
      {
        key: "chapter-1",
        title: "Chapter one",
        defaultTrackDisplay: "1",
        defaultTrackAmbient: "none",
        display: {},
        tracks: [
          {
            key: "track-1",
            uid: "track-1",
            title: "The beginning",
            trackUrl: "yoto:#abcdefghijklmnopqrstuvwxyzABCDEFGHijklmno",
            format: "mp3",
            type: "audio",
            duration: 30,
            fileSize: 1024,
            display: {}
          }
        ]
      }
    ]
  },
  metadata: {
    category: "stories",
    source: {
      description: "Original recording",
      permission: "Created by the account owner"
    }
  }
};

describe("validatePlaylistDraft", () => {
  it("normalizes a valid playlist without adding write-only identifiers", () => {
    const result = validatePlaylistDraft(validDraft);

    expect(result.title).toBe("Bedtime stories");
    expect(result.content.chapters[0]?.tracks[0]?.type).toBe("audio");
    expect(result).not.toHaveProperty("cardId");
  });

  it("rejects drafts without provenance", () => {
    const draft = structuredClone(validDraft);
    delete (draft.metadata as Record<string, unknown>).source;

    expect(() => validatePlaylistDraft(draft)).toThrow(/source permission/i);
  });

  it("rejects insecure remote track URLs", () => {
    const draft = structuredClone(validDraft);
    draft.content.chapters[0]!.tracks[0]!.trackUrl = "http://example.com/story.mp3";

    expect(() => validatePlaylistDraft(draft)).toThrow(/https/i);
  });

  it("rejects duplicate chapter and track keys", () => {
    const draft = structuredClone(validDraft);
    draft.content.chapters.push(structuredClone(draft.content.chapters[0]!));

    expect(() => validatePlaylistDraft(draft)).toThrow(/unique/i);
  });
});
