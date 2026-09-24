import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { parseFlags, requireString, type FlagDefinition } from "../lib/args.js";
import { renderResult } from "../lib/output.js";
import { resolveAccount } from "../config/projectConfig.js";
import { createRunDir } from "../browser/artifacts.js";
import type { CommandContext } from "../context.js";
import { parseSpec, specSummary, type DeploySpec } from "../template/spec.js";
import {
  deployTarget,
  planTarget,
  type DeployDeps,
  type TargetResult,
  type TargetTemplateConfig,
} from "../template/deploy.js";

export const TEMPLATE_HELP = `manychat-axi template - registry-driven deployment from canonical templates

subcommands:
  template list                registered templates (name, kind, account, ns)
  template deploy --spec <f>   plan (default) or deploy (--confirm) a spec

flags (deploy):
  --spec <file>             spec YAML path (required)
  --confirm                 execute the plan: clone, rename, tag ensure,
                            patch hook/url/tag, set trigger keywords, verify
  --only <target>           deploy a single target from the spec's list
  --timeout <ms>            wait for manual login when signed out (default: fail fast)
  --json                    machine-readable JSON instead of TOON

Without --confirm the command is a pure preview: it reads the templates and
tag inventory (browser + public API reads) and prints the full plan with
zero mutations. With --confirm it deploys each target sequentially and
stops at the first failure. Deploys never publish: duplicates stay drafts
with inactive triggers. Publishing arrives as a separate gated command.

examples:
  manychat-axi template list
  manychat-axi template deploy --spec manychat/specs/ep167.yaml
  manychat-axi template deploy --spec manychat/specs/ep167.yaml --confirm`;

const LIST_FLAGS: Record<string, FlagDefinition> = {
  json: { type: "boolean" },
};

const DEPLOY_FLAGS: Record<string, FlagDefinition> = {
  spec: { type: "string" },
  confirm: { type: "boolean" },
  only: { type: "string" },
  timeout: { type: "string" },
  json: { type: "boolean" },
};

export async function templateCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  if (sub === undefined) {
    return { help_text: TEMPLATE_HELP };
  }
  if (sub === "list") return listTemplates(args.slice(1), ctx);
  if (sub === "deploy") return deploy(args.slice(1), ctx);
  throw new AxiError(`template: unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
    "Implemented: `template list`, `template deploy --spec <file>`",
    "Run `manychat-axi template --help` for the reference",
  ]);
}

async function listTemplates(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "manychat-axi template list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
  const json = values["json"] === true;

  if (!ctx.projectConfig || Object.keys(ctx.projectConfig.templates).length === 0) {
    return renderResult(
      {
        result: "0 templates registered",
        help: [
          "Add templates to manychat/config.yaml (see docs/templates.md)",
          "Run `manychat-axi flows list` to find candidate template nss",
        ],
      },
      json,
    );
  }

  const rows = Object.entries(ctx.projectConfig.templates).map(([name, template]) => ({
    template: name,
    kind: template.kind ?? "-",
    account: template.account ?? ctx.projectConfig?.defaultAccount ?? "-",
    ns: template.ns,
  }));
  rows.sort((a, b) => a.template.localeCompare(b.template));
  return renderResult(
    {
      templates: { count: rows.length },
      list: rows,
      help: [
        "Deploy with `manychat-axi template deploy --spec <file>`",
        "Slot maps per kind: docs/templates.md",
      ],
    },
    json,
  );
}

interface TemplateAndAccount {
  config: TargetTemplateConfig;
  keyEnv: string;
}

function resolveTemplate(ctx: CommandContext, templateName: string, spec: DeploySpec): TemplateAndAccount {
  if (!ctx.projectConfig) {
    throw new AxiError("no project config - create manychat/config.yaml first (see README)", "VALIDATION_ERROR");
  }
  const template = ctx.projectConfig.templates[templateName];
  if (!template) {
    throw new AxiError(
      `unknown template target: ${templateName} (registered: ${Object.keys(ctx.projectConfig.templates).join(", ") || "none"})`,
      "VALIDATION_ERROR",
    );
  }
  const account = resolveAccount(ctx.projectConfig, template.account, ctx.env);
  if (!account.apiKey) {
    throw new AxiError(
      `account ${account.name} has no API key (expected ${account.keyEnv} or MANYCHAT_API_KEY)`,
      "VALIDATION_ERROR",
      ["Deploy needs the account's public API for tag and conflict checks"],
    );
  }
  const kind = template.kind ?? "unknown";
  if (kind.startsWith("podcast") && spec.episode === undefined) {
    throw new AxiError(`target ${templateName} (kind ${kind}) requires 'episode' in the spec`, "VALIDATION_ERROR");
  }
  if (kind.startsWith("article") && spec.title === undefined) {
    throw new AxiError(`target ${templateName} (kind ${kind}) requires 'title' in the spec`, "VALIDATION_ERROR");
  }
  return {
    config: {
      template: templateName,
      ns: template.ns,
      ...(template.kind ? { kind: template.kind } : {}),
      account: account.name,
      page: account.page,
      apiKey: account.apiKey,
      ...(template.namePattern ? { namePattern: template.namePattern } : {}),
      ...(template.staticUrls ? { staticUrls: template.staticUrls } : {}),
    },
    keyEnv: account.keyEnv,
  };
}

async function deploy(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "manychat-axi template deploy";
  const { values } = parseFlags(args, commandPath, DEPLOY_FLAGS);
  const json = values["json"] === true;
  const specPath = requireString(values, "spec", commandPath);
  if (!specPath) {
    throw new AxiError("template deploy requires --spec <file>", "VALIDATION_ERROR", [
      "Run `manychat-axi template --help` for the spec format",
    ]);
  }
  const only = requireString(values, "only", commandPath);
  const confirm = values["confirm"] === true;
  const loginTimeoutMs = parsePositiveInt(values["timeout"]) ?? 0;

  let specText: string;
  try {
    specText = readFileSync(specPath, "utf8");
  } catch (error) {
    throw new AxiError(
      `cannot read spec ${specPath}: ${error instanceof Error ? error.message : String(error)}`,
      "VALIDATION_ERROR",
    );
  }
  const spec = parseSpec(specText, specPath);
  const targets = only ? spec.targets.filter((target) => target === only) : spec.targets;
  if (targets.length === 0) {
    throw new AxiError(
      only ? `--only ${only} matches no target in the spec (${spec.targets.join(", ")})` : "spec has no targets",
      "VALIDATION_ERROR",
    );
  }

  const resolved = targets.map((target) => resolveTemplate(ctx, target, spec));
  const deps: DeployDeps = {
    withApp: (opts, fn) =>
      ctx.browser.withApp({ ...opts, loginTimeoutMs: opts.loginTimeoutMs || loginTimeoutMs }, fn),
    publicClientFor: (apiKey) => ctx.publicClientFor(apiKey),
    stateDir: ctx.stateDir,
  };

  const plans = [];
  for (const { config } of resolved) {
    plans.push({
      config,
      plan: await planTarget(spec, config, deps),
    });
  }

  const specHash = createHash("sha256")
    .update(JSON.stringify(specSummary(spec)))
    .digest("hex")
    .slice(0, 16);

  if (!confirm) {
    return renderResult(
      {
        deploy: {
          spec: specPath,
          spec_hash: specHash,
          mode: "preview (zero mutations)",
          targets: plans.map(({ plan }) => ({
            template: plan.template,
            account: plan.account,
            name: plan.name,
            clone_from: plan.templateNs,
            keywords: plan.keywords,
            hook: `${plan.hook.slice(0, 80)}${plan.hook.length > 80 ? "…" : ""}`,
            url: plan.url,
            tag: plan.tagId !== undefined ? `${plan.tagName} #${plan.tagId}` : `${plan.tagName} (will create)`,
            ...(plan.conflict ? { conflict: plan.conflict } : {}),
          })),
        },
        help: [
          "Rerun with --confirm to deploy (drafts only, never publishes)",
          ...(plans.some(({ plan }) => plan.conflict)
            ? ["Resolve name conflicts first - conflicting targets will stop the deploy"]
            : []),
        ],
      },
      json,
    );
  }

  // Execute sequentially; stop at the first failure.
  const run = createRunDir(ctx.stateDir, "deploy");
  const results: TargetResult[] = [];
  let failed = false;
  for (const { config, plan } of plans) {
    if (failed) {
      results.push({
        template: plan.template,
        account: plan.account,
        name: plan.name,
        stages: ["skipped"],
        status: "failed",
        error: "skipped: earlier target failed",
      });
      continue;
    }
    try {
      results.push(await deployTarget(plan, spec, deps, config));
      if (results[results.length - 1]?.status !== "deployed") failed = true;
    } catch (error) {
      failed = true;
      results.push({
        template: plan.template,
        account: plan.account,
        name: plan.name,
        stages: ["failed"],
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  mkdirSync(run.dir, { recursive: true });
  writeFileSync(
    join(run.dir, "journal.json"),
    `${JSON.stringify({ spec: specSummary(spec), specHash, startedAt: new Date().toISOString(), results }, null, 2)}\n`,
    "utf8",
  );

  const deployedCount = results.filter((result) => result.status === "deployed").length;
  const out: Record<string, unknown> = {
    deploy: {
      spec: specPath,
      spec_hash: specHash,
      run: run.dir,
      result: `${deployedCount}/${results.length} targets deployed`,
      targets: results.map((result) => ({
        template: result.template,
        account: result.account,
        name: result.name,
        ...(result.ns ? { ns: result.ns } : {}),
        status: result.status,
        ...(result.stages.length > 0 ? { stages: result.stages } : {}),
        ...(result.verified ? { verified: result.verified } : {}),
        ...(result.error ? { error: result.error } : {}),
      })),
    },
    help: [
      "Inspect with `manychat-axi flows get <ns> --full`",
      "Triggers stay inactive - publishing arrives as a separate gated command",
    ],
  };
  if (failed && deployedCount === 0) {
    out["error_hint"] = "All targets failed - see errors above and the journal";
  }
  return renderResult(out, json);
}

function parsePositiveInt(value: string | boolean | string[] | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  if (!/^\d+$/.test(value.trim())) {
    throw new AxiError(`--timeout requires an integer, got: ${value}`, "VALIDATION_ERROR");
  }
  return Number(value.trim());
}
