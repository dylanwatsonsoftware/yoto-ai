import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { extname } from "node:path";
import { validateArchiveEntries } from "./package-builder.js";

function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} exited ${code}`))
    );
  });
}

export async function extractArchive(archive: string, output: string): Promise<void> {
  await mkdir(output, { recursive: true, mode: 0o700 });
  const extension = extname(archive).toLowerCase();
  if (extension === ".zip") {
    const listing = await capture("unzip", ["-l", archive]);
    const rows = listing
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match));
    validateArchiveEntries(
      rows.map((row) => row[2]),
      rows.length,
      rows.reduce((sum, row) => sum + Number(row[1]), 0)
    );
    await capture("unzip", ["-q", archive, "-d", output]);
    return;
  }
  if (extension === ".7z") {
    let listing: string;
    let binary = "7zz";
    try {
      listing = await capture(binary, ["l", "-slt", archive]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      binary = "7z";
      listing = await capture(binary, ["l", "-slt", archive]);
    }
    const paths = [...listing.matchAll(/^Path = (.+)$/gm)].map((match) => match[1]).slice(1);
    const sizes = [...listing.matchAll(/^Size = (\d+)$/gm)].map((match) => Number(match[1]));
    validateArchiveEntries(paths, paths.length, sizes.reduce((sum, size) => sum + size, 0));
    await capture(binary, ["x", "-y", `-o${output}`, archive]);
    return;
  }
  throw new Error(`Unsupported archive type: ${extension}`);
}
