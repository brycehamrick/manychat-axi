import { parse as parseYaml } from "yaml";
import { AxiError } from "axi-sdk-js";

/**
 * Deploy specs: human-authored YAML describing one episode or article and
 * the registry targets it deploys to.
 *
 * ```yaml
 * version: 1
 * episode: 167
 * title: "Perimenopause Sleep"
 * keyword: EP167              # or keywords: [explicit list]
 * hook: "..."
 * url: "https://drbrighten.com/..."
 * tag: "Podcast | EP167 | Clicked"
 * targets: [podcast-fb, podcast-ig, podcast-show]
 * ```
 */

export interface DeploySpec {
  version: 1;
  /** Podcast episode number (podcast kinds). */
  episode?: number;
  /** Title (article kinds; also usable in podcast DM text). */
  title?: string;
  keywords: string[];
  hook: string;
  url: string;
  tagName: string;
  /** Optional utm_campaign appended to URLs (articles use it). */
  utm?: string;
  /** Optional explicit flow-name override. */
  name?: string;
  targets: string[];
}

export function keywordVariants(primary: string): string[] {
  const k = primary.trim().toUpperCase();
  if (k.length === 0) return [];
  const variants = new Set<string>([k, k.replace(/\s+/g, "")]);
  // "EP167" -> "EP 167" (podcast convention)
  const ep = /^EP(\d+)$/.exec(k);
  if (ep) {
    variants.add(`EP ${ep[1] ?? ""}`.trim());
  }
  // singular last word: "ADHD PERIODS" -> "ADHD PERIOD", "ADHDPERIOD"
  const words = k.split(/\s+/);
  const last = words[words.length - 1] ?? "";
  if (words.length > 1 && last.length > 2 && last.endsWith("S")) {
    const singular = [...words.slice(0, -1), last.slice(0, -1)].join(" ");
    variants.add(singular);
    variants.add(singular.replace(/\s+/g, ""));
  }
  return [...variants].filter((v) => v.length > 0);
}

function requireText(value: unknown, field: string, origin: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AxiError(`${origin}: ${field} is required and must be non-empty`, "VALIDATION_ERROR");
  }
  return value.trim();
}

export function parseSpec(text: string, origin: string): DeploySpec {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw new AxiError(
      `invalid YAML in ${origin}: ${error instanceof Error ? error.message : String(error)}`,
      "VALIDATION_ERROR",
    );
  }
  if (typeof raw !== "object" || raw === null) {
    throw new AxiError(`${origin} must be a YAML mapping`, "VALIDATION_ERROR");
  }
  const root = raw as Record<string, unknown>;
  if (root["version"] !== 1) {
    throw new AxiError(`${origin}: version must be 1`, "VALIDATION_ERROR");
  }
  for (const placeholder of ["REPLACE_ME", "TODO", "<url>", "TBD", "problem-question"]) {
    for (const field of ["url", "hook", "tag", "keyword", "keywords", "title"]) {
      const value = root[field];
      if (typeof value === "string" && value.toUpperCase().includes(placeholder)) {
        throw new AxiError(
          `${origin}: ${field} still contains a placeholder (${placeholder})`,
          "VALIDATION_ERROR",
        );
      }
    }
  }

  const episode =
    typeof root["episode"] === "number" && Number.isInteger(root["episode"])
      ? root["episode"]
      : undefined;
  const title = typeof root["title"] === "string" ? root["title"].trim() || undefined : undefined;
  if (episode === undefined && title === undefined) {
    throw new AxiError(`${origin}: episode (podcast) or title (article) is required`, "VALIDATION_ERROR");
  }

  let keywords: string[];
  if (Array.isArray(root["keywords"])) {
    keywords = root["keywords"]
      .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
      .map((k) => k.trim().toUpperCase());
    if (keywords.length === 0) {
      throw new AxiError(`${origin}: keywords must contain at least one keyword`, "VALIDATION_ERROR");
    }
  } else {
    const primary = requireText(root["keyword"], "keyword (or keywords list)", origin).toUpperCase();
    keywords = keywordVariants(primary);
  }
  for (const keyword of keywords) {
    if (/\s{2,}/.test(keyword) || keyword !== keyword.trim()) {
      throw new AxiError(
        `${origin}: keyword "${keyword}" has stray whitespace`,
        "VALIDATION_ERROR",
      );
    }
  }

  const hook = requireText(root["hook"], "hook", origin);
  const rawUrl = requireText(root["url"], "url", origin);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new AxiError(`${origin}: url is not a valid URL: ${rawUrl}`, "VALIDATION_ERROR");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new AxiError(`${origin}: url must use https, got ${parsedUrl.protocol}`, "VALIDATION_ERROR");
  }

  const tagName = requireText(root["tag"], "tag", origin);
  const utm = typeof root["utm"] === "string" && root["utm"].trim().length > 0
    ? root["utm"].trim()
    : undefined;
  const name = typeof root["name"] === "string" && root["name"].trim().length > 0
    ? root["name"].trim()
    : undefined;
  const targets = Array.isArray(root["targets"])
    ? root["targets"].filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
    : [];
  if (targets.length === 0) {
    throw new AxiError(`${origin}: targets must list at least one registry template key`, "VALIDATION_ERROR");
  }

  return {
    version: 1,
    ...(episode !== undefined ? { episode } : {}),
    ...(title !== undefined ? { title } : {}),
    keywords,
    hook,
    url: parsedUrl.toString(),
    tagName,
    ...(utm ? { utm } : {}),
    ...(name ? { name } : {}),
    targets,
  };
}

const DEFAULT_NAME_PATTERNS: Record<string, string> = {
  "podcast-fb": "EP{{episode}} to DM FB",
  "podcast-ig": "EP{{episode}} to DM",
  "article-ig": "{{title}} Comment to DM",
  "article-ig-offer": "{{title}} to Article",
};

export function deriveName(
  kind: string | undefined,
  spec: DeploySpec,
  namePattern?: string,
): string {
  if (spec.name) return spec.name;
  const pattern = namePattern ?? DEFAULT_NAME_PATTERNS[kind ?? ""] ?? "{{title}}{{episode}}";
  const rendered = pattern
    .replace(/\{\{episode\}\}/g, spec.episode !== undefined ? String(spec.episode) : "")
    .replace(/\{\{title\}\}/g, spec.title ?? "");
  const name = rendered.trim();
  if (name.length === 0) {
    throw new AxiError(
      `derived flow name is empty (kind: ${kind ?? "unknown"}; add a name to the spec or a namePattern to the template)`,
      "VALIDATION_ERROR",
    );
  }
  return name;
}

export function specSummary(spec: DeploySpec): Record<string, unknown> {
  return {
    ...(spec.episode !== undefined ? { episode: spec.episode } : {}),
    ...(spec.title !== undefined ? { title: spec.title } : {}),
    keywords: spec.keywords,
    url: spec.url,
    tag: spec.tagName,
    targets: spec.targets,
  };
}
