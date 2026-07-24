import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildPlaylistPackage,
  validateArchiveEntries
} from "./package-builder.js";

describe("Drive package builder", () => {
  it("materializes root audio and derives a missing 16x16 icon", async () => {
    const source = await mkdtemp(join(tmpdir(), "idea-source-"));
    const output = await mkdtemp(join(tmpdir(), "idea-output-"));
    await writeFile(join(source, "1. One.mp3"), "audio");
    await sharp({
      create: {
        width: 100,
        height: 80,
        channels: 4,
        background: "#663399"
      }
    })
      .png()
      .toFile(join(source, "cover.png"));

    const manifest = await buildPlaylistPackage({
      sourceDirectory: source,
      outputDirectory: output,
      title: "Album",
      sourceId: "drive-1",
      sourceUrl: "https://drive.google.com/example",
      permission: "Permitted",
      durationFor: async () => 12
    });

    expect(manifest.tracks).toHaveLength(1);
    expect(manifest.tracks[0]!.icon?.path).toBe("icons/01.png");
    await expect(
      sharp(join(output, "icons", "01.png")).metadata()
    ).resolves.toMatchObject({ width: 16, height: 16, channels: 4 });
    expect(
      JSON.parse(
        await readFile(join(output, "playlist-package.json"), "utf8")
      )
    ).toMatchObject({ schemaVersion: 1, title: "Album" });
  });

  it("rejects unsafe or oversized archives before extraction", () => {
    expect(() =>
      validateArchiveEntries(["audio/one.mp3", "../escape.mp3"], 2, 10)
    ).toThrow(/unsafe/i);
    expect(() =>
      validateArchiveEntries(
        Array.from({ length: 10_001 }, (_, index) => `${index}.mp3`),
        10_001,
        10
      )
    ).toThrow(/too many/i);
    expect(() =>
      validateArchiveEntries(["one.mp3"], 1, 3 * 1024 ** 3)
    ).toThrow(/too large/i);
  });
});
