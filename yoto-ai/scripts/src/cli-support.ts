import { ZodError } from "zod";
import type { ErrorCode } from "./output.js";
import { UnsupportedOperationError, UsageError } from "./commands.js";

export interface ClassifiedError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  exitCode: number;
}

export function parseCliArguments(rawArgs: string[]): {
  args: string[];
  json: boolean;
  outputPath: string | undefined;
} {
  const outputIndex = rawArgs.indexOf("--output");
  const outputPath = outputIndex >= 0 ? rawArgs[outputIndex + 1] : undefined;
  return {
    args: rawArgs.filter(
      (argument, index) =>
        argument !== "--json" &&
        (outputIndex < 0 || (index !== outputIndex && index !== outputIndex + 1))
    ),
    json: rawArgs.includes("--json"),
    outputPath
  };
}

export function requiresClientId(args: string[]): boolean {
  return !(
    args[0] === "playlist" &&
    ["draft", "inspect-package", "confirm"].includes(args[1] ?? "")
  );
}

export function renderHuman(value: unknown): string {
  if (value && typeof value === "object" && "devices" in value) {
    const devices = (value as { devices: Array<Record<string, unknown>> }).devices;
    return devices.length
      ? devices
          .map(
            (device) =>
              `${String(device.name)} (${String(device.id)}): ${String(device.status)}`
          )
          .join("\n")
      : "No Yoto players found.";
  }
  if (value && typeof value === "object" && "cards" in value) {
    const cards = (value as { cards: Array<Record<string, unknown>> }).cards;
    return cards.length
      ? cards.map((card) => `${String(card.title)} (${String(card.cardId)})`).join("\n")
      : "No Yoto cards found.";
  }
  return JSON.stringify(value, null, 2);
}

export function classifyError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (error instanceof UnsupportedOperationError) {
    return { code: "UNSUPPORTED_OPERATION", message, retryable: false, exitCode: 2 };
  }
  if (error instanceof UsageError || error instanceof ZodError || error instanceof SyntaxError) {
    return { code: "VALIDATION_ERROR", message, retryable: false, exitCode: 2 };
  }
  if (/login required/i.test(message)) {
    return { code: "AUTH_REQUIRED", message, retryable: false, exitCode: 3 };
  }
  if (/oauth|token|auth/i.test(message)) {
    return { code: "AUTH_FAILED", message, retryable: false, exitCode: 3 };
  }
  if (/not found/i.test(message)) {
    return { code: "NOT_FOUND", message, retryable: false, exitCode: 4 };
  }
  if (/fetch|network|timeout/i.test(message)) {
    return { code: "NETWORK_ERROR", message, retryable: true, exitCode: 5 };
  }
  return { code: "API_ERROR", message, retryable: false, exitCode: 6 };
}
