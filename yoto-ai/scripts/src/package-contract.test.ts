import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectPlaylistPackage } from "./package-contract.js";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "playlist-package-"));
  await mkdir(join(root, "audio"));
  await writeFile(join(root, "audio", "01.mp3"), "audio");
  await writeFile(join(root, "cover.png"), "cover");
  const manifest = {
    schemaVersion: 1,
    title: "Songs",
    source: {
      type: "drive",
      id: "source-1",
      url: "https://drive.google.com/example",
      description: "MYO Idea Exchange",
      permission: "User confirmed permission"
    },
    cover: { path: "cover.png", sha256: sha256("cover") },
    tracks: [
      {
        position: 1,
        sourceId: "track-1",
        title: "One",
        artist: "Artist",
        audio: {
          path: "audio/01.mp3",
          sha256: sha256("audio"),
          duration: 10,
          format: "mp3"
        }
      }
    ]
  };
  await writeFile(
    join(root, "playlist-package.json"),
    JSON.stringify(manifest)
  );
  return { root, manifest };
}

describe("playlist package contract", () => {
  it("validates package files and checksums", async () => {
    const { root } = await fixture();

    await expect(inspectPlaylistPackage(root)).resolves.toMatchObject({
      title: "Songs",
      tracks: [{ position: 1, title: "One" }]
    });
  });

  it("rejects paths that escape the package", async () => {
    const { root, manifest } = await fixture();
    manifest.tracks[0]!.audio.path = "../outside.mp3";
    await writeFile(
      join(root, "playlist-package.json"),
      JSON.stringify(manifest)
    );

    await expect(inspectPlaylistPackage(root)).rejects.toThrow(/unsafe path/i);
  });

  it("rejects duplicate track positions", async () => {
    const { root, manifest } = await fixture();
    manifest.tracks.push({
      ...manifest.tracks[0]!,
      sourceId: "track-2"
    });
    await writeFile(
      join(root, "playlist-package.json"),
      JSON.stringify(manifest)
    );

    await expect(inspectPlaylistPackage(root)).rejects.toThrow(
      /positions must be unique/i
    );
  });
});
