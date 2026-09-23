import { AxiError } from "axi-sdk-js";
import { redact, type ManyChatConfig } from "./env.js";

/**
 * Fail fast with an actionable error when a data command runs without an
 * API key, instead of sending an unauthenticated request.
 */
export function requireApiKey(config: ManyChatConfig, commandPath: string): string {
  if (!config.apiKey) {
    throw new AxiError(`${commandPath} requires MANYCHAT_API_KEY`, "VALIDATION_ERROR", [
      "Generate a key in ManyChat Settings -> API and export MANYCHAT_API_KEY",
      "Run `manychat-axi auth status` to check",
    ]);
  }
  return config.apiKey;
}

/** Redacted error message for inline status reporting (home view, auth status). */
export function errorMessage(error: unknown, secret?: string): string {
  const message =
    error instanceof AxiError
      ? `${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  const code = error instanceof AxiError ? ` [${error.code}]` : "";
  return redact(`${message}${code}`.replace(/\s+/g, " "), secret);
}
