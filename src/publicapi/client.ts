import { AxiError } from "axi-sdk-js";
import { redact, type ManyChatConfig } from "../lib/env.js";

/**
 * Minimal client for the ManyChat public API (api.manychat.com, documented
 * OpenAPI 3.0 at /swagger). This is the ONLY module in this repository that
 * talks to api.manychat.com - commands receive an injected client and tests
 * pass a fake.
 *
 * Envelope: every endpoint returns `{status: "success"|"error", data: ...}`.
 * Rate limits: reads 100 rps, writes and getFlows 10 rps - enforced with
 * client-side minimum spacing between requests, not retries.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface PageInfo {
  id: number;
  name: string;
}

export interface Tag {
  id: number;
  name: string;
}

export interface FlowRef {
  /** Automation namespace - the unique automation identifier. */
  ns: string;
  name: string;
  folderId: number | null;
}

export interface Folder {
  id: number;
  name: string;
  parentId: number | null;
}

export interface FlowsInventory {
  flows: FlowRef[];
  folders: Folder[];
}

export interface FieldDef {
  id: number;
  name: string;
  type: string;
  description: string | null;
}

export const FIELD_TYPES = ["text", "number", "date", "datetime", "boolean"] as const;
export type FieldTypeName = (typeof FIELD_TYPES)[number];

export interface CreateFieldInput {
  caption: string;
  type: FieldTypeName;
  description?: string;
}

export interface PublicApiClient {
  getInfo(): Promise<PageInfo>;
  getTags(): Promise<Tag[]>;
  createTag(name: string): Promise<Tag>;
  getFlows(): Promise<FlowsInventory>;
  getCustomFields(): Promise<FieldDef[]>;
  createCustomField(input: CreateFieldInput): Promise<FieldDef>;
  getBotFields(): Promise<FieldDef[]>;
  createBotField(input: CreateFieldInput): Promise<FieldDef>;
}

export interface PublicApiDeps {
  fetchImpl?: FetchLike;
  /** Minimum spacing between requests in ms. Default 110 keeps bursts under the 10 rps write limit. */
  minIntervalMs?: number;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Envelope {
  status?: unknown;
  data?: unknown;
  message?: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MIN_INTERVAL_MS = 110;

export function createPublicApiClient(
  config: ManyChatConfig,
  deps: PublicApiDeps = {},
): PublicApiClient {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minIntervalMs = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let queue: Promise<void> = Promise.resolve();
  let lastRequestAt = 0;

  /** Serialize requests and enforce minimum spacing (rate-limit insurance). */
  function schedule<T>(op: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const wait = lastRequestAt + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      try {
        return await op();
      } finally {
        lastRequestAt = now();
      }
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const baseUrl = config.apiUrl.replace(/\/+$/, "");

  async function request(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const url = `${baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await schedule(() =>
        fetchImpl(url, {
          method,
          headers: {
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        }),
      );
    } catch (error) {
      clearTimeout(timer);
      if (isAbort(error)) {
        throw new AxiError(
          `ManyChat API request timed out after ${timeoutMs}ms (${method} ${path})`,
          "TIMEOUT",
          ["Retry the command; ManyChat reads are usually fast"],
        );
      }
      throw new AxiError(
        `Network error reaching ManyChat API at ${config.apiUrl}: ${redact(String(error), config.apiKey)}`,
        "NETWORK_ERROR",
        ["Check your connection and MANYCHAT_API_URL"],
      );
    }
    clearTimeout(timer);

    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      throw httpStatusError(response.status, bodyText, method, path, config);
    }

    let envelope: Envelope;
    try {
      envelope = JSON.parse(bodyText) as Envelope;
    } catch {
      throw new AxiError(
        `ManyChat API returned non-JSON response (${method} ${path}): ${redact(snippetOf(bodyText, 200), config.apiKey)}`,
        "API_ERROR",
        ["Retry the command; if it persists, the API shape may have changed"],
      );
    }
    if (envelope.status === "error") {
      const message =
        typeof envelope.message === "string" && envelope.message.length > 0
          ? redact(envelope.message, config.apiKey)
          : "unknown error";
      throw new AxiError(
        `ManyChat API error (${method} ${path}): ${message}`,
        "API_ERROR",
        ["Run `manychat-axi auth status` to check the API key"],
      );
    }
    return envelope.data;
  }

  return {
    async getInfo() {
      const data = await request("GET", "/fb/page/getInfo");
      return parsePage(data);
    },
    async getTags() {
      const data = await request("GET", "/fb/page/getTags");
      return parseArray(data, "getTags").map(parseTag);
    },
    async createTag(name: string) {
      const data = await request("POST", "/fb/page/createTag", { name });
      const record = parseRecord(data, "createTag");
      const tag = record["tag"] ?? record["data"] ?? record;
      return parseTag(tag);
    },
    async getFlows() {
      const data = await request("GET", "/fb/page/getFlows");
      const record = parseRecord(data, "getFlows");
      return {
        flows: parseArray(record["flows"], "getFlows.flows").map(parseFlow),
        folders: parseArray(record["folders"], "getFlows.folders").map(parseFolder),
      };
    },
    async getCustomFields() {
      const data = await request("GET", "/fb/page/getCustomFields");
      return parseArray(data, "getCustomFields").map(parseField);
    },
    async createCustomField(input: CreateFieldInput) {
      const data = await request("POST", "/fb/page/createCustomField", { ...input });
      const record = parseRecord(data, "createCustomField");
      return parseField(record["field"] ?? record);
    },
    async getBotFields() {
      const data = await request("GET", "/fb/page/getBotFields");
      return parseArray(data, "getBotFields").map(parseField);
    },
    async createBotField(input: CreateFieldInput) {
      const data = await request("POST", "/fb/page/createBotField", { ...input });
      const record = parseRecord(data, "createBotField");
      return parseField(record["field"] ?? record);
    },
  };
}

function httpStatusError(
  status: number,
  bodyText: string,
  method: "GET" | "POST",
  path: string,
  config: ManyChatConfig,
): AxiError {
  const detail = snippetOf(bodyText, 200);
  const context = `${method} ${path}${detail.length > 0 ? `: ${detail}` : ""}`;
  if (status === 401 || status === 403) {
    return new AxiError(
      `ManyChat API rejected the API key (${redact(context, config.apiKey)})`,
      "AUTH_ERROR",
      [
        "Generate a fresh key in ManyChat Settings -> API and export MANYCHAT_API_KEY",
        "Run `manychat-axi auth status` to verify",
      ],
    );
  }
  if (status === 429) {
    return new AxiError(
      `ManyChat API rate limit hit (${method} ${path})`,
      "RATE_LIMITED",
      ["Wait a few seconds and rerun; the CLI already spaces requests under the documented limits"],
    );
  }
  return new AxiError(
    `ManyChat API HTTP ${status} (${redact(context, config.apiKey)})`,
    "API_ERROR",
    ["Run `manychat-axi auth status` to check the API key"],
  );
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || (error as Error & { code?: unknown }).code === "ABORT_ERR")
  );
}

function snippetOf(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return `${Array.from(flat).slice(0, limit).join("")}\u2026`;
}

function parseRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw malformed(context);
}

function parseArray(value: unknown, context: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw malformed(context);
}

function malformed(context: string): AxiError {
  return new AxiError(
    `ManyChat returned malformed data (${context})`,
    "API_ERROR",
    ["Retry; if it persists, the API shape may have changed"],
  );
}

function asString(value: unknown, context: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  throw malformed(context);
}

function asNumber(value: unknown, context: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  throw malformed(context);
}

function asNullableNumber(value: unknown, context: string): number | null {
  if (value === undefined || value === null) return null;
  return asNumber(value, context);
}

function parsePage(data: unknown): PageInfo {
  const record = parseRecord(data, "getInfo");
  const inner = parseRecord(record["data"] ?? record, "getInfo.data");
  return { id: asNumber(inner["id"], "getInfo.id"), name: asString(inner["name"], "getInfo.name") };
}

function parseTag(data: unknown): Tag {
  const record = parseRecord(data, "tag");
  return { id: asNumber(record["id"], "tag.id"), name: asString(record["name"], "tag.name") };
}

function parseFlow(data: unknown): FlowRef {
  const record = parseRecord(data, "flow");
  return {
    ns: asString(record["ns"], "flow.ns"),
    name: asString(record["name"], "flow.name"),
    folderId: asNullableNumber(record["folder_id"], "flow.folder_id"),
  };
}

function parseFolder(data: unknown): Folder {
  const record = parseRecord(data, "folder");
  return {
    id: asNumber(record["id"], "folder.id"),
    name: asString(record["name"], "folder.name"),
    parentId: asNullableNumber(record["parent_id"], "folder.parent_id"),
  };
}

function parseField(data: unknown): FieldDef {
  const record = parseRecord(data, "field");
  return {
    id: asNumber(record["id"], "field.id"),
    name: asString(record["name"] ?? record["caption"], "field.name"),
    type: asString(record["type"], "field.type"),
    description:
      typeof record["description"] === "string" && record["description"].length > 0
        ? record["description"]
        : null,
  };
}
