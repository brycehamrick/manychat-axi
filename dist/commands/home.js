import { parseFlags } from "../lib/args.js";
import { renderResult } from "../lib/output.js";
import { errorMessage } from "../lib/guard.js";
const HOME_FLAGS = {
    json: { type: "boolean" },
};
async function section(op, secret) {
    try {
        return { ok: true, value: await op() };
    }
    catch (error) {
        return { ok: false, error: errorMessage(error, secret) };
    }
}
function count(result, countOf) {
    return result.ok ? countOf(result.value) : `error: ${result.error}`;
}
/**
 * AXI principle 8: bare invocation is live content - auth state, page, and
 * pre-computed counts (principle 4). Without an API key it makes zero
 * network calls and explains how to enable them.
 */
export async function homeCommand(args, ctx) {
    const { values } = parseFlags(args, "manychat-axi", HOME_FLAGS);
    const json = values["json"] === true;
    if (!ctx.config.apiKey) {
        return renderResult({
            auth: {
                api_key: "missing",
                browser_session: "phase 1 (not yet available)",
            },
            help: [
                "Export MANYCHAT_API_KEY (ManyChat Settings -> API) to enable data commands",
                "Browser-session commands (flow content) arrive in Phase 1+",
                "Run `manychat-axi setup hooks` for ambient session context",
            ],
        }, json);
    }
    const page = await section(() => ctx.client.getInfo(), ctx.config.apiKey);
    if (!page.ok) {
        return renderResult({
            auth: {
                api_key: `configured but not working: ${page.error}`,
                browser_session: "phase 1 (not yet available)",
            },
            help: [
                "Run `manychat-axi auth status` for the full error",
                "Generate a fresh key in ManyChat Settings -> API and export MANYCHAT_API_KEY",
            ],
        }, json);
    }
    const [flows, tags, userFields, botFields] = await Promise.all([
        section(() => ctx.client.getFlows(), ctx.config.apiKey),
        section(() => ctx.client.getTags(), ctx.config.apiKey),
        section(() => ctx.client.getCustomFields(), ctx.config.apiKey),
        section(() => ctx.client.getBotFields(), ctx.config.apiKey),
    ]);
    return renderResult({
        page: { name: page.value.name, id: page.value.id },
        auth: {
            api_key: "ok",
            browser_session: "phase 1 (not yet available)",
        },
        counts: {
            flows: count(flows, (v) => v.flows.length),
            folders: count(flows, (v) => v.folders.length),
            tags: count(tags, (v) => v.length),
            user_fields: count(userFields, (v) => v.length),
            bot_fields: count(botFields, (v) => v.length),
        },
        help: [
            "Run `manychat-axi flows list` for the automation inventory",
            "Run `manychat-axi tags list` or `manychat-axi fields list` for metadata",
            "Run `manychat-axi setup hooks` for ambient session context",
        ],
    }, json);
}
