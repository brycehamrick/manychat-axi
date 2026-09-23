import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
/**
 * Browser session: persistent headed Chrome profile, local lock, and
 * auth-state classification.
 *
 * Rules (REQUIREMENTS.md, Browser transport):
 * - All runs are headed. No headless background execution.
 * - The profile lives under the user-level state dir; the user's primary
 *   Chrome profile is never touched.
 * - The Playwright-controlled browser is the only web client for
 *   app.manychat.com - cookies are never exported or replayed elsewhere.
 */
export const PROFILE_DIR_NAME = "browser-profile";
export function resolveStateDir(env = process.env) {
    const override = env["MANYCHAT_STATE_DIR"]?.trim();
    if (override && override.length > 0)
        return override;
    return join(homedir(), ".manychat-axi");
}
export function profileDir(stateDir) {
    return join(stateDir, PROFILE_DIR_NAME);
}
export function sessionRecordPath(stateDir) {
    return join(stateDir, "session.json");
}
export function readSessionRecord(stateDir) {
    const path = sessionRecordPath(stateDir);
    if (!existsSync(path))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (typeof parsed.lastLogin === "string" && typeof parsed.url === "string") {
            return { lastLogin: parsed.lastLogin, url: parsed.url };
        }
    }
    catch {
        // fall through: corrupt record is treated as absent
    }
    return null;
}
export function writeSessionRecord(stateDir, record) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(sessionRecordPath(stateDir), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}
export function deleteSessionRecord(stateDir) {
    const path = sessionRecordPath(stateDir);
    if (existsSync(path))
        rmSync(path);
}
export function profileExists(stateDir) {
    return existsSync(profileDir(stateDir));
}
/** Delete the browser profile and session record. Scoped to exact paths only. */
export function purgeProfile(stateDir) {
    const profile = profileDir(stateDir);
    const resolved = profile;
    if (!resolved.startsWith(join(stateDir, ""))) {
        throw new AxiError("refusing to purge a profile outside the state directory", "API_ERROR");
    }
    if (existsSync(profile))
        rmSync(profile, { recursive: true, force: true });
    deleteSessionRecord(stateDir);
}
/* ------------------------------------------------------------------ */
/* Lock                                                                */
/* ------------------------------------------------------------------ */
export function lockPath(stateDir) {
    return join(stateDir, "lock");
}
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === "EPERM";
    }
}
/** One browser session at a time. Stale locks (dead pid) are replaced. */
export function acquireLock(stateDir, opts = {}) {
    const pid = opts.pid ?? process.pid;
    const isAlive = opts.isAlive ?? isPidAlive;
    mkdirSync(stateDir, { recursive: true });
    const path = lockPath(stateDir);
    if (existsSync(path)) {
        const held = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
        if (Number.isInteger(held) && held !== pid && isAlive(held)) {
            throw new AxiError(`another manychat-axi browser session is active (pid ${held})`, "LOCK_HELD", ["Wait for it to finish, or kill that process if it is stale"]);
        }
    }
    writeFileSync(path, `${pid}\n`, "utf8");
}
export function releaseLock(stateDir) {
    const path = lockPath(stateDir);
    if (existsSync(path))
        rmSync(path);
}
async function defaultLaunch(userDataDir, options) {
    const { chromium } = await import("playwright-core");
    return chromium.launchPersistentContext(userDataDir, options);
}
/**
 * Launch the persistent headed browser. Installed Google Chrome is used via
 * channel "chrome"; if unavailable, falls back to any Playwright-installed
 * chromium; if neither exists, fails with install guidance.
 */
export async function launchSessionBrowser(stateDir, opts = {}) {
    const userDataDir = profileDir(stateDir);
    mkdirSync(userDataDir, { recursive: true });
    const launch = opts.launch ?? defaultLaunch;
    const base = { headless: false };
    let context;
    if ((opts.channelPreference ?? "chrome") === "chrome") {
        try {
            context = await launch(userDataDir, { ...base, channel: "chrome" });
        }
        catch {
            try {
                context = await launch(userDataDir, base);
            }
            catch {
                throw chromeMissingError();
            }
        }
    }
    else {
        try {
            context = await launch(userDataDir, base);
        }
        catch {
            throw chromeMissingError();
        }
    }
    const page = context.pages()[0] ?? (await context.newPage());
    return {
        context,
        page,
        close: async () => {
            try {
                await context.close();
            }
            catch {
                // closing a context the user already closed is success here
            }
        },
    };
}
function chromeMissingError() {
    return new AxiError("no usable Chrome/Chromium found for the browser transport", "LAUNCH_ERROR", [
        "Install Google Chrome (used via Playwright's chrome channel), or",
        "Run `npx playwright@latest install chromium` for a bundled browser",
    ]);
}
const AUTH_PATH = /\/(login|signin|signup|logout|auth)(\/|$|\?|#)/i;
/**
 * Classify a URL by login state without touching page internals, so the
 * heuristic stays testable and easy to revise after discovery.
 */
export function classifyUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return "away";
    }
    const host = url.hostname.toLowerCase();
    if (!host.endsWith("manychat.com"))
        return "away";
    if (host === "app.manychat.com" && !AUTH_PATH.test(url.pathname))
        return "logged-in";
    return "auth";
}
/**
 * A visible password input means an auth form regardless of what the URL
 * claims - ManyChat's SPA can serve the app shell to logged-out visitors
 * before a client-side redirect, so the URL alone can false-positive.
 */
export async function looksLikeLoginPage(page) {
    try {
        return (await page.locator('input[type="password"]').count()) > 0;
    }
    catch {
        return false;
    }
}
/**
 * Wait for manual login: poll the URL and DOM until the app dashboard is
 * reached. Timeout raises TIMEOUT with guidance; the caller closes the
 * browser.
 */
export async function waitForLogin(page, opts) {
    const pollMs = opts.pollMs ?? 500;
    const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const deadline = Date.now() + opts.timeoutMs;
    let prompted = false;
    for (;;) {
        const state = classifyUrl(page.url());
        if (state === "logged-in" && !(await looksLikeLoginPage(page)))
            return page.url();
        if (!prompted) {
            // give redirects a moment before declaring a login is needed
            await sleep(1500);
            const retryState = classifyUrl(page.url());
            if (retryState === "logged-in" && !(await looksLikeLoginPage(page)))
                return page.url();
            prompted = true;
            opts.onPrompt?.();
        }
        if (Date.now() >= deadline) {
            throw new AxiError(`login not completed within ${opts.timeoutMs}ms`, "TIMEOUT", [
                "Complete the login (including 2FA / Facebook) in the opened window and rerun",
                "Pass a larger --timeout if you need more time",
            ]);
        }
        await sleep(pollMs);
    }
}
