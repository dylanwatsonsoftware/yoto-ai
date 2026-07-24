import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import sharp from "sharp";
import { discoverPlaylistLayout } from "./layout.js";

const MAX_ARCHIVE_FILES = 10_000;
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 ** 3;

export function validateArchiveEntries(
  entries: string[],
  fileCount: number,
  uncompressedBytes: number
): void {
  if (fileCount > MAX_ARCHIVE_FILES) {
    throw new Error(`Archive has too many files (${fileCount})`);
  }
  if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new Error(`Archive is too large when decompressed`);
  }
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    if (
      normalized.startsWith("/") ||
      /^[a-z]:\//i.test(normalized) ||
      normalized.split("/").includes("..")
    ) {
      throw new Error(`Unsafe archive entry: ${entry}`);
    }
  }
}

async function walk(root: string, directory = root): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walk(root, absolute)));
    } else if (entry.isFile()) {
      result.push(absolute.slice(root.length + 1).split(sep).join("/"));
    }
  }
  return result;
}

async function checksum(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function neutralCoverSvg(title: string): Buffer {
  const safe = title
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return Buffer.from(`<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">
    <rect width="600" height="600" fill="#5b45d6"/>
    <text x="300" y="300" text-anchor="middle" dominant-baseline="middle"
      font-family="sans-serif" font-weight="700" font-size="44" fill="white">${safe}</text>
  </svg>`);
}

export interface PlaylistPackageManifest {
  schemaVersion: 1;
  title: string;
  source: {
    type: "drive";
    id: string;
    url: string;
    description: string;
    permission: string;
  };
  cover: { path: string; sha256: string };
  tracks: Array<{
    position: number;
    sourceId: string;
    title: string;
    artist: string;
    audio: {
      path: string;
      sha256: string;
      duration: number;
      format: string;
    };
    icon: { path: string; sha256: string };
  }>;
}

export async function buildPlaylistPackage(options: {
  sourceDirectory: string;
  outputDirectory: string;
  title: string;
  sourceId: string;
  sourceUrl: string;
  permission: string;
  durationFor?: (audioPath: string) => Promise<number>;
}): Promise<PlaylistPackageManifest> {
  const paths = await walk(options.sourceDirectory);
  const layout = discoverPlaylistLayout(paths);
  if (layout.tracks.length === 0) {
    throw new Error("Playlist package contains no supported audio files");
  }
  await mkdir(join(options.outputDirectory, "audio"), { recursive: true });
  await mkdir(join(options.outputDirectory, "icons"), { recursive: true });

  const coverPath = join(options.outputDirectory, "cover.png");
  if (layout.cover) {
    await sharp(resolve(options.sourceDirectory, layout.cover))
      .png()
      .toFile(coverPath);
  } else {
    await sharp(neutralCoverSvg(options.title)).png().toFile(coverPath);
  }

  const tracks: PlaylistPackageManifest["tracks"] = [];
  for (const track of layout.tracks) {
    const position = String(track.position).padStart(2, "0");
    const sourceAudio = resolve(options.sourceDirectory, track.audio);
    const audioExtension = extname(track.audio).toLowerCase();
    const audioRelative = `audio/${position}${audioExtension}`;
    const outputAudio = join(options.outputDirectory, audioRelative);
    await copyFile(sourceAudio, outputAudio);

    const iconRelative = `icons/${position}.png`;
    const outputIcon = join(options.outputDirectory, iconRelative);
    await sharp(
      track.icon
        ? resolve(options.sourceDirectory, track.icon)
        : coverPath
    )
      .resize(16, 16, { fit: "cover", position: "centre" })
      .ensureAlpha()
      .png({ palette: false })
      .toFile(outputIcon);

    tracks.push({
      position: track.position,
      sourceId: `${options.sourceId}:${track.position}`,
      title: track.title,
      artist: "",
      audio: {
        path: audioRelative,
        sha256: await checksum(outputAudio),
        duration: options.durationFor
          ? await options.durationFor(sourceAudio)
          : 0,
        format: audioExtension.slice(1)
      },
      icon: {
        path: iconRelative,
        sha256: await checksum(outputIcon)
      }
    });
  }

  const manifest: PlaylistPackageManifest = {
    schemaVersion: 1,
    title: options.title,
    source: {
      type: "drive",
      id: options.sourceId,
      url: options.sourceUrl,
      description: "Yoto MYO Idea Exchange Google Drive",
      permission: options.permission
    },
    cover: { path: "cover.png", sha256: await checksum(coverPath) },
    tracks
  };
  await writeFile(
    join(options.outputDirectory, "playlist-package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 }
  );
  return manifest;
}
