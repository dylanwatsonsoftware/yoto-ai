#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import {
  buildBatchPreview,
  buildSpotdlDownloadArgs,
  createConfirmationToken,
  verifyConfirmationToken,
  type BatchPreview,
  type ResolvedTrack
} from "./spotdl.js";

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  const result = index >= 0 ? args[index + 1] : undefined;
  if (!result || result.startsWith("--")) throw new Error(`${name} is required`);
  return result;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function run(command: string, args: string[], configDirectory?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: configDirectory
        ? { ...process.env, XDG_CONFIG_HOME: configDirectory }
        : process.env
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))
    );
  });
}

function duration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", path
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const seconds = Number(stdout.trim());
      if (code === 0 && Number.isFinite(seconds) && seconds >= 0) resolve(seconds);
      else reject(new Error(stderr.trim() || "ffprobe could not read duration"));
    });
  });
}

function coverSvg(title: string): Buffer {
  const safe = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const hue = parseInt(createHash("sha256").update(title).digest("hex").slice(0, 4), 16) % 360;
  return Buffer.from(`<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="600" fill="hsl(${hue} 55% 42%)"/><text x="300" y="300" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="42" font-weight="700" fill="white">${safe}</text></svg>`);
}

async function packageDownloads(preview: BatchPreview, downloadDir: string, output: string) {
  const files = (await readdir(downloadDir)).filter((file) => file.toLowerCase().endsWith(".mp3")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (files.length !== preview.tracks.length) throw new Error(`Expected ${preview.tracks.length} MP3 files but found ${files.length}`);
  await mkdir(join(output, "audio"), { recursive: true });
  await mkdir(join(output, "icons"), { recursive: true });
  const coverPath = join(output, "cover.png");
  await sharp(coverSvg(preview.title)).png().toFile(coverPath);
  const tracks = [];
  for (let index = 0; index < files.length; index += 1) {
    const source = join(downloadDir, files[index]);
    const audio = `audio/${String(index + 1).padStart(2, "0")}.mp3`;
    const icon = `icons/${String(index + 1).padStart(2, "0")}.png`;
    await copyFile(source, join(output, audio));
    await sharp(coverPath).resize(16, 16, { fit: "cover" }).ensureAlpha().png({ palette: false }).toFile(join(output, icon));
    const track = preview.tracks[index];
    tracks.push({
      position: index + 1,
      sourceId: track.sourceId,
      title: track.title,
      artist: track.artist,
      audio: { path: audio, sha256: await sha256(join(output, audio)), duration: await duration(source), format: "mp3" },
      icon: { path: icon, sha256: await sha256(join(output, icon)) }
    });
  }
  const manifest = {
    schemaVersion: 1,
    title: preview.title,
    source: {
      type: "spotdl",
      id: createHash("sha256").update(preview.tracks.map((track) => track.sourceId).join("\n")).digest("hex"),
      description: "Audio matched and downloaded by spotDL from YouTube/YouTube Music",
      permission: preview.permission
    },
    cover: { path: "cover.png", sha256: await sha256(coverPath) },
    tracks
  };
  await writeFile(join(output, "playlist-package.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

async function main(): Promise<unknown> {
  const args = process.argv.slice(2);
  const secret = process.env.SPOTDL_CONFIRMATION_SECRET;
  if (args[0] === "resolve") {
    const isolatedConfig = await mkdtemp(join(tmpdir(), "spotdl-config-"));
    const saveFile = option(args, "--save-file");
    await run("spotdl", [
      "save",
      option(args, "--url"),
      "--save-file",
      saveFile,
      "--preload"
    ], isolatedConfig);
    const saved = JSON.parse(await readFile(saveFile, "utf8")) as Array<Record<string, unknown>>;
    const tracks: ResolvedTrack[] = saved.map((song) => {
      const sourceId = String(song.song_id ?? song.id ?? "");
      const sourceUrl = String(song.url ?? song.spotify_url ?? "");
      const matchedUrl = String(song.download_url ?? song.youtube_url ?? "");
      const artists = Array.isArray(song.artists) ? song.artists.join(", ") : String(song.artist ?? "");
      if (!sourceId || !sourceUrl || !matchedUrl) {
        throw new Error(`spotDL did not resolve an unambiguous match for ${String(song.name ?? song.title ?? "a track")}`);
      }
      return {
        sourceId,
        sourceUrl,
        matchedUrl,
        title: String(song.name ?? song.title ?? ""),
        artist: artists
      };
    });
    const resolved = { title: option(args, "--title"), tracks };
    await writeFile(option(args, "--output"), `${JSON.stringify(resolved, null, 2)}\n`, { mode: 0o600 });
    return resolved;
  }
  if (args[0] === "preview") {
    const input = JSON.parse(await readFile(option(args, "--input"), "utf8")) as { title: string; tracks: ResolvedTrack[] };
    const preview = buildBatchPreview({
      title: input.title,
      tracks: input.tracks,
      destination: option(args, "--destination"),
      permission: option(args, "--permission")
    });
    const output = option(args, "--output");
    await writeFile(output, `${JSON.stringify(preview, null, 2)}\n`, { mode: 0o600 });
    return preview;
  }
  if (args[0] === "confirm") {
    if (!secret) throw new Error("SPOTDL_CONFIRMATION_SECRET is required");
    const preview = JSON.parse(await readFile(option(args, "--preview"), "utf8")) as BatchPreview;
    return { confirmationToken: createConfirmationToken(preview, secret) };
  }
  if (args[0] === "download") {
    if (!secret) throw new Error("SPOTDL_CONFIRMATION_SECRET is required");
    const preview = JSON.parse(await readFile(option(args, "--preview"), "utf8")) as BatchPreview;
    verifyConfirmationToken(option(args, "--confirmation-token"), preview, secret);
    const downloadDir = option(args, "--download-dir");
    await mkdir(downloadDir, { recursive: true });
    const isolatedConfig = await mkdtemp(join(tmpdir(), "spotdl-config-"));
    await run("spotdl", buildSpotdlDownloadArgs(preview, downloadDir), isolatedConfig);
    return packageDownloads(preview, downloadDir, option(args, "--output"));
  }
  throw new Error("Unknown command");
}

main().then((result) => process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`)).catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
  process.exitCode = 1;
});
