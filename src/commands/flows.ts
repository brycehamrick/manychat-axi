import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import {
  forbidExtraPositionals,
  optionalInt,
  parseFlags,
  requirePositional,
  type FlagDefinition,
} from "../lib/args.js";
import { renderResult } from "../lib/output.js";
import { snippet } from "../lib/truncate.js";
import { requireApiKey } from "../lib/guard.js";
import { resolveAccount } from "../config/projectConfig.js";
import { summarizeFlowDocument } from "../flows/model.js";
import type { CommandContext } from "../context.js";

export const FLOWS_HELP = `manychat-axi flows - automation inventory and content

subcommands:
  flows list               inventory from the public API (ns, name, folder)
  flows get <ns>           flow content via the browser session (canonical view)

flags (list):
  --folder <name>          keep only flows in one folder (case-insensitive)

flags (get):
  --account <name>         account from manychat/config.yaml (default: defaultAccount)
  --page <fb-id>           page segment override, e.g. fb1071254 (rarely needed)
  --full                   include the complete raw flow document
  --timeout <ms>           wait for manual login when signed out (default: fail fast)
  --json                   machine-readable JSON instead of TOON

flows get opens the persistent browser briefly and reads the flow document
through the authenticated session (getFlowData), summarizing nodes, buttons,
actions, and trigger-widget keywords. Use the ns from \`flows list\`.

examples:
  manychat-axi flows list
  manychat-axi flows list --folder Podcast
  manychat-axi flows get content20260922154445_584682 --account brighten`;

const LIST_FLAGS: Record<string, FlagDefinition> = {
  folder: { type: "string" },
  json: { type: "boolean" },
};

const GET_FLAGS: Record<string, FlagDefinition> = {
  account: { type: "string" },
  page: { type: "string" },
  full: { type: "boolean" },
  timeout: { type: "string" },
  json: { type: "boolean" },
};

const NAME_SNIPPET = 80;

interface FlowRow {
  ns: string;
  name: string;
  folder: string;
}

async function listFlows(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "manychat-axi flows list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
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
      "Run `manychat-axi flows get <ns>` to read a flow's content",
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
        : "Create automations in ManyChat, or wait for template deploy",
    ];
  }
  return renderResult(out, json);
}

async function getFlow(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "manychat-axi flows get";
  const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
  const json = values["json"] === true;
  const ns = requirePositional(positionals, 0, "ns", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const full = values["full"] === true;
  const loginTimeoutMs =
    optionalInt(values, "timeout", { min: 10_000, max: 3_600_000 }) ?? 0;

  const pageOverride =
    typeof values["page"] === "string" && /^fb\d+$/.test(values["page"].trim())
      ? values["page"].trim()
      : undefined;
  if (values["page"] !== undefined && !pageOverride) {
    throw new AxiError(
      `--page must look like fb1071254, got: ${String(values["page"])}`,
      "VALIDATION_ERROR",
    );
  }
  const accountName = typeof values["account"] === "string" ? values["account"] : undefined;
  const account = pageOverride
    ? { name: accountName ?? "ad-hoc", page: pageOverride }
    : resolveAccount(ctx.projectConfig, accountName, ctx.env);

  const doc = await ctx.browser.withApp(
    { page: account.page, stateDir: ctx.stateDir, loginTimeoutMs },
    async (api) => api.getFlowData(ns),
  );
  const summary = summarizeFlowDocument(doc);

  const out: Record<string, unknown> = {
    account: account.name,
    flow: {
      ns: summary.ns,
      name: summary.name,
      status: summary.status,
      has_unpublished_changes: summary.hasUnpublishedChanges,
      nodes: summary.nodeCount,
      root_content_id: summary.rootContentId,
    },
    triggers: summary.widgets.length > 0 ? summary.widgets : { result: "0 trigger widgets" },
    contents: summary.nodes.map((node) => ({
      id: node.contentId,
      type: node.type,
      caption: node.caption,
      ...(node.text ? { text: snippet(node.text, 200) ?? "" } : {}),
      ...(node.buttons.length > 0 ? { buttons: node.buttons } : {}),
      ...(node.actions.length > 0 ? { actions: node.actions } : {}),
      ...(node.nextContentId !== undefined ? { next: node.nextContentId } : {}),
    })),
    ...(full ? { raw: doc } : {}),
    help: [
      ...(full ? [] : ["Rerun with --full for the complete raw document"]),
      "Trigger keywords live in the widget; edit via template deploy (later phase)",
    ],
  };
  if (summary.nodes.some((node) => node.text && node.text.length > 200)) {
    out["help"] = [
      "Node text truncated at 200 chars - rerun with --full for complete text",
      ...(out["help"] as string[]),
    ];
  }
  return renderResult(out, json);
}

export async function flowsCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  if (sub === undefined) {
    return { help_text: FLOWS_HELP };
  }
  if (sub === "list") {
    return listFlows(args.slice(1), ctx);
  }
  if (sub === "get") {
    return getFlow(args.slice(1), ctx);
  }
  throw new AxiError(`flows: unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
    "Implemented: `flows list`, `flows get <ns>`",
    "Pull/diff/push (flow-as-code) arrive in a later phase",
    "Run `manychat-axi flows --help` for the reference",
  ]);
}
