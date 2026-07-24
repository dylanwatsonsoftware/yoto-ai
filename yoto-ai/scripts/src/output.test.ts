import { describe, expect, it } from "vitest";
import { failureEnvelope, redact } from "./output.js";

describe("safe output", () => {
  it("redacts tokens, authorization headers, and emails recursively", () => {
    const result = redact({
      access_token: "secret-access",
      nested: {
        Authorization: "Bearer secret",
        email: "child@example.com",
        safe: "visible"
      }
    });

    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("child@example.com");
    expect(result).toMatchObject({ nested: { safe: "visible" } });
  });

  it("returns a stable error envelope", () => {
    expect(failureEnvelope("AUTH_REQUIRED", "Login required", false)).toEqual({
      ok: false,
      error: {
        code: "AUTH_REQUIRED",
        message: "Login required",
        retryable: false
      }
    });
  });
});

