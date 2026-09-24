const DIGITS: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "111"],
  "1": ["010", "110", "010", "111"],
  "2": ["110", "001", "010", "111"],
  "3": ["110", "001", "011", "110"],
  "4": ["101", "101", "111", "001"],
  "5": ["111", "100", "011", "110"],
  "6": ["011", "100", "111", "111"],
  "7": ["111", "001", "010", "010"],
  "8": ["111", "101", "111", "111"],
  "9": ["111", "111", "001", "110"]
};

const WIDTH = 16;
const HEIGHT = 16;
const CHANNELS = 4;

function setPixel(data: Buffer, x: number, y: number, color: readonly number[]): void {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const offset = (y * WIDTH + x) * CHANNELS;
  data[offset] = color[0]!;
  data[offset + 1] = color[1]!;
  data[offset + 2] = color[2]!;
  data[offset + 3] = color[3]!;
}

export function numberedIcon(base: Buffer, number: number): Buffer {
  if (base.length !== WIDTH * HEIGHT * CHANNELS) {
    throw new Error("Base icon must be raw 16x16 RGBA data");
  }
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("Track number must be a positive integer");
  }

  const data = Buffer.from(base);
  const text = String(number);
  const width = text.length * 3 + (text.length - 1);
  if (width > WIDTH - 2) {
    throw new Error(`Track number ${number} does not fit in a 16x16 icon`);
  }
  const startX = WIDTH - width - 1;
  const startY = 11;

  for (let y = startY - 1; y <= startY + 4; y += 1) {
    for (let x = startX - 1; x <= startX + width; x += 1) {
      setPixel(data, x, y, [4, 10, 38, 255]);
    }
  }

  for (let digitIndex = 0; digitIndex < text.length; digitIndex += 1) {
    const digit = text[digitIndex];
    const glyph = digit ? DIGITS[digit] : undefined;
    if (!glyph) throw new Error(`Unsupported digit in track number ${number}`);
    const offsetX = startX + digitIndex * 4;
    for (let y = 0; y < glyph.length; y += 1) {
      for (let x = 0; x < glyph[y]!.length; x += 1) {
        if (glyph[y]![x] === "1") {
          setPixel(data, offsetX + x, startY + y, [255, 247, 191, 255]);
        }
      }
    }
  }

  return data;
}

interface NumberedTrack {
  position: number;
  icon?: { path: string; sha256: string };
  [key: string]: unknown;
}

interface NumberedManifest {
  tracks: NumberedTrack[];
  [key: string]: unknown;
}

export interface RenderNumberedTrackIconsOptions {
  sourcePath: string;
  packageDirectory: string;
  previewPath: string;
  columns?: number;
  tileSize?: number;
}

function optionValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function integerOption(args: string[], name: string, fallback: number): number {
  if (!args.includes(name)) return fallback;
  const value = Number(optionValue(args, name));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function parseNumberedIconArguments(
  args: string[]
): Required<RenderNumberedTrackIconsOptions> {
  return {
    sourcePath: optionValue(args, "--source"),
    packageDirectory: optionValue(args, "--package"),
    previewPath: optionValue(args, "--preview"),
    columns: integerOption(args, "--columns", 10),
    tileSize: integerOption(args, "--tile-size", 128)
  };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function renderNumberedTrackIcons(
  options: RenderNumberedTrackIconsOptions
): Promise<{ iconCount: number; previewPath: string; positions: number[] }> {
  const columns = options.columns ?? 10;
  const tileSize = options.tileSize ?? 128;
  if (!Number.isSafeInteger(columns) || columns < 1) {
    throw new Error("Contact-sheet columns must be a positive integer");
  }
  if (!Number.isSafeInteger(tileSize) || tileSize < 1) {
    throw new Error("Contact-sheet tile size must be a positive integer");
  }

  const manifestPath = join(options.packageDirectory, "playlist-package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as NumberedManifest;
  if (!Array.isArray(manifest.tracks) || manifest.tracks.length === 0) {
    throw new Error("Playlist package must contain at least one track");
  }
  manifest.tracks.forEach((track, index) => {
    if (track.position !== index + 1) {
      throw new Error(`Track positions must be sequential at position ${index + 1}`);
    }
  });

  const { data: base } = await sharp(options.sourcePath)
    .resize(WIDTH, HEIGHT, { fit: "fill", kernel: "nearest" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const iconsDirectory = join(options.packageDirectory, "icons");
  await mkdir(iconsDirectory, { recursive: true });
  const previewTiles: Array<{ input: Buffer; left: number; top: number }> = [];

  for (const track of manifest.tracks) {
    const filename = `${String(track.position).padStart(2, "0")}.png`;
    const iconPath = join(iconsDirectory, filename);
    const icon = numberedIcon(base, track.position);
    const png = await sharp(icon, {
      raw: { width: WIDTH, height: HEIGHT, channels: CHANNELS }
    }).png().toBuffer();
    await writeFile(iconPath, png);
    track.icon = { path: `icons/${filename}`, sha256: sha256(png) };
    previewTiles.push({
      input: await sharp(png)
        .resize(tileSize, tileSize, { kernel: "nearest" })
        .png()
        .toBuffer(),
      left: ((track.position - 1) % columns) * tileSize,
      top: Math.floor((track.position - 1) / columns) * tileSize
    });
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const rows = Math.ceil(manifest.tracks.length / columns);
  await sharp({
    create: {
      width: columns * tileSize,
      height: rows * tileSize,
      channels: 4,
      background: "#091536"
    }
  }).composite(previewTiles).png().toFile(options.previewPath);

  return {
    iconCount: manifest.tracks.length,
    previewPath: options.previewPath,
    positions: manifest.tracks.map((track) => track.position)
  };
}
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
