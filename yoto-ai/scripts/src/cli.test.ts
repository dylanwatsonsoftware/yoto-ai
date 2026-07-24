import { describe, expect, it } from "vitest";
import {
  classifyError,
  parseCliArguments,
  renderHuman,
  requiresClientId
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
});
