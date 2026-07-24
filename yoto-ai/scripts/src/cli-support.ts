import { ZodError } from "zod";
import type { ErrorCode } from "./output.js";
import { UnsupportedOperationError, UsageError } from "./commands.js";

export interface ClassifiedError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  exitCode: number;
}

export function requiresClientId(args: string[]): boolean {
  return !(args[0] === "playlist" && args[1] === "draft");
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
