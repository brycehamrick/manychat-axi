import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { parseFlags, type FlagDefinition } from "../lib/args.js";
import { renderResult } from "../lib/output.js";
import { errorMessage } from "../lib/guard.js";
import type { CommandContext } from "../context.js";

export const AUTH_HELP = `manychat-axi auth - credential state for both transports

subcommands:
  auth status      report the public API key state and the browser transport

auth login and auth logout manage the browser session (persistent Playwright
profile) and arrive with the Phase 1 browser transport. Flow-content commands
(flows get/pull/diff/push, template deploy) depend on that session.

auth: MANYCHAT_API_KEY env var only - generate it in ManyChat Settings -> API.
Never pass the key as a flag, store it in files, or paste it into chat.

examples:
  manychat-axi auth status`;

const AUTH_FLAGS: Record<string, FlagDefinition> = {
  json: { type: "boolean" },
};

export async function authCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  if (sub === undefined) {
    return { help_text: AUTH_HELP };
  }
  if (sub !== "status") {
    throw new AxiError(`auth: unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
      "Implemented: `auth status`",
      "`auth login` / `auth logout` manage the browser session and arrive in Phase 1",
      "Run `manychat-axi auth --help` for the reference",
    ]);
  }
  const commandPath = "manychat-axi auth status";
  const { values } = parseFlags(args.slice(1), commandPath, AUTH_FLAGS);
  const json = values["json"] === true;

  if (!ctx.config.apiKey) {
    return renderResult(
      {
        auth: {
          api_key: { configured: false, valid: null },
          browser_session: { status: "phase 1 (not yet available)" },
        },
        help: [
          "Export MANYCHAT_API_KEY (ManyChat Settings -> API) to enable data commands",
          "Run `manychat-axi` for the home dashboard once configured",
        ],
      },
      json,
    );
  }

  try {
    const page = await ctx.client.getInfo();
    return renderResult(
      {
        auth: {
          api_key: { configured: true, valid: true, page: page.name, page_id: page.id },
          browser_session: { status: "phase 1 (not yet available)" },
        },
        help: [
          "Run `manychat-axi flows list` to see the automation inventory",
          "Run `manychat-axi` for the home dashboard",
        ],
      },
      json,
    );
  } catch (error) {
    return renderResult(
      {
        auth: {
          api_key: {
            configured: true,
            valid: false,
            error: errorMessage(error, ctx.config.apiKey),
          },
          browser_session: { status: "phase 1 (not yet available)" },
        },
        help: [
          "Generate a fresh key in ManyChat Settings -> API and export MANYCHAT_API_KEY",
          "Run `manychat-axi auth status` again to verify",
        ],
      },
      json,
    );
  }
}
