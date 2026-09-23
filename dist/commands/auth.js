import { AxiError } from "axi-sdk-js";
import { optionalInt, parseFlags } from "../lib/args.js";
import { renderResult } from "../lib/output.js";
import { errorMessage } from "../lib/guard.js";
import { deleteSessionRecord, profileDir, profileExists, purgeProfile, readSessionRecord, } from "../browser/session.js";
export const AUTH_HELP = `manychat-axi auth - credential state for both transports

subcommands:
  auth status            report the public API key and browser session state
  auth login             open a visible Chrome window and wait for manual login
  auth logout            clear the session record (add --purge to delete the profile)

flags:
  --timeout <ms>         (login) max wait for manual login (default 300000)
  --browser              (status) launch briefly and verify the live session
  --purge                (logout) delete the browser profile and session record
  --json                 machine-readable JSON instead of TOON

The browser session uses a dedicated persistent profile under
~/.manychat-axi/browser-profile - never your primary Chrome profile. Login is
manual (2FA / Facebook included). The Playwright browser is the only client
for app.manychat.com; cookies are never exported or replayed.

auth: MANYCHAT_API_KEY env var only - generate it in ManyChat Settings -> API.
Never pass the key as a flag, store it in files, or paste it into chat.

examples:
  manychat-axi auth status
  manychat-axi auth login
  manychat-axi auth login --timeout 600000
  manychat-axi auth logout --purge`;
const STATUS_FLAGS = {
    browser: { type: "boolean" },
    json: { type: "boolean" },
};
const LOGIN_FLAGS = {
    timeout: { type: "string" },
    json: { type: "boolean" },
};
const LOGOUT_FLAGS = {
    purge: { type: "boolean" },
    json: { type: "boolean" },
};
export async function authCommand(args, ctx) {
    const sub = args[0];
    if (sub === undefined) {
        return { help_text: AUTH_HELP };
    }
    if (sub === "status")
        return status(args.slice(1), ctx);
    if (sub === "login")
        return login(args.slice(1), ctx);
    if (sub === "logout")
        return logout(args.slice(1), ctx);
    throw new AxiError(`auth: unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Implemented: `auth status`, `auth login`, `auth logout`",
        "Run `manychat-axi auth --help` for the reference",
    ]);
}
function browserSection(ctx) {
    const record = readSessionRecord(ctx.stateDir);
    return {
        profile: profileExists(ctx.stateDir) ? "present" : "missing",
        last_login: record?.lastLogin ?? null,
        ...(record ? { last_url: record.url } : {}),
    };
}
async function status(args, ctx) {
    const commandPath = "manychat-axi auth status";
    const { values } = parseFlags(args, commandPath, STATUS_FLAGS);
    const json = values["json"] === true;
    let browser;
    if (values["browser"] === true) {
        try {
            const probe = await ctx.browser.probe({ stateDir: ctx.stateDir });
            browser = {
                ...browserSection(ctx),
                live: { state: probe.state, url: probe.url },
            };
        }
        catch (error) {
            browser = {
                ...browserSection(ctx),
                live: { error: errorMessage(error, ctx.config.apiKey) },
            };
        }
    }
    else {
        browser = { ...browserSection(ctx), live: "not probed (pass --browser to verify live)" };
    }
    if (!ctx.config.apiKey) {
        return renderResult({
            auth: {
                api_key: { configured: false, valid: null },
                browser_session: browser,
            },
            help: [
                "Export MANYCHAT_API_KEY (ManyChat Settings -> API) to enable data commands",
                "Run `manychat-axi auth login` to establish the browser session",
            ],
        }, json);
    }
    try {
        const page = await ctx.client.getInfo();
        return renderResult({
            auth: {
                api_key: { configured: true, valid: true, page: page.name, page_id: page.id },
                browser_session: browser,
            },
            help: [
                "Run `manychat-axi discover` to capture the Flow Builder's document traffic",
                "Run `manychat-axi flows list` to see the automation inventory",
            ],
        }, json);
    }
    catch (error) {
        return renderResult({
            auth: {
                api_key: {
                    configured: true,
                    valid: false,
                    error: errorMessage(error, ctx.config.apiKey),
                },
                browser_session: browser,
            },
            help: [
                "Generate a fresh key in ManyChat Settings -> API and export MANYCHAT_API_KEY",
                "Run `manychat-axi auth status` again to verify",
            ],
        }, json);
    }
}
async function login(args, ctx) {
    const commandPath = "manychat-axi auth login";
    const { values } = parseFlags(args, commandPath, LOGIN_FLAGS);
    const json = values["json"] === true;
    const timeoutMs = optionalInt(values, "timeout", { min: 10_000, max: 3_600_000 }) ?? 300_000;
    const result = await ctx.browser.login({ stateDir: ctx.stateDir, timeoutMs });
    return renderResult({
        auth: {
            browser_session: {
                logged_in: true,
                url: result.url,
                profile: profileDir(ctx.stateDir),
            },
        },
        help: [
            "Run `manychat-axi auth status --browser` to re-verify anytime",
            "Run `manychat-axi discover` to capture Flow Builder document traffic",
        ],
    }, json);
}
async function logout(args, ctx) {
    const commandPath = "manychat-axi auth logout";
    const { values } = parseFlags(args, commandPath, LOGOUT_FLAGS);
    const json = values["json"] === true;
    if (values["purge"] === true) {
        purgeProfile(ctx.stateDir);
        return renderResult({
            auth: {
                browser_session: { profile: "deleted", session_record: "deleted" },
            },
            help: [
                "Run `manychat-axi auth login` to create a fresh profile",
                "The public API key (if exported) is unaffected",
            ],
        }, json);
    }
    const hadRecord = readSessionRecord(ctx.stateDir) !== null;
    deleteSessionRecord(ctx.stateDir);
    return renderResult({
        auth: {
            browser_session: {
                session_record: hadRecord ? "deleted" : "absent",
                profile: profileExists(ctx.stateDir) ? "kept (pass --purge to delete)" : "missing",
            },
        },
        help: [
            "Run `manychat-axi auth logout --purge` to delete the browser profile too",
            "The public API key (if exported) is unaffected",
        ],
    }, json);
}
