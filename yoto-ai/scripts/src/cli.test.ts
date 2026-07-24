import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyError,
  loadLocalEnvironmentFile,
  parseCliArguments,
  renderHuman,
  requiresClientId,
  writePrivateFile
} from "./cli-support.js";
import { UnsupportedOperationError, UsageError } from "./commands.js";

describe("CLI support", () => {
  it("renders readable device output without secrets", () => {
    expect(
      renderHuman({
        devices: [{ id: "player-1", name: "Bedroom", status: "online", type: "mini" }]
      })
    ).toContain("Bedroom");
  });

  it("maps usage and unsupported operations to stable codes", () => {
    expect(classifyError(new UsageError("bad input"))).toMatchObject({
      code: "VALIDATION_ERROR",
      exitCode: 2
    });
    expect(classifyError(new UnsupportedOperationError("no writes"))).toMatchObject({
      code: "UNSUPPORTED_OPERATION",
      exitCode: 2
    });
  });

  it("allows offline playlist validation without a Yoto client ID", () => {
    expect(requiresClientId(["playlist", "draft", "--input", "draft.json"])).toBe(false);
    expect(
      requiresClientId(["playlist", "preview-create", "--input", "/tmp/package"])
    ).toBe(true);
    expect(requiresClientId(["devices", "list"])).toBe(true);
    expect(requiresClientId(["auth", "login"])).toBe(true);
  });

  it("preserves the command when --output is absent", () => {
    expect(
      parseCliArguments(["playlist", "inspect-package", "--input", "/tmp/package", "--json"])
    ).toEqual({
      args: ["playlist", "inspect-package", "--input", "/tmp/package"],
      json: true,
      outputPath: undefined
    });
  });

  it("loads an optional local .env file without requiring shell expansion", () => {
    const loaded: string[] = [];

    expect(
      loadLocalEnvironmentFile({
        exists: (path) => path === ".env",
        load: (path) => loaded.push(path)
      })
    ).toBe(true);
    expect(loaded).toEqual([".env"]);
  });

  it("locks confirmation files to the current user even when replacing one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yoto-confirmation-"));
    const path = join(directory, "token");
    await writeFile(path, "old");
    await chmod(path, 0o644);

    await writePrivateFile(path, "new");

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toBe("new");
  });
});
