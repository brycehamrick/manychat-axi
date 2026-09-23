import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import {
  forbidExtraPositionals,
  parseFlags,
  requirePositional,
  type FlagDefinition,
} from "../lib/args.js";
import { renderResult } from "../lib/output.js";
import { snippet } from "../lib/truncate.js";
import { requireApiKey } from "../lib/guard.js";
import type { CommandContext } from "../context.js";
import type { Tag } from "../publicapi/client.js";

export const TAGS_HELP = `manychat-axi tags - tag inventory and idempotent creation

subcommands:
  tags list                 all tags (id, name)
  tags ensure <name>        create a tag if missing; no-op if it exists

flags:
  --confirm                 (ensure) allow the create when the tag is missing
  --json                    machine-readable JSON instead of TOON

ensure is idempotent: an exact-name match reports the existing tag with no
mutation and no --confirm needed. A case-insensitive match stops loudly
instead of creating a near-duplicate. Creating a missing tag requires
--confirm.

examples:
  manychat-axi tags list
  manychat-axi tags ensure "Podcast | EP166 | Clicked"
  manychat-axi tags ensure "Podcast | EP166 | Clicked" --confirm`;

const LIST_FLAGS: Record<string, FlagDefinition> = {
  json: { type: "boolean" },
};

const ENSURE_FLAGS: Record<string, FlagDefinition> = {
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const NAME_SNIPPET = 60;

export async function tagsCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  if (sub === undefined) {
    return { help_text: TAGS_HELP };
  }
  if (sub === "list") {
    return listTags(args.slice(1), ctx);
  }
  if (sub === "ensure") {
    return ensureTag(args.slice(1), ctx);
  }
  throw new AxiError(`tags: unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
    "Implemented: `tags list`, `tags ensure <name>`",
    "Run `manychat-axi tags --help` for the reference",
  ]);
}

async function listTags(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "manychat-axi tags list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
  const json = values["json"] === true;

  requireApiKey(ctx.config, commandPath);
  const tags = await ctx.client.getTags();
  const rows = tags
    .map((tag) => ({ id: tag.id, name: snippet(tag.name, NAME_SNIPPET) ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

  const out: Record<string, unknown> = {
    tags: { count: rows.length },
    list: rows,
    help: [
      "Run `manychat-axi tags ensure <name> --confirm` to create a missing tag",
      "Run `manychat-axi fields list` for field definitions",
    ],
  };
  if (rows.length === 0) {
    out["result"] = "0 tags";
    out["help"] = ["Run `manychat-axi tags ensure <name> --confirm` to create the first tag"];
  }
  return renderResult(out, json);
}

async function ensureTag(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "manychat-axi tags ensure";
  const { values, positionals } = parseFlags(args, commandPath, ENSURE_FLAGS);
  const json = values["json"] === true;
  const name = requirePositional(positionals, 0, "name", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);

  requireApiKey(ctx.config, commandPath);
  const tags = await ctx.client.getTags();
  const existing = findTag(tags, name);

  if (existing) {
    return renderResult(
      {
        tag: { id: existing.id, name: existing.name },
        action: "none",
        result: `tag already exists: ${existing.name}`,
        help: ["No mutation was made", "Use the id above when referencing this tag in later phases"],
      },
      json,
    );
  }

  const near = tags.find(
    (tag) => tag.name.toLowerCase() === name.toLowerCase() && tag.name !== name,
  );
  if (near) {
    throw new AxiError(
      `tags ensure: tag "${near.name}" already exists (different casing than "${name}")`,
      "VALIDATION_ERROR",
      [
        `Rerun with the exact existing name if it is the tag you meant: ${near.name} (id ${near.id})`,
        "ManyChat tags are name-unique; a near-duplicate would split your audience",
      ],
    );
  }

  if (values["confirm"] !== true) {
    throw new AxiError(
      `tags ensure requires --confirm to create tag "${name}"`,
      "VALIDATION_ERROR",
      [`Would create tag "${name}"`, "Rerun with --confirm to apply"],
    );
  }

  const created = await ctx.client.createTag(name);
  return renderResult(
    {
      tag: { id: created.id, name: created.name },
      action: "created",
      result: `tag created: ${created.name}`,
      help: ["Verify with `manychat-axi tags list` if needed"],
    },
    json,
  );
}

function findTag(tags: Tag[], name: string): Tag | undefined {
  return tags.find((tag) => tag.name === name);
}
