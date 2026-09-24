import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const moduleUrl = new URL("./numbered-icons.ts", import.meta.url);

describe("numbered track icons", () => {
  it("draws a four-pixel bitmap number in the bottom-right corner", async () => {
    const numberedIcons = existsSync(fileURLToPath(moduleUrl))
      ? await import(moduleUrl.href)
      : undefined;

    expect(numberedIcons?.numberedIcon).toBeTypeOf("function");
    if (!numberedIcons) return;

    const base = Buffer.alloc(16 * 16 * 4, 0);
    for (let pixel = 0; pixel < 16 * 16; pixel += 1) {
      base[pixel * 4 + 3] = 255;
    }
    const rendered = numberedIcons.numberedIcon(base, 20);
    const creamPixels: Array<[number, number]> = [];
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const offset = (y * 16 + x) * 4;
        if (
          rendered[offset] === 255 &&
          rendered[offset + 1] === 247 &&
          rendered[offset + 2] === 191
        ) {
          creamPixels.push([x, y]);
        }
      }
    }

    expect(creamPixels.length).toBeGreaterThan(0);
    expect(Math.min(...creamPixels.map(([, y]) => y))).toBe(11);
    expect(Math.max(...creamPixels.map(([, y]) => y))).toBe(14);
    expect(Math.min(...creamPixels.map(([x]) => x))).toBeGreaterThanOrEqual(8);
    expect(Math.max(...creamPixels.map(([x]) => x))).toBe(14);
  });

  it("updates a package with distinct RGBA icons and a contact sheet", async () => {
    const numberedIcons = existsSync(fileURLToPath(moduleUrl))
      ? await import(moduleUrl.href)
      : undefined;
    const render = (numberedIcons as Record<string, unknown> | undefined)
      ?.renderNumberedTrackIcons;

    expect(render).toBeTypeOf("function");
    if (typeof render !== "function") return;

    const root = await mkdtemp(join(tmpdir(), "numbered-icons-"));
    const packageDirectory = join(root, "package");
    const sourcePath = join(root, "source.png");
    const previewPath = join(root, "preview.png");
    await mkdir(packageDirectory);
    await sharp({
      create: { width: 16, height: 16, channels: 4, background: "#3154a4" }
    }).png().toFile(sourcePath);
    await writeFile(join(packageDirectory, "playlist-package.json"), JSON.stringify({
      schemaVersion: 1,
      title: "Stories",
      tracks: [
        { position: 1, title: "One" },
        { position: 2, title: "Two" }
      ]
    }));

    await (render as (options: Record<string, unknown>) => Promise<unknown>)({
      sourcePath,
      packageDirectory,
      previewPath,
      columns: 2,
      tileSize: 64
    });

    const manifest = JSON.parse(
      await readFile(join(packageDirectory, "playlist-package.json"), "utf8")
    ) as { tracks: Array<{ icon: { path: string; sha256: string } }> };
    expect(manifest.tracks.map((track) => track.icon.path)).toEqual([
      "icons/01.png",
      "icons/02.png"
    ]);
    expect(new Set(manifest.tracks.map((track) => track.icon.sha256))).toHaveLength(2);
    await expect(sharp(join(packageDirectory, "icons/01.png")).metadata())
      .resolves.toMatchObject({ width: 16, height: 16, channels: 4 });
    await expect(sharp(previewPath).metadata())
      .resolves.toMatchObject({ width: 128, height: 64 });
  });

  it("parses reusable renderer command-line options", async () => {
    const numberedIcons = existsSync(fileURLToPath(moduleUrl))
      ? await import(moduleUrl.href)
      : undefined;
    const parse = (numberedIcons as Record<string, unknown> | undefined)
      ?.parseNumberedIconArguments;

    expect(parse).toBeTypeOf("function");
    if (typeof parse !== "function") return;

    expect((parse as (args: string[]) => unknown)([
      "--source", "/tmp/source.png",
      "--package", "/tmp/package",
      "--preview", "/tmp/preview.png",
      "--columns", "8",
      "--tile-size", "64"
    ])).toEqual({
      sourcePath: "/tmp/source.png",
      packageDirectory: "/tmp/package",
      previewPath: "/tmp/preview.png",
      columns: 8,
      tileSize: 64
    });
  });
});
