import { describe, expect, it } from "vitest";
import { mergeEnv, parseDotEnv } from "../src/lib/dotenv.js";
import { resolveConfig } from "../src/lib/env.js";

describe("parseDotEnv", () => {
  it("parses KEY=VALUE with quotes, exports, and comments", () => {
    const parsed = parseDotEnv(`
# comment line
MANYCHAT_API_KEY=abc123
export MANYCHAT_API_URL="https://api.manychat.com"
OTHER='single quoted'
EMPTY=
WITH_COMMENT=value # trailing note
; invalid-key=skipped
1BAD=skipped
`);
    expect(parsed).toEqual({
      MANYCHAT_API_KEY: "abc123",
      MANYCHAT_API_URL: "https://api.manychat.com",
      OTHER: "single quoted",
      EMPTY: "",
      WITH_COMMENT: "value",
    });
  });

  it("mergeEnv prefers real environment variables over the file", () => {
    const merged = mergeEnv(
      { MANYCHAT_API_KEY: "from-file", MANYCHAT_API_URL: "https://api.manychat.com" },
      { MANYCHAT_API_KEY: "from-env" } as NodeJS.ProcessEnv,
    );
    expect(merged["MANYCHAT_API_KEY"]).toBe("from-env");
    expect(merged["MANYCHAT_API_URL"]).toBe("https://api.manychat.com");
  });
});

describe("resolveConfig key handling", () => {
  it("treats a set-but-empty key as a configuration error", () => {
    expect(() =>
      resolveConfig({ MANYCHAT_API_KEY: "   " } as NodeJS.ProcessEnv),
    ).toThrowError(/set but empty/);
  });

  it("accepts keys supplied via a merged .env", () => {
    const env = mergeEnv({ MANYCHAT_API_KEY: "file-key" }, {} as NodeJS.ProcessEnv);
    expect(resolveConfig(env).apiKey).toBe("file-key");
  });
});
