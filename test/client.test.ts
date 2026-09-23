import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { createPublicApiClient } from "../src/publicapi/client.js";
import type { ManyChatConfig } from "../src/lib/env.js";

const API_KEY = "secret-test-key-0123456789abcdef";

function config(apiKey: string | undefined = API_KEY): ManyChatConfig {
  return { apiKey, apiUrl: "https://api.manychat.com/" };
}

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientFor(
  respond: (call: Recorded) => Response,
  deps: { minIntervalMs?: number; timeoutMs?: number } = {},
) {
  const calls: Recorded[] = [];
  const fetchImpl = (url: string, init: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init.headers ?? {})) {
      headers[key] = String(value);
    }
    const call: Recorded = { url, method: init.method ?? "GET", headers, body: init.body as string | undefined };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  const client = createPublicApiClient(config(), { fetchImpl, minIntervalMs: 0, ...deps });
  return { client, calls };
}

describe("public api client", () => {
  it("sends the bearer token and joins paths without double slashes", async () => {
    const { client, calls } = clientFor(() => jsonResponse({ status: "success", data: { id: 1, name: "Dr. Brighten" } }));
    const page = await client.getInfo();
    expect(page).toEqual({ id: 1, name: "Dr. Brighten" });
    expect(calls[0]?.url).toBe("https://api.manychat.com/fb/page/getInfo");
    expect(calls[0]?.headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
  });

  it("parses the flows inventory including null folder ids", async () => {
    const { client } = clientFor(() =>
      jsonResponse({
        status: "success",
        data: {
          flows: [
            { ns: "ns-a", name: "Welcome", folder_id: 7 },
            { ns: "ns-b", name: "Podcast EP1", folder_id: null },
          ],
          folders: [{ id: 7, name: "Podcast", parent_id: null }],
        },
      }),
    );
    const inventory = await client.getFlows();
    expect(inventory.flows).toEqual([
      { ns: "ns-a", name: "Welcome", folderId: 7 },
      { ns: "ns-b", name: "Podcast EP1", folderId: null },
    ]);
    expect(inventory.folders).toEqual([{ id: 7, name: "Podcast", parentId: null }]);
  });

  it("posts create payloads as JSON", async () => {
    const { client, calls } = clientFor(() =>
      jsonResponse({ status: "success", data: { tag: { id: 5, name: "Clicked" } } }),
    );
    const tag = await client.createTag("Clicked");
    expect(tag).toEqual({ id: 5, name: "Clicked" });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.manychat.com/fb/page/createTag");
    expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ name: "Clicked" });
  });

  it("unwraps createCustomField envelopes", async () => {
    const { client } = clientFor(() =>
      jsonResponse({
        status: "success",
        data: { field: { id: 9, name: "episode", type: "number", description: "" } },
      }),
    );
    const field = await client.createCustomField({ caption: "episode", type: "number" });
    expect(field).toEqual({ id: 9, name: "episode", type: "number", description: null });
  });

  it("maps error envelopes to API_ERROR with the server message", async () => {
    const { client } = clientFor(() =>
      jsonResponse({ status: "error", message: "Invalid parameter: name" }),
    );
    await expect(client.createTag("")).rejects.toMatchObject({
      code: "API_ERROR",
      message: expect.stringContaining("Invalid parameter: name"),
    });
  });

  it("maps 401 to AUTH_ERROR and redacts the key from the body", async () => {
    const { client } = clientFor(() =>
      new Response(`{"detail":"bad key ${API_KEY}"}`, { status: 401 }),
    );
    const error = await client.getInfo().catch((error: unknown) => error as AxiError);
    expect(error).toBeInstanceOf(AxiError);
    expect(error.code).toBe("AUTH_ERROR");
    expect(error.message).not.toContain(API_KEY);
  });

  it("maps 429 to RATE_LIMITED", async () => {
    const { client } = clientFor(() => jsonResponse({ status: "error" }, 429));
    await expect(client.getTags()).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("maps fetch failures to NETWORK_ERROR with the key redacted", async () => {
    const client = createPublicApiClient(config(), {
      fetchImpl: () => Promise.reject(new Error(`connect failed ${API_KEY}`)),
      minIntervalMs: 0,
    });
    const error = await client.getTags().catch((error: unknown) => error as AxiError);
    expect(error).toBeInstanceOf(AxiError);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).toContain("***");
  });

  it("times out hanging requests as TIMEOUT", async () => {
    const client = createPublicApiClient(config(), {
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const aborted = new Error("The operation was aborted");
            aborted.name = "AbortError";
            reject(aborted);
          });
        }),
      minIntervalMs: 0,
      timeoutMs: 40,
    });
    await expect(client.getInfo()).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("spaces sequential requests under the write rate limit", async () => {
    const { client } = clientFor(() => jsonResponse({ status: "success", data: [] }), {
      minIntervalMs: 50,
    });
    const started = Date.now();
    await client.getTags();
    await client.getTags();
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });
});
