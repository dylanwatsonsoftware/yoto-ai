import { describe, expect, it } from "vitest";
import { classifyError, renderHuman, requiresClientId } from "./cli-support.js";
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
    expect(requiresClientId(["devices", "list"])).toBe(true);
    expect(requiresClientId(["auth", "login"])).toBe(true);
  });
});
