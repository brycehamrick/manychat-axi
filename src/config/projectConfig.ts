import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { AxiError } from "axi-sdk-js";

/**
 * Project configuration: ./manychat/config.yaml. Human-authored, committed
 * to the project repo, contains no secrets - API keys stay in the
 * environment (MANYCHAT_API_KEY__<ACCOUNT> or plain MANYCHAT_API_KEY for
 * the default account).
 */

export interface AccountConfig {
  /** ManyChat page segment used in app URLs, e.g. "fb1071254". */
  page: string;
}

export interface TemplateConfig {
  /** Account name; defaults to defaultAccount. */
  account?: string;
  /** Canonical template automation namespace. */
  ns: string;
  /** Registry key hint, e.g. "podcast" or "article". */
  kind?: string;
}

export interface ProjectConfig {
  version: number;
  defaultAccount?: string;
  accounts: Record<string, AccountConfig>;
  templates: Record<string, TemplateConfig>;
}

export const CONFIG_PATH = ["manychat", "config.yaml"] as const;

export function configFilePath(cwd: string = process.cwd()): string {
  return join(cwd, ...CONFIG_PATH);
}

export function parseProjectConfig(text: string, origin: string): ProjectConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw new AxiError(`invalid YAML in ${origin}: ${error instanceof Error ? error.message : String(error)}`, "VALIDATION_ERROR");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new AxiError(`${origin} must be a YAML mapping`, "VALIDATION_ERROR");
  }
  const root = raw as Record<string, unknown>;
  if (root["version"] !== 1) {
    throw new AxiError(`${origin}: version must be 1`, "VALIDATION_ERROR");
  }
  const accountsRaw = root["accounts"] ?? {};
  if (typeof accountsRaw !== "object" || accountsRaw === null) {
    throw new AxiError(`${origin}: accounts must be a mapping`, "VALIDATION_ERROR");
  }
  const accounts: Record<string, AccountConfig> = {};
  for (const [name, value] of Object.entries(accountsRaw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) {
      throw new AxiError(`${origin}: accounts.${name} must be a mapping with a page`, "VALIDATION_ERROR");
    }
    const page = (value as Record<string, unknown>)["page"];
    if (typeof page !== "string" || !/^fb\d+$/.test(page)) {
      throw new AxiError(
        `${origin}: accounts.${name}.page must look like fb1071254 (fb + digits)`,
        "VALIDATION_ERROR",
      );
    }
    accounts[name] = { page };
  }
  const templatesRaw = root["templates"] ?? {};
  if (typeof templatesRaw !== "object" || templatesRaw === null) {
    throw new AxiError(`${origin}: templates must be a mapping`, "VALIDATION_ERROR");
  }
  const templates: Record<string, TemplateConfig> = {};
  for (const [name, value] of Object.entries(templatesRaw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) {
      throw new AxiError(`${origin}: templates.${name} must be a mapping with an ns`, "VALIDATION_ERROR");
    }
    const entry = value as Record<string, unknown>;
    const ns = entry["ns"];
    if (typeof ns !== "string" || ns.trim().length === 0) {
      throw new AxiError(`${origin}: templates.${name}.ns must be a non-empty string`, "VALIDATION_ERROR");
    }
    const account = typeof entry["account"] === "string" ? entry["account"] : undefined;
    if (account !== undefined && !(account in accounts)) {
      throw new AxiError(
        `${origin}: templates.${name}.account "${account}" is not defined in accounts`,
        "VALIDATION_ERROR",
      );
    }
    const kind = typeof entry["kind"] === "string" ? entry["kind"] : undefined;
    templates[name] = { ns, ...(account ? { account } : {}), ...(kind ? { kind } : {}) };
  }
  const defaultAccount =
    typeof root["defaultAccount"] === "string" ? root["defaultAccount"] : undefined;
  if (defaultAccount !== undefined && !(defaultAccount in accounts)) {
    throw new AxiError(
      `${origin}: defaultAccount "${defaultAccount}" is not defined in accounts`,
      "VALIDATION_ERROR",
    );
  }
  return { version: 1, ...(defaultAccount ? { defaultAccount } : {}), accounts, templates };
}

export function loadProjectConfig(cwd: string = process.cwd()): ProjectConfig | null {
  const path = configFilePath(cwd);
  if (!existsSync(path)) return null;
  return parseProjectConfig(readFileSync(path, "utf8"), path);
}

/** "podcast-fb" -> MANYCHAT_API_KEY__PODCAST_FB */
export function apiKeyEnvName(account: string): string {
  return `MANYCHAT_API_KEY__${account.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

export interface ResolvedAccount {
  name: string;
  page: string;
  /** Environment variable the public API key for this account lives in. */
  keyEnv: string;
  /** Key from the environment, if any (account-specific or the default). */
  apiKey?: string;
}

export function resolveAccount(
  config: ProjectConfig | null,
  name: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAccount {
  const accountName = name ?? config?.defaultAccount;
  if (!config || Object.keys(config.accounts).length === 0) {
    throw new AxiError(
      "no accounts configured - create manychat/config.yaml with an accounts mapping (see README)",
      "VALIDATION_ERROR",
      ["Minimal config: version: 1, accounts: { brighten: { page: fb1071254 } }"],
    );
  }
  if (!accountName) {
    throw new AxiError(
      "no account selected and no defaultAccount configured",
      "VALIDATION_ERROR",
      ["Pass --account <name>, or set defaultAccount in manychat/config.yaml"],
    );
  }
  const account = config.accounts[accountName];
  if (!account) {
    throw new AxiError(
      `unknown account: ${accountName} (configured: ${Object.keys(config.accounts).join(", ")})`,
      "VALIDATION_ERROR",
    );
  }
  const keyEnv = apiKeyEnvName(accountName);
  const apiKey = env[keyEnv]?.trim() || env["MANYCHAT_API_KEY"]?.trim() || undefined;
  return { name: accountName, page: account.page, keyEnv, apiKey };
}
