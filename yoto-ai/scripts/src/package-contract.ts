import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const relativePathSchema = z.string().min(1);

const fileSchema = z.object({
  path: relativePathSchema,
  sha256: checksumSchema
});

const audioSchema = fileSchema.extend({
  duration: z.number().nonnegative(),
  format: z.enum(["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"])
});

export const playlistPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().min(1).max(140),
    source: z.object({
      type: z.enum(["spotdl", "drive", "local"]),
      id: z.string().min(1),
      url: z.string().url().optional(),
      description: z.string().min(1),
      permission: z.string().min(1)
    }),
    cover: fileSchema,
    tracks: z
      .array(
        z.object({
          position: z.number().int().positive(),
          sourceId: z.string().min(1),
          title: z.string().min(1),
          artist: z.string(),
          audio: audioSchema,
          icon: fileSchema.optional()
        })
      )
      .min(1)
  })
  .superRefine((value, context) => {
    const positions = new Set<number>();
    for (const [index, track] of value.tracks.entries()) {
      if (positions.has(track.position)) {
        context.addIssue({
          code: "custom",
          path: ["tracks", index, "position"],
          message: "Track positions must be unique"
        });
      }
      positions.add(track.position);
    }
  });

export type PlaylistPackage = z.infer<typeof playlistPackageSchema>;

function assertRelativePath(path: string): void {
  const normalized = relative(".", path);
  if (
    isAbsolute(path) ||
    normalized === ".." ||
    normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(`Unsafe path in playlist package: ${path}`);
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function verifyFile(
  root: string,
  file: { path: string; sha256: string }
): Promise<void> {
  assertRelativePath(file.path);
  const target = resolve(root, file.path);
  const actualRoot = await realpath(root);
  const actualTarget = await realpath(target);
  if (
    actualTarget !== actualRoot &&
    !actualTarget.startsWith(`${actualRoot}/`)
  ) {
    throw new Error(`Unsafe path in playlist package: ${file.path}`);
  }
  if (!(await stat(actualTarget)).isFile()) {
    throw new Error(`Package path is not a file: ${file.path}`);
  }
  const actualChecksum = await sha256(actualTarget);
  if (actualChecksum !== file.sha256) {
    throw new Error(`Checksum mismatch: ${file.path}`);
  }
}

async function verifyIcon(root: string, path: string): Promise<void> {
  const header = (await readFile(resolve(root, path))).subarray(0, 26);
  const pngSignature = "89504e470d0a1a0a";
  if (
    header.length < 26 ||
    header.subarray(0, 8).toString("hex") !== pngSignature ||
    header.readUInt32BE(16) !== 16 ||
    header.readUInt32BE(20) !== 16 ||
    header[25] !== 6
  ) {
    throw new Error(`Icon must be a 16x16 RGBA PNG: ${path}`);
  }
}

export async function inspectPlaylistPackage(
  directory: string
): Promise<PlaylistPackage> {
  const manifestPath = join(directory, "playlist-package.json");
  const parsed = playlistPackageSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8"))
  );
  await verifyFile(directory, parsed.cover);
  for (const track of parsed.tracks) {
    await verifyFile(directory, track.audio);
    if (track.icon) {
      await verifyFile(directory, track.icon);
      await verifyIcon(directory, track.icon.path);
    }
  }
  return parsed;
}
