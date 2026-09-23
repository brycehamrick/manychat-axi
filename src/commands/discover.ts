import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import {
  forbidExtraPositionals,
  optionalInt,
  parseFlags,
  requireHttpUrl,
  type FlagDefinition,
} from "../lib/args.js";
import { renderResult } from "../lib/output.js";
import { requireApiKey } from "../lib/guard.js";
import type { CommandContext } from "../context.js";

export const DISCOVER_HELP = `manychat-axi discover - record a manual Flow Builder session (dev command)

flags:
  --url <url>            starting URL (default https://app.manychat.com/)
  --timeout <ms>         max wait for manual login (default 300000)
  --max-wait <ms>        max recording time before auto-finish (default 3600000)
  --json                 machine-readable JSON instead of TOON

Opens the persistent headed browser, starts a Playwright trace, and records
every ManyChat XHR/JSON exchange - including flow-document bodies, with
credential-shaped keys redacted - while you manually demonstrate the template
workflow (open, duplicate, rename, edit keyword / DM / URL / tag, save,
publish). Press Enter in the terminal to finish.

Artifacts land in ~/.manychat-axi/runs/discover-<id>/:
  trace.zip             full Playwright trace (screenshots + DOM snapshots)
  network.json          redacted exchange log with sizes and status codes
  documents/            captured JSON bodies (flow documents)
  console-errors.txt    page console errors, when any
  final-screenshot.png  last visible state
  aria.yml, dom.html    sanitized final snapshots
  index.json            artifact index

This is a development command: its output feeds selector and canonical-model
work, not the agent surface.

examples:
  manychat-axi discover
  manychat-axi discover --url https://app.manychat.com/#/flow-builder`;

const DISCOVER_FLAGS: Record<string, FlagDefinition> = {
  url: { type: "string" },
  timeout: { type: "string" },
  "max-wait": { type: "string" },
  json: { type: "boolean" },
};

export async function discoverCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "manychat-axi discover";
  const { values, positionals } = parseFlags(args, commandPath, DISCOVER_FLAGS);
  const json = values["json"] === true;
  forbidExtraPositionals(positionals, 0, commandPath);

  requireApiKey(ctx.config, commandPath);
  const url = requireHttpUrl(
    typeof values["url"] === "string" && values["url"].trim().length > 0
      ? values["url"].trim()
      : "https://app.manychat.com/",
    "--url",
  );
  if (!/^(app\.|www\.)?manychat\.com$/i.test(new URL(url).hostname)) {
    throw new AxiError(
      `--url must target manychat.com, got ${new URL(url).hostname}`,
      "VALIDATION_ERROR",
      ["Discovery records ManyChat Flow Builder traffic only"],
    );
  }

  const loginTimeoutMs =
    optionalInt(values, "timeout", { min: 10_000, max: 3_600_000 }) ?? 300_000;
  const maxWaitMs =
    optionalInt(values, "max-wait", { min: 1_000, max: 86_400_000 }) ?? 3_600_000;

  const result = await ctx.browser.discover({
    stateDir: ctx.stateDir,
    url,
    loginTimeoutMs,
    maxWaitMs,
  });

  return renderResult(
    {
      discover: {
        run: result.runDir,
        url: result.url,
        network: {
          exchanges: result.exchanges.length,
          documents: result.documentCount,
          console_errors: result.consoleErrors.length,
        },
        artifacts: result.files,
      },
      help: [
        "Point your agent at the run directory to derive selectors and the flow-document schema",
        "Record the canonical template ns with `manychat-axi flows list --folder Podcasts`",
      ],
    },
    json,
  );
}
