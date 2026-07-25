#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { CatalogueIndex, type CatalogueItem } from "./index.js";
import { buildPlaylistPackage } from "./package-builder.js";
import { extractArchive } from "./archive.js";
import { spawn } from "node:child_process";
import { assertUnderIdeaExchangeRoot } from "./layout.js";
import {
  buildPublicCatalogue,
  type DriveSnapshotItem
} from "./cache.js";
import { mergeParentScan, type ParentScan } from "./scan.js";

function value(args: string[], name: string): string {
  const index = args.indexOf(name);
  const result = index >= 0 ? args[index + 1] : undefined;
  if (!result || result.startsWith("--")) throw new Error(`${name} is required`);
  return result;
}

function cacheDatabase(): string {
  const root =
    process.env.XDG_CACHE_HOME ||
    (platform() === "darwin"
      ? join(homedir(), "Library", "Caches")
      : join(homedir(), ".cache"));
  return join(root, "yoto-myo-idea-exchange-google-drive", "index.sqlite");
}

function mediaDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", path
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const seconds = Number(output.trim());
      code === 0 && Number.isFinite(seconds)
        ? resolve(seconds)
        : reject(new Error("ffprobe could not read audio duration"));
    });
  });
}

async function main(): Promise<unknown> {
  const args = process.argv.slice(2).filter((item) => item !== "--json");
  const index = new CatalogueIndex(process.env.YOTO_MYO_INDEX || cacheDatabase());
  await index.initialize();
  if (args[0] === "index" && args[1] === "status") return index.status();
  if (args[0] === "index" && args[1] === "rebuild") {
    await index.rebuild();
    return { rebuilt: true };
  }
  if (args[0] === "index" && (args[1] === "refresh" || args[1] === "ingest")) {
    const payload = JSON.parse(await readFile(value(args, "--input"), "utf8")) as
      | CatalogueItem[]
      | { items: CatalogueItem[]; complete?: boolean; incompleteWindows?: string[] };
    const items = Array.isArray(payload) ? payload : payload.items;
    await index.upsert(items);
    if (!Array.isArray(payload)) {
      await index.setIncompleteWindows(payload.incompleteWindows ?? []);
      if (payload.complete && (payload.incompleteWindows?.length ?? 0) === 0) {
        await index.completeScan(items.map((item) => item.id));
      }
    }
    return { indexed: items.length, mode: args[1] };
  }
  if (args[0] === "search") {
    const query = args.slice(1).filter((item) => !item.startsWith("--")).join(" ");
    return { results: await index.search(query) };
  }
  if (args[0] === "scan" && args[1] === "merge") {
    const scan = JSON.parse(
      await readFile(value(args, "--input"), "utf8")
    ) as ParentScan;
    const items = mergeParentScan(scan);
    await writeFile(value(args, "--output"), `${JSON.stringify(items, null, 2)}\n`);
    return { parentId: scan.parentId, scope: scan.requiredScope, items: items.length };
  }
  if (args[0] === "package" && args[1] === "build") {
    const sourceId = value(args, "--source-id");
    const ancestry = JSON.parse(
      await readFile(value(args, "--ancestry"), "utf8")
    ) as Record<string, string[]>;
    assertUnderIdeaExchangeRoot(sourceId, new Map(Object.entries(ancestry)));
    return buildPlaylistPackage({
      sourceDirectory: value(args, "--input"),
      outputDirectory: value(args, "--output"),
      title: value(args, "--title"),
      sourceId,
      sourceUrl: value(args, "--source-url"),
      permission: value(args, "--permission"),
      durationFor: mediaDuration
    });
  }
  if (args[0] === "archive" && args[1] === "extract") {
    await extractArchive(value(args, "--input"), value(args, "--output"));
    return { extracted: true };
  }
  if (args[0] === "cache" && args[1] === "build") {
    const payload = JSON.parse(
      await readFile(value(args, "--input"), "utf8")
    ) as
      | DriveSnapshotItem[]
      | {
          items: DriveSnapshotItem[];
          complete?: boolean;
          incompleteWindows?: string[];
        };
    const items = Array.isArray(payload) ? payload : payload.items;
    const complete =
      Array.isArray(payload) ||
      (payload.complete === true &&
        (payload.incompleteWindows?.length ?? 0) === 0);
    return buildPublicCatalogue({
      items,
      coversDirectory: value(args, "--covers"),
      outputDirectory: value(args, "--output"),
      scanComplete: complete
    });
  }
  throw new Error("Unknown command");
}

main()
  .then((result) => process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`))
  .catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  });
