import { AxiError } from "axi-sdk-js";

export const DEFAULT_API_URL = "https://api.manychat.com";

export interface ManyChatConfig {
  /** Public API key (ManyChat Settings -> API). Absent means no API access. */
  apiKey?: string;
  /** HTTPS-only public API endpoint. */
  apiUrl: string;
}

/**
 * Validate a user-supplied API URL. Mirrors the firecrawl-axi base-URL
 * policy: HTTPS only, no embedded credentials, query, or fragment - no
 * localhost exception, because the ManyChat public API is a public endpoint.
 */
export function validateApiUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AxiError(
      `MANYCHAT_API_URL is not a valid URL: ${redact(raw)}`,
      "VALIDATION_ERROR",
      ["Set MANYCHAT_API_URL=https://api.manychat.com (default) or another https:// URL"],
    );
  }
  if (parsed.protocol !== "https:") {
    throw new AxiError(
      `MANYCHAT_API_URL must use HTTPS, got protocol ${parsed.protocol}`,
      "VALIDATION_ERROR",
      ["The ManyChat public API is https://api.manychat.com"],
    );
  }
  if (parsed.username || parsed.password) {
    throw new AxiError(
      "MANYCHAT_API_URL must not contain embedded credentials",
      "VALIDATION_ERROR",
      ["Pass the API key via the MANYCHAT_API_KEY environment variable instead"],
    );
  }
  if (parsed.search || parsed.hash) {
    throw new AxiError(
      "MANYCHAT_API_URL must not contain query parameters or fragments",
      "VALIDATION_ERROR",
    );
  }
  return parsed.toString();
}

/** Redact anything that looks like a bearer credential from error text. */
export function redact(text: string, secret?: string): string {
  let out = text.replace(/\bBearer\s+([A-Za-z0-9._~+/=-]{20,})\b/g, "Bearer ***");
  out = out.replace(/\bAuthorization:[^\s]*/gi, "Authorization: ***");
  if (secret && secret.length >= 4) {
    out = out.split(secret).join("***");
  }
  return out;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ManyChatConfig {
  const rawUrl = env["MANYCHAT_API_URL"]?.trim() || DEFAULT_API_URL;
  const apiUrl = validateApiUrl(rawUrl);
  const rawKey = env["MANYCHAT_API_KEY"];
  if (rawKey !== undefined && rawKey.trim().length === 0) {
    throw new AxiError(
      "MANYCHAT_API_KEY is set but empty",
      "VALIDATION_ERROR",
      [
        "Set it to the key from ManyChat Settings -> API - via your shell profile or a .env file in the working directory - or unset it entirely",
      ],
    );
  }
  return { apiKey: rawKey?.trim() || undefined, apiUrl };
}
