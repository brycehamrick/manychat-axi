import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { appApiForTest, type FetchPageLike } from "../src/browser/appfetch.js";

interface Served {
  status: number;
  body: string;
}

function fakePage(served: (url: string, method: string, body: string | null) => Served): {
  page: FetchPageLike;
  requests: Array<{ url: string; method: string; body: string | null }>;
} {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const page: FetchPageLike = {
    url: () => "https://app.manychat.com/fb1071254/dashboard",
    goto: async () => undefined,
    evaluate: async <T, A>(_fn: (arg: A) => Promise<T> | T, arg?: A): Promise<T> => {
      if (arg === undefined) {
        // CSRF token extraction call.
        return "test-csrf-token" as T;
      }
      const req = arg as unknown as { url: string; method: string; body: string | null };
      requests.push({ url: req.url, method: req.method, body: req.body });
      const result = served(req.url, req.method, req.body);
      return { status: result.status, text: result.body } as T;
    },
  };
  return { page, requests };
}

describe("app api transport", () => {
  it("builds account-scoped URLs and parses JSON responses", async () => {
    const { page, requests } = fakePage(() => ({
      status: 200,
      body: JSON.stringify({ flow: { ns: "x", contents: [] } }),
    }));
    const api = appApiForTest(page, "fb1071254", "client-1");
    const doc = await api.getFlowData("content123");
    expect(doc).toEqual({ flow: { ns: "x", contents: [] } });
    expect(requests[0]?.url).toBe(
      "https://app.manychat.com/fb1071254/flow/getFlowData?ns=content123",
    );
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.body).toBeNull();
  });

  it("sends mutation bodies as JSON with the session client id", async () => {
    const { page, requests } = fakePage(() => ({ status: 200, body: "{}" }));
    const api = appApiForTest(page, "fb1071254", "client-1");
    await api.rename("/23495021/27592482/contentX", "EP167 to DM FB");
    expect(requests[0]?.method).toBe("POST");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      path: "/23495021/27592482/contentX",
      title: "EP167 to DM FB",
      client_id: "client-1",
    });
  });

  it("maps 401 to AUTH_ERROR with login guidance", async () => {
    const { page } = fakePage(() => ({ status: 401, body: "unauthorized" }));
    const api = appApiForTest(page, "fb1071254", "client-1");
    const error = await api.getFlowData("x").catch((error: unknown) => error as AxiError);
    expect(error).toBeInstanceOf(AxiError);
    expect(error.code).toBe("AUTH_ERROR");
    expect((error.suggestions ?? []).join(" ")).toContain("auth login");
  });

  it("maps non-200 to APP_API_ERROR with a body snippet", async () => {
    const { page } = fakePage(() => ({ status: 500, body: "boom" }));
    const api = appApiForTest(page, "fb1071254", "client-1");
    await expect(api.clone("/contentX")).rejects.toMatchObject({
      code: "APP_API_ERROR",
      message: expect.stringContaining("500"),
    });
  });

  it("rejects non-JSON 200 responses", async () => {
    const { page } = fakePage(() => ({ status: 200, body: "<html>login</html>" }));
    const api = appApiForTest(page, "fb1071254", "client-1");
    await expect(api.getFlowData("x")).rejects.toMatchObject({
      code: "APP_API_ERROR",
      message: expect.stringContaining("non-JSON"),
    });
  });

  it("quotes widget ids and statuses into setDraftStatus", async () => {
    const { page, requests } = fakePage(() => ({ status: 200, body: "{}" }));
    const api = appApiForTest(page, "fb1071254", "client-1");
    await api.setDraftStatus(60500995, "active");
    expect(requests[0]?.url).toBe(
      "https://app.manychat.com/fb1071254/growth-tools/setDraftStatus?widget_id=60500995&status=active",
    );
    expect(requests[0]?.method).toBe("POST");
  });
});
