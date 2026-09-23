import { resolveConfig } from "./lib/env.js";
import { createPublicApiClient } from "./publicapi/client.js";
import { resolveStateDir } from "./browser/session.js";
import { runDiscover, runLogin, runProbe } from "./browser/runners.js";
export function createCommandContext(deps = {}, browserDeps) {
    const config = resolveConfig();
    const client = createPublicApiClient(config, deps);
    const stateDir = resolveStateDir();
    const runners = {
        login: (opts) => runLogin({ ...opts, deps: browserDeps }),
        probe: (opts) => runProbe({ ...opts, deps: browserDeps }),
        discover: (opts) => runDiscover({ ...opts, deps: browserDeps }),
    };
    return { config, client, stateDir, browser: runners };
}
let cached;
export function getCommandContext() {
    cached ??= createCommandContext();
    return cached;
}
