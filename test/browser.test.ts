import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import type { Page, Response } from "playwright-core";
import {
  acquireLock,
  classifyUrl,
  deleteSessionRecord,
  lockPath,
  profileExists,
  purgeProfile,
  readSessionRecord,
  releaseLock,
  resolveStateDir,
  writeSessionRecord,
} from "../src/browser/session.js";
import {
  createRecorder,
  redactJsonText,
  shouldCaptureExchange,
  shouldCaptureUrl,
  slugifyUrl,
} from "../src/browser/capture.js";
import { createRunDir, sanitizeHtml } from "../src/browser/artifacts.js";

function tempStateDir(): string {
  return mkdtempSync(join(tmpdir(), "manychat-axi-browser-test-"));
}

describe("state dir and session record", () => {
  it("defaults to ~/.manychat-axi and honors MANYCHAT_STATE_DIR", () => {
    expect(resolveStateDir()).toBe(join(homedir(), ".manychat-axi"));
    expect(resolveStateDir({ MANYCHAT_STATE_DIR: "/tmp/custom-state" })).toBe("/tmp/custom-state");
  });

  it("round-trips the session record and tolerates corruption", () => {
    const dir = tempStateDir();
    expect(readSessionRecord(dir)).toBeNull();
    writeSessionRecord(dir, { lastLogin: "2026-09-23T00:00:00Z", url: "https://app.manychat.com/" });
    expect(readSessionRecord(dir)).toEqual({
      lastLogin: "2026-09-23T00:00:00Z",
      url: "https://app.manychat.com/",
    });
    writeFileSync(join(dir, "session.json"), "{corrupt", "utf8");
    expect(readSessionRecord(dir)).toBeNull();
    deleteSessionRecord(dir);
    expect(existsSync(join(dir, "session.json"))).toBe(false);
  });

  it("purge removes only the profile and record", () => {
    const dir = tempStateDir();
    const profile = join(dir, "browser-profile");
    const runs = join(dir, "runs", "keep-me");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "Cookies"), "fake", "utf8");
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, "trace.zip"), "fake", "utf8");
    writeSessionRecord(dir, { lastLogin: "x", url: "y" });
    expect(profileExists(dir)).toBe(true);

    purgeProfile(dir);
    expect(profileExists(dir)).toBe(false);
    expect(existsSync(join(dir, "session.json"))).toBe(false);
    expect(existsSync(join(runs, "trace.zip"))).toBe(true);
  });
});

describe("lock", () => {
  it("rejects a second holder while alive and replaces stale locks", () => {
    const dir = tempStateDir();
    acquireLock(dir, { pid: 111, isAlive: () => true });
    expect(readFileSync(lockPath(dir), "utf8").trim()).toBe("111");

    expect(() => acquireLock(dir, { pid: 222, isAlive: () => true })).toThrowError(AxiError);
    try {
      acquireLock(dir, { pid: 222, isAlive: () => true });
    } catch (error) {
      expect((error as AxiError).code).toBe("LOCK_HELD");
    }

    // re-entrant acquire by the same pid is allowed
    acquireLock(dir, { pid: 111, isAlive: () => true });

    // a stale lock (dead pid) is replaced
    acquireLock(dir, { pid: 333, isAlive: () => false });
    expect(readFileSync(lockPath(dir), "utf8").trim()).toBe("333");

    releaseLock(dir);
    expect(existsSync(lockPath(dir))).toBe(false);
  });
});

describe("classifyUrl", () => {
  it("classifies app dashboard, auth pages, and away URLs", () => {
    expect(classifyUrl("https://app.manychat.com/#/dashboard")).toBe("logged-in");
    expect(classifyUrl("https://app.manychat.com/fb1999/automation/")).toBe("logged-in");
    expect(classifyUrl("https://app.manychat.com/login")).toBe("auth");
    expect(classifyUrl("https://manychat.com/login")).toBe("auth");
    expect(classifyUrl("https://accounts.manychat.com/signin")).toBe("auth");
    expect(classifyUrl("https://www.facebook.com/")).toBe("away");
    expect(classifyUrl("not a url")).toBe("away");
  });
});

describe("capture filters", () => {
  it("captures only manychat.com hosts", () => {
    expect(shouldCaptureUrl("https://app.manychat.com/api/x")).toBe(true);
    expect(shouldCaptureUrl("https://api.manychat.com/fb/page/getInfo")).toBe(true);
    expect(shouldCaptureUrl("https://cdn.segment.com/analytics.js")).toBe(false);
    expect(shouldCaptureUrl("https://evilmanychat.com/api")).toBe(false);
  });

  it("captures mutations, JSON, and XHR - skips static GETs", () => {
    expect(shouldCaptureExchange("POST", "xhr", "application/json")).toBe(true);
    expect(shouldCaptureExchange("PUT", undefined, undefined)).toBe(true);
    expect(shouldCaptureExchange("GET", "xhr", undefined)).toBe(true);
    expect(shouldCaptureExchange("GET", "fetch", undefined)).toBe(true);
    expect(shouldCaptureExchange("GET", "document", "text/html")).toBe(false);
    expect(shouldCaptureExchange("GET", "stylesheet", "text/css")).toBe(false);
  });
});

describe("redaction", () => {
  it("deep-redacts credential-shaped keys", () => {
    const input = JSON.stringify({
      name: "Podcast | EP1",
      token: "abc123",
      authorization: "Bearer xyz",
      sessionId: "s1",
      nested: { csrf: "c", api_key: "k", keep: "me" },
      list: [{ password: "p" }, { value: 2 }],
    });
    const out = redactJsonText(input) as string;
    expect(out).toContain('"keep": "me"');
    expect(out).toContain('"value": 2');
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("Bearer xyz");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain('"p"');
    expect(out).toContain("***redacted***");
  });

  it("passes non-JSON text through unchanged", () => {
    expect(redactJsonText("plain text")).toBe("plain text");
  });
});

describe("slugs and sanitization", () => {
  it("slugifies URLs for document filenames", () => {
    expect(slugifyUrl("https://app.manychat.com/api/flow/get?x=1")).toBe(
      "app-manychat-com-api-flow-get",
    );
  });

  it("strips scripts and comments from DOM snapshots", () => {
    const html = '<html><body><script>window.TOKEN="abc"</script><p>hi</p><!-- secret --></body></html>';
    const clean = sanitizeHtml(html);
    expect(clean).toContain("<p>hi</p>");
    expect(clean).not.toContain("TOKEN");
    expect(clean).not.toContain("secret");
  });
});

describe("run dirs", () => {
  it("creates timestamped run directories", () => {
    const dir = tempStateDir();
    const run = createRunDir(dir, "discover", () => new Date("2026-09-23T10:30:00Z"));
    expect(run.id).toMatch(/^discover-20260923-\d{6}-[0-9a-f]{4}$/);
    expect(existsSync(join(dir, "runs", run.id))).toBe(true);
  });
});

describe("recorder", () => {
  interface FakeResponseOptions {
    url?: string;
    method?: string;
    status?: number;
    resourceType?: string;
    contentType?: string;
    requestContentType?: string;
    postData?: string | null;
    body?: string;
  }

  function fakeResponse(options: FakeResponseOptions = {}): Response {
    return {
      url: () => options.url ?? "https://app.manychat.com/api/flow/get",
      status: () => options.status ?? 200,
      headers: () => ({ "content-type": options.contentType ?? "application/json" }),
      body: async () => Buffer.from(options.body ?? "{}", "utf8"),
      request: () => ({
        method: () => options.method ?? "GET",
        headers: () => ({
          "content-type": options.requestContentType ?? "application/json",
        }),
        postData: () => options.postData ?? null,
        resourceType: () => options.resourceType ?? "xhr",
      }),
    } as unknown as Response;
  }

  function fakePage() {
    const handlers: Array<(response: Response) => void> = [];
    const page = {
      on: (_event: string, handler: (response: Response) => void) => {
        handlers.push(handler);
      },
      emit: (response: Response) => {
        for (const handler of [...handlers]) handler(response);
      },
    };
    return page as unknown as Page & { emit(response: Response): void };
  }

  it("captures flow documents to files with redaction", async () => {
    const documentsDir = join(tempStateDir(), "documents");
    const recorder = createRecorder({ documentsDir, minBodyBytes: 16 });
    const page = fakePage();
    recorder.attach(page);

    const documentBody = JSON.stringify({
      token: "super-secret-token",
      nodes: Array.from({ length: 20 }, (_, i) => ({ id: i, type: "message" })),
    });
    page.emit(fakeResponse({ body: documentBody, resourceType: "xhr" }));
    await recorder.finish();

    expect(recorder.exchanges).toHaveLength(1);
    const exchange = recorder.exchanges[0];
    expect(exchange?.savedTo).toMatch(/^documents\/000-app-manychat-com-api-flow-get\.json$/);
    const saved = readFileSync(join(documentsDir, "000-app-manychat-com-api-flow-get.json"), "utf8");
    expect(saved).toContain('"id": 19');
    expect(saved).not.toContain("super-secret-token");
    expect(exchange?.responseBytes).toBe(Buffer.byteLength(documentBody, "utf8"));
  });

  it("redacts JSON request bodies on POSTs", async () => {
    const recorder = createRecorder({ minBodyBytes: 1024 });
    const page = fakePage();
    recorder.attach(page);
    page.emit(
      fakeResponse({
        method: "POST",
        postData: JSON.stringify({ name: "EP1", api_key: "k123" }),
        body: '{"status":"success"}',
      }),
    );
    await recorder.finish();
    const exchange = recorder.exchanges[0];
    expect(exchange?.requestBody).toContain('"name": "EP1"');
    expect(exchange?.requestBody).not.toContain("k123");
  });

  it("ignores non-ManyChat hosts and static GETs", async () => {
    const recorder = createRecorder({ minBodyBytes: 1 });
    const page = fakePage();
    recorder.attach(page);
    page.emit(fakeResponse({ url: "https://cdn.segment.com/analytics.js", resourceType: "script", contentType: "text/javascript" }));
    page.emit(fakeResponse({ resourceType: "stylesheet", contentType: "text/css", body: "body{}" }));
    await recorder.finish();
    expect(recorder.exchanges).toHaveLength(0);
  });

  it("records body-read failures instead of dropping the exchange", async () => {
    const recorder = createRecorder({ minBodyBytes: 1 });
    const page = fakePage();
    recorder.attach(page);
    const failing = {
      ...fakeResponse(),
      body: async () => {
        throw new Error("body unavailable");
      },
    } as unknown as Response;
    page.emit(failing);
    await recorder.finish();
    expect(recorder.exchanges).toHaveLength(1);
    expect(recorder.exchanges[0]?.error).toContain("body unavailable");
  });
});
