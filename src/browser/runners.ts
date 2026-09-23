import { createInterface } from "node:readline";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import {
  acquireLock,
  classifyUrl,
  launchSessionBrowser,
  looksLikeLoginPage,
  releaseLock,
  waitForLogin,
  writeSessionRecord,
  type BrowserAuthState,
  type LaunchedSession,
} from "./session.js";
import { createRecorder, type CapturedExchange } from "./capture.js";
import { createRunDir, sanitizeHtml, writeText, type RunDir } from "./artifacts.js";

/**
 * Browser runners. These contain the only live-Playwright orchestration in
 * the CLI; commands delegate here and shape output. Unit tests inject fakes.
 */

export const APP_URL = "https://app.manychat.com/";

export type LaunchFn = typeof launchSessionBrowser;

export interface RunnerDeps {
  launch?: LaunchFn;
  /** Progress channel during interactive waits (defaults to stderr). */
  notice?: (line: string) => void;
  stdin?: NodeJS.ReadableStream;
}

export interface LoginResult {
  url: string;
}

export async function runLogin(opts: {
  stateDir: string;
  timeoutMs: number;
  deps?: RunnerDeps;
}): Promise<LoginResult> {
  const deps = opts.deps ?? {};
  const launch = deps.launch ?? launchSessionBrowser;
  const notice = deps.notice ?? ((line: string) => console.error(line));
  acquireLock(opts.stateDir);
  let session: LaunchedSession | undefined;
  try {
    session = await launch(opts.stateDir);
    notice("[manychat-axi] opened ManyChat in a visible Chrome window");
    await session.page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const url = await waitForLogin(session.page, {
      timeoutMs: opts.timeoutMs,
      onPrompt: () =>
        notice(
          "[manychat-axi] complete the login (including 2FA / Facebook) in the opened window - waiting...",
        ),
    });
    writeSessionRecord(opts.stateDir, { lastLogin: new Date().toISOString(), url });
    return { url };
  } finally {
    await session?.close();
    releaseLock(opts.stateDir);
  }
}

export interface ProbeResult {
  state: BrowserAuthState;
  url: string;
}

/** Launch briefly, classify the session, close. Updates the record on success. */
export async function runProbe(opts: {
  stateDir: string;
  deps?: RunnerDeps;
}): Promise<ProbeResult> {
  const deps = opts.deps ?? {};
  const launch = deps.launch ?? launchSessionBrowser;
  acquireLock(opts.stateDir);
  let session: LaunchedSession | undefined;
  try {
    session = await launch(opts.stateDir);
    await session.page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // ManyChat's SPA client-side redirects to /signin when logged out; give
    // that redirect time to land before classifying.
    await session.page.waitForTimeout(5000);
    const url = session.page.url();
    const state = classifyUrl(url);
    const passwordForm = await looksLikeLoginPage(session.page);
    const effective: BrowserAuthState = state === "logged-in" && passwordForm ? "auth" : state;
    if (effective === "logged-in") {
      writeSessionRecord(opts.stateDir, { lastLogin: new Date().toISOString(), url });
    }
    return { state: effective, url };
  } finally {
    await session?.close();
    releaseLock(opts.stateDir);
  }
}

export interface DiscoverResult {
  runDir: string;
  runId: string;
  url: string;
  exchanges: CapturedExchange[];
  documentCount: number;
  consoleErrors: string[];
  files: string[];
}

const DEMO_CHECKLIST = [
  "discovery recording - demonstrate in the opened window:",
  "  1. open the canonical template flow",
  "  2. duplicate it",
  "  3. rename the duplicate",
  "  4. edit the trigger keyword",
  "  5. edit the opening DM text",
  "  6. edit the button URL",
  "  7. select or create the click tag",
  "  8. save as draft",
  "  9. publish it (optional)",
];

export async function runDiscover(opts: {
  stateDir: string;
  url: string;
  loginTimeoutMs: number;
  maxWaitMs: number;
  deps?: RunnerDeps;
}): Promise<DiscoverResult> {
  const deps = opts.deps ?? {};
  const launch = deps.launch ?? launchSessionBrowser;
  const notice = deps.notice ?? ((line: string) => console.error(line));
  const stdin = deps.stdin ?? process.stdin;

  acquireLock(opts.stateDir);
  const run: RunDir = createRunDir(opts.stateDir, "discover");
  const documentsDir = join(run.dir, "documents");
  const recorder = createRecorder({ documentsDir });
  const consoleErrors: string[] = [];
  let session: LaunchedSession | undefined;
  const files: string[] = [];
  // --max-wait bounds the WHOLE run, including the login wait.
  const runStartedAt = Date.now();
  const remainingRunBudget = () => Math.max(0, opts.maxWaitMs - (Date.now() - runStartedAt));

  try {
    session = await launch(opts.stateDir);
    const page = session.page;

    await session.context.tracing.start({
      title: `manychat-axi discover ${new Date().toISOString()}`,
      screenshots: true,
      snapshots: true,
      sources: false,
    });

    page.on("console", (message) => {
      if (message.type() === "error" && consoleErrors.length < 200) {
        consoleErrors.push(message.text().slice(0, 500));
      }
    });
    page.on("pageerror", (error) => {
      if (consoleErrors.length < 200) {
        consoleErrors.push(`pageerror: ${String(error).slice(0, 450)}`);
      }
    });
    recorder.attach(page);

    notice(`[manychat-axi] opening ${opts.url}`);
    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForLogin(page, {
      timeoutMs: Math.min(opts.loginTimeoutMs, remainingRunBudget()),
      onPrompt: () =>
        notice(
          "[manychat-axi] complete the login (including 2FA / Facebook) in the opened window - waiting...",
        ),
    });

    for (const line of DEMO_CHECKLIST) notice(`[manychat-axi] ${line}`);
    notice("[manychat-axi] press Enter here to finish and write artifacts...");
    await waitForEnter(stdin, remainingRunBudget());

    // Final snapshots of whatever is on screen.
    try {
      await page.screenshot({ path: join(run.dir, "final-screenshot.png"), fullPage: false });
      files.push("final-screenshot.png");
    } catch {
      // screenshot is best-effort
    }
    try {
      const aria = await page.locator("html").ariaSnapshot();
      writeText(join(run.dir, "aria.yml"), aria);
      files.push("aria.yml");
    } catch {
      // aria snapshot is best-effort
    }
    try {
      const dom = sanitizeHtml(await page.content());
      writeText(join(run.dir, "dom.html"), dom);
      files.push("dom.html");
    } catch {
      // dom snapshot is best-effort
    }

    await recorder.finish();
    const tracePath = join(run.dir, "trace.zip");
    await session.context.tracing.stop({ path: tracePath });
    files.push("trace.zip");
  } catch (error) {
    try {
      await session?.context.tracing.stop({ path: join(run.dir, "trace-partial.zip") });
    } catch {
      // tracing may not have started; partial trace is best-effort
    }
    await session?.close();
    releaseLock(opts.stateDir);
    throw error instanceof AxiError
      ? error
      : new AxiError(
          `discovery failed: ${error instanceof Error ? error.message : String(error)}`,
          "LAUNCH_ERROR",
          ["Check the opened window state and rerun; artifacts may be partial"],
        );
  }

  await session?.close();
  releaseLock(opts.stateDir);

  writeText(join(run.dir, "network.json"), JSON.stringify(recorder.exchanges, null, 2));
  files.push("network.json");
  if (consoleErrors.length > 0) {
    writeText(join(run.dir, "console-errors.txt"), consoleErrors.join("\n"));
    files.push("console-errors.txt");
  }
  const documentCount = recorder.exchanges.filter((exchange) => exchange.savedTo).length;
  const index = {
    kind: "discover",
    url: opts.url,
    finishedAt: new Date().toISOString(),
    exchanges: recorder.exchanges.length,
    documents: documentCount,
    consoleErrors: consoleErrors.length,
    files: files.concat(documentCount > 0 ? ["documents/"] : []),
  };
  writeText(join(run.dir, "index.json"), JSON.stringify(index, null, 2));
  files.push("index.json");

  return {
    runDir: run.dir,
    runId: run.id,
    url: opts.url,
    exchanges: recorder.exchanges,
    documentCount,
    consoleErrors,
    files,
  };
}

/**
 * Resolve the manual-completion signal: one Enter line on a TTY, a piped
 * line, or EOF - bounded by maxWaitMs so no session hangs forever.
 */
export async function waitForEnter(
  stdin: NodeJS.ReadableStream,
  maxWaitMs: number,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      stdin.removeListener("end", done);
      resolve();
    };
    const timer = setTimeout(done, maxWaitMs);
    const rl = createInterface({ input: stdin, terminal: false });
    rl.once("line", done);
    rl.once("close", done);
    stdin.once("end", done);
  });
}
