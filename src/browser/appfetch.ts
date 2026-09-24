import { randomUUID } from "node:crypto";
import { AxiError } from "axi-sdk-js";
import { redact } from "../lib/env.js";
import {
  acquireLock,
  classifyUrl,
  launchSessionBrowser,
  looksLikeLoginPage,
  releaseLock,
  waitForLogin,
  type LaunchedSession,
} from "./session.js";

/**
 * In-page app API transport. The Playwright-controlled browser (already
 * authenticated via the persistent profile) performs same-origin fetches
 * against app.manychat.com - the browser session stays the only client;
 * cookies are never exported. Endpoints mapped in docs/discovery-2026-09-23.md.
 *
 * Every endpoint path is account-scoped: /fb{page}/...
 */

export type LaunchFn = typeof launchSessionBrowser;

/** Fetcher executed inside the page (same-origin, session-authenticated). */
async function appFetch(req: {
  url: string;
  method: string;
  body: string | null;
  csrfToken: string | null;
}): Promise<RawResponse> {
  const response = await fetch(req.url, {
    method: req.method,
    credentials: "include",
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      ...(req.csrfToken ? { "x-csrf-token": req.csrfToken } : {}),
      ...(req.body !== null ? { "Content-Type": "application/json" } : {}),
    },
    body: req.body,
  });
  return { status: response.status, text: await response.text() };
}

/** CSRF token extraction executed inside the page. */
function readCsrfToken(): string | null {
  const init = (globalThis as { __INIT__?: { app?: { csrf_token?: unknown } } }).__INIT__;
  const token = init?.app?.csrf_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export interface FetchPageLike {
  url(): string;
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  evaluate<T, A = unknown>(fn: (arg: A) => Promise<T> | T, arg?: A): Promise<T>;
}

export interface RawResponse {
  status: number;
  text: string;
}

export type AppApiMethod = "GET" | "POST";

export interface AppApi {
  /** Low-level: run one same-origin app request inside the page. */
  raw(method: AppApiMethod, path: string, body?: unknown): Promise<unknown>;
  getFlowData(ns: string): Promise<Record<string, unknown>>;
  getObject(path: string): Promise<Record<string, unknown>>;
  loadWidget(widgetId: number): Promise<Record<string, unknown>>;
  /** path is the cms path without account prefix, e.g. "/23495021/27592482/contentX". */
  clone(path: string): Promise<Record<string, unknown>>;
  rename(path: string, title: string): Promise<Record<string, unknown>>;
  patchDraft(ns: string, batch: Record<string, unknown>): Promise<Record<string, unknown>>;
  setWidget(widget: Record<string, unknown>): Promise<Record<string, unknown>>;
  setDraftStatus(widgetId: number, status: string): Promise<Record<string, unknown>>;
  publishFlow(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  createTag(name: string): Promise<Record<string, unknown>>;
  /** Per-session editor client id, sent by mutations. */
  clientId: string;
  /** Session CSRF token (never logged, never written to artifacts). */
  csrfToken: string | null;
}

export interface AppApiOptions {
  /** Account page segment, e.g. "fb1071254". */
  page: string;
  stateDir: string;
  /** When signed out: 0 fails fast with AUTH error; >0 waits for manual login. */
  loginTimeoutMs?: number;
  deps?: { launch?: LaunchFn; notice?: (line: string) => void };
}

interface Transport {
  page: FetchPageLike;
  clientId: string;
  csrfToken: string | null;
}

function apiUrl(page: string, path: string): string {
  return `https://app.manychat.com/${page}${path}`;
}

function transport(t: Transport, page: string): AppApi {
  const clientId = t.clientId;
  const csrfToken = t.csrfToken;
  async function raw(method: AppApiMethod, path: string, body?: unknown): Promise<unknown> {
    const url = apiUrl(page, path);
    let response: RawResponse;
    try {
      response = await t.page.evaluate<RawResponse, { url: string; method: string; body: string | null; csrfToken: string | null }>(
        appFetch,
        {
          url,
          method,
          body: body === undefined ? null : JSON.stringify(body),
          csrfToken,
        },
      );
    } catch (error) {
      throw new AxiError(
        `app request failed before the server responded (${method} ${path}): ${redact(
          error instanceof Error ? error.message : String(error),
        )}`,
        "APP_API_ERROR",
        ["The browser session may have closed; rerun the command"],
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new AxiError(
        `app API rejected the session (${method} ${path}, HTTP ${response.status})`,
        "AUTH_ERROR",
        ["Run `manychat-axi auth login` to refresh the browser session"],
      );
    }
    if (response.status !== 200) {
      throw new AxiError(
        `app API HTTP ${response.status} (${method} ${path}): ${snippet(response.text)}`,
        "APP_API_ERROR",
        ["Retry; if it persists, the internal API shape may have changed"],
      );
    }
    try {
      return JSON.parse(response.text) as unknown;
    } catch {
      throw new AxiError(
        `app API returned non-JSON (${method} ${path}): ${snippet(response.text)}`,
        "APP_API_ERROR",
      );
    }
  }

  function obj(value: unknown, context: string): Record<string, unknown> {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    throw new AxiError(`app API returned malformed data for ${context}`, "APP_API_ERROR");
  }

  return {
    clientId,
    csrfToken,
    raw,
    async getFlowData(ns) {
      return obj(await raw("GET", `/flow/getFlowData?ns=${encodeURIComponent(ns)}`), "getFlowData");
    },
    async getObject(path) {
      return obj(
        await raw("GET", `/cms/getObject?path=${encodeURIComponent(path)}`),
        "getObject",
      );
    },
    async loadWidget(widgetId) {
      return obj(
        await raw("GET", `/growth-tools/loadWidget?widget_id=${widgetId}`),
        "loadWidget",
      );
    },
    async clone(path) {
      return obj(
        await raw("GET", `/cms/clone?path=${encodeURIComponent(path)}`),
        "clone",
      );
    },
    async rename(path, title) {
      return obj(
        await raw("POST", "/cms/rename", { path, title, client_id: clientId }),
        "rename",
      );
    },
    async patchDraft(ns, batch) {
      return obj(await raw("POST", "/flow/patchDraft", { ns, batch }), "patchDraft");
    },
    async setWidget(widget) {
      return obj(
        await raw("POST", "/growth-tools/setWidget", { ...widget, client_id: clientId }),
        "setWidget",
      );
    },
    async setDraftStatus(widgetId, status) {
      return obj(
        await raw(
          "POST",
          `/growth-tools/setDraftStatus?widget_id=${widgetId}&status=${encodeURIComponent(status)}`,
        ),
        "setDraftStatus",
      );
    },
    async publishFlow(payload) {
      return obj(
        await raw("POST", "/flow/publish", { ...payload, client_id: clientId }),
        "publish",
      );
    },
    async createTag(name) {
      return obj(
        await raw("POST", "/tags/create", { tag_name: name, path: "/", client_id: clientId }),
        "tags/create",
      );
    },
  };
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 200 ? flat : `${flat.slice(0, 200)}…`;
}

/**
 * Capture the session CSRF token from the app's own traffic. The app sends
 * x-csrf-token on every API request; newer SPA shells do not expose it via
 * __INIT__, so traffic capture is the primary source. Attach BEFORE
 * navigating so the initial XHR burst is not missed.
 */
function captureCsrfFromTraffic(
  page: { on(event: string, handler: (request: { url(): string; headers(): Record<string, string> }) => void): void; off(event: string, handler: (...args: unknown[]) => void): void },
  timeoutMs = 20_000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const handler = (request: { url(): string; headers(): Record<string, string> }) => {
      const token = request.headers()["x-csrf-token"];
      if (token && /app\.manychat\.com\/fb\d+\//.test(request.url())) {
        cleanup();
        resolve(token);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    function cleanup(): void {
      clearTimeout(timer);
      page.off("request", handler as (...args: unknown[]) => void);
    }
    page.on("request", handler);
  });
}

/**
 * Open the persistent browser, ensure the ManyChat session is live, run the
 * callback with an AppApi, then close. One launch per unit of work.
 */
export async function withAppApi<T>(opts: AppApiOptions, fn: (api: AppApi) => Promise<T>): Promise<T> {
  const launch = opts.deps?.launch ?? launchSessionBrowser;
  const notice = opts.deps?.notice ?? ((line: string) => console.error(line));
  const loginTimeoutMs = opts.loginTimeoutMs ?? 0;
  acquireLock(opts.stateDir);
  let session: LaunchedSession | undefined;
  try {
    session = await launch(opts.stateDir);
    const page = session.page;
    // Attach before navigation: the dashboard's initial XHR burst carries the token.
    const csrfFromTraffic = captureCsrfFromTraffic(page);
    await page.goto(`https://app.manychat.com/${opts.page}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(3000);
    const state = classifyUrl(page.url());
    const passwordForm = await looksLikeLoginPage(page);
    if (state !== "logged-in" || passwordForm) {
      if (loginTimeoutMs <= 0) {
        throw new AxiError(
          "browser session is not signed in to ManyChat",
          "AUTH_ERROR",
          ["Run `manychat-axi auth login`, or pass --timeout to wait for a manual login"],
        );
      }
      notice("[manychat-axi] complete the login in the opened window - waiting...");
      await waitForLogin(page, { timeoutMs: loginTimeoutMs });
    }
    const fetchPage = page as unknown as FetchPageLike;
    const csrfToken =
      (await fetchPage.evaluate<string | null>(readCsrfToken)) ?? (await csrfFromTraffic);
    if (!csrfToken) {
      throw new AxiError(
        "could not obtain the session CSRF token from the app",
        "APP_API_ERROR",
        ["Run `manychat-axi auth login` to refresh the session, then retry"],
      );
    }
    return await fn(
      transport(
        { page: fetchPage, clientId: `${randomUUID()}|${randomUUID()}`, csrfToken },
        opts.page,
      ),
    );
  } finally {
    await session?.close();
    releaseLock(opts.stateDir);
  }
}

/** Test seam: build an AppApi over a fake page. */
export function appApiForTest(
  page: FetchPageLike,
  pageSegment: string,
  clientId: string,
  csrfToken: string | null = null,
): AppApi {
  return transport({ page, clientId, csrfToken }, pageSegment);
}
