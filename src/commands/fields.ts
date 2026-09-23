import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import {
  forbidExtraPositionals,
  oneOf,
  parseFlags,
  requirePositional,
  type FlagDefinition,
} from "../lib/args.js";
import { renderResult } from "../lib/output.js";
import { snippet } from "../lib/truncate.js";
import { requireApiKey } from "../lib/guard.js";
import type { CommandContext } from "../context.js";
import {
  FIELD_TYPES,
  type FieldDef,
  type FieldTypeName,
} from "../publicapi/client.js";

export const FIELDS_HELP = `manychat-axi fields - custom user fields and bot fields

subcommands:
  fields list                 field definitions (scope, id, name, type)
  fields ensure <name>        create a field if missing; no-op if it exists

flags:
  --type <t>                  (ensure, required) text | number | date | datetime | boolean
  --description <text>        (ensure) optional description
  --scope <scope>             user | bot (default user; list also accepts all)
  --confirm                   (ensure) allow the create when the field is missing
  --json                      machine-readable JSON instead of TOON

ensure is idempotent by exact name within the chosen scope. An existing
field with a different type stops loudly - ManyChat cannot change a field's
type after creation.

examples:
  manychat-axi fields list
  manychat-axi fields list --scope bot
  manychat-axi fields ensure "episode" --type number --confirm`;

const LIST_FLAGS: Record<string, FlagDefinition> = {
  scope: { type: "string" },
  json: { type: "boolean" },
};

const ENSURE_FLAGS: Record<string, FlagDefinition> = {
  type: { type: "string" },
  description: { type: "string" },
  scope: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const NAME_SNIPPET = 60;

export async function fieldsCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  if (sub === undefined) {
    return { help_text: FIELDS_HELP };
  }
  if (sub === "list") {
    return listFields(args.slice(1), ctx);
  }
  if (sub === "ensure") {
    return ensureField(args.slice(1), ctx);
  }
  throw new AxiError(`fields: unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
    "Implemented: `fields list`, `fields ensure <name> --type <t>`",
    "Run `manychat-axi fields --help` for the reference",
  ]);
}

async function listFields(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "manychat-axi fields list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
  const json = values["json"] === true;
  const scope = oneOf(values, "scope", ["user", "bot", "all"] as const) ?? "all";

  requireApiKey(ctx.config, commandPath);
  const [user, bot] = await Promise.all([
    scope === "bot" ? Promise.resolve([]) : ctx.client.getCustomFields(),
    scope === "user" ? Promise.resolve([]) : ctx.client.getBotFields(),
  ]);

  const rows = [
    ...user.map(toRow("user")),
    ...bot.map(toRow("bot")),
  ].sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));

  const out: Record<string, unknown> = {
    fields: {
      count: rows.length,
      ...(scope !== "all" ? { scope } : { user: user.length, bot: bot.length }),
    },
    list: rows,
    help: [
      "Run `manychat-axi fields ensure <name> --type <t> --confirm` to create a missing field",
      "Run `manychat-axi tags list` for the tag inventory",
    ],
  };
  if (rows.length === 0) {
    out["result"] = scope === "all" ? "0 fields" : `0 ${scope} fields`;
    out["help"] = [
      "Run `manychat-axi fields ensure <name> --type <t> --confirm` to create the first field",
    ];
  }
  return renderResult(out, json);
}

async function ensureField(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "manychat-axi fields ensure";
  const { values, positionals } = parseFlags(args, commandPath, ENSURE_FLAGS);
  const json = values["json"] === true;
  const name = requirePositional(positionals, 0, "name", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const scope = oneOf(values, "scope", ["user", "bot"] as const) ?? "user";

  const type = oneOf(values, "type", FIELD_TYPES);
  if (type === undefined) {
    throw new AxiError(`fields ensure requires --type (${FIELD_TYPES.join(" | ")})`, "VALIDATION_ERROR", [
      `Would create ${scope} field "${name}"`,
      `Rerun with --type <${FIELD_TYPES.join("|")}> and --confirm to apply`,
    ]);
  }
  const description =
    typeof values["description"] === "string" && values["description"].trim().length > 0
      ? values["description"].trim()
      : undefined;

  requireApiKey(ctx.config, commandPath);
  const existing = scope === "user" ? await ctx.client.getCustomFields() : await ctx.client.getBotFields();
  const match = existing.find((field) => field.name === name);

  if (match) {
    if (match.type !== type) {
      throw new AxiError(
        `fields ensure: ${scope} field "${match.name}" already exists with type ${match.type}, not ${type}`,
        "VALIDATION_ERROR",
        [
          "ManyChat cannot change a field's type after creation",
          `Use the existing field as-is, or create a differently named field: \`manychat-axi fields ensure "${name} v2" --type ${type} --confirm\``,
        ],
      );
    }
    return renderResult(
      {
        field: { scope, id: match.id, name: match.name, type: match.type },
        action: "none",
        result: `${scope} field already exists: ${match.name}`,
        help: ["No mutation was made"],
      },
      json,
    );
  }

  const near = existing.find(
    (field) => field.name.toLowerCase() === name.toLowerCase() && field.name !== name,
  );
  if (near) {
    throw new AxiError(
      `fields ensure: ${scope} field "${near.name}" already exists (different casing than "${name}")`,
      "VALIDATION_ERROR",
      [
        `Rerun with the exact existing name if it is the field you meant: ${near.name} (id ${near.id})`,
      ],
    );
  }

  if (values["confirm"] !== true) {
    throw new AxiError(
      `fields ensure requires --confirm to create ${scope} field "${name}"`,
      "VALIDATION_ERROR",
      [`Would create ${scope} field "${name}" (${type})`, "Rerun with --confirm to apply"],
    );
  }

  const created =
    scope === "user"
      ? await ctx.client.createCustomField({ caption: name, type, description })
      : await ctx.client.createBotField({ caption: name, type, description });
  return renderResult(
    {
      field: { scope, id: created.id, name: created.name, type: created.type },
      action: "created",
      result: `${scope} field created: ${created.name}`,
      help: ["Verify with `manychat-axi fields list` if needed"],
    },
    json,
  );
}

function toRow(scope: "user" | "bot") {
  return (field: FieldDef) => ({
    scope,
    id: field.id,
    name: snippet(field.name, NAME_SNIPPET) ?? "",
    type: field.type,
  });
}
