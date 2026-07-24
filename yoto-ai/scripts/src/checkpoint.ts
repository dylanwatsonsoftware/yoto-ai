import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { UploadCheckpoint } from "./publishing.js";

export class JsonUploadCheckpoint implements UploadCheckpoint {
  constructor(private readonly path: string) {}

  private async read(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async get(checksum: string): Promise<unknown | undefined> {
    return (await this.read())[checksum];
  }

  async put(checksum: string, result: unknown): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const state = await this.read();
    state[checksum] = result;
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }
}
