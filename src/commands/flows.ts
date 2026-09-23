import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { parseFlags, type FlagDefinition } from "../lib/args.js";
import { renderResult } from "../lib/output.js";
import { snippet } from "../lib/truncate.js";
import { requireApiKey } from "../lib/guard.js";
import type { CommandContext } from "../context.js";

export const FLOWS_HELP = `manychat-axi flows - automation inventory

subcommands:
  flows list               all automations (ns, name, folder)

flags (list):
  --folder <name>          keep only flows in one folder (case-insensitive)
  --json                   machine-readable JSON instead of TOON

The ns column is the automation namespace - the stable identifier that
Phase 1+ content commands (flows get/pull/diff/push) will accept. The public
API returns inventory only (ns, name, folder); flow content lives in the
Flow Builder and needs the browser transport.

examples:
  manychat-axi flows list
  manychat-axi flows list --folder Podcast`;

const LIST_FLAGS: Record<string, FlagDefinition> = {
  folder: { type: "string" },
  json: { type: "boolean" },
};

const NAME_SNIPPET = 80;

interface FlowRow {
  ns: string;
  name: string;
  folder: string;
}

export async function flowsCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  if (sub === undefined) {
    return { help_text: FLOWS_HELP };
  }
  if (sub !== "list") {
    throw new AxiError(`flows: unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
      "Implemented: `flows list`",
      "Content commands (get, pull, diff, push) need the browser transport, arriving Phase 1+",
      "Run `manychat-axi flows --help` for the reference",
    ]);
  }

  const commandPath = "manychat-axi flows list";
  const { values } = parseFlags(args.slice(1), commandPath, LIST_FLAGS);
  const json = values["json"] === true;
  const folderFilter =
    typeof values["folder"] === "string" && values["folder"].trim().length > 0
      ? values["folder"].trim()
      : undefined;

  requireApiKey(ctx.config, commandPath);
  const inventory = await ctx.client.getFlows();
  const folderNameById = new Map<number, string>(
    inventory.folders.map((folder) => [folder.id, folder.name]),
  );

  const allRows: FlowRow[] = inventory.flows.map((flow) => ({
    ns: flow.ns,
    name: snippet(flow.name, NAME_SNIPPET) ?? "",
    folder: (flow.folderId !== null ? folderNameById.get(flow.folderId) : undefined) ?? "-",
  }));
  allRows.sort((a, b) => a.name.localeCompare(b.name) || a.ns.localeCompare(b.ns));

  const rows = folderFilter
    ? allRows.filter((row) => row.folder.toLowerCase() === folderFilter.toLowerCase())
    : allRows;

  const out: Record<string, unknown> = {
    flows: {
      count: rows.length,
      ...(folderFilter ? { folder: folderFilter } : {}),
      ...(!folderFilter ? { folders: inventory.folders.length } : {}),
    },
    list: rows,
    help: [
      "Copy an ns for Phase 1+ content commands (flows get/pull/diff/push)",
      "Run `manychat-axi tags list` or `manychat-axi fields list` for account metadata",
    ],
  };
  if (rows.length === 0) {
    out["result"] = folderFilter
      ? `0 flows in folder "${folderFilter}"`
      : "0 flows";
    out["help"] = [
      folderFilter
        ? "Run `manychat-axi flows list` without --folder to see every automation"
        : "Create automations in ManyChat, or wait for Phase 2 template deploy",
    ];
  }
  return renderResult(out, json);
}
