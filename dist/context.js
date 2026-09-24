import { resolveConfig } from "./lib/env.js";
import { loadDotEnv, mergeEnv } from "./lib/dotenv.js";
import { createPublicApiClient } from "./publicapi/client.js";
import { loadProjectConfig } from "./config/projectConfig.js";
import { resolveStateDir } from "./browser/session.js";
import { runDiscover, runLogin, runProbe } from "./browser/runners.js";
import { withAppApi } from "./browser/appfetch.js";
export function createCommandContext(deps = {}, browserDeps) {
    const env = mergeEnv(loadDotEnv(), process.env);
    const config = resolveConfig(env);
    const client = createPublicApiClient(config, deps);
    const stateDir = resolveStateDir(env);
    const runners = {
        login: (opts) => runLogin({ ...opts, deps: browserDeps }),
        probe: (opts) => runProbe({ ...opts, deps: browserDeps }),
        discover: (opts) => runDiscover({ ...opts, deps: browserDeps }),
        withApp: (opts, fn) => withAppApi({ ...opts, deps: browserDeps?.appDeps }, fn),
    };
    return {
        config,
        client,
        stateDir,
        browser: runners,
        projectConfig: loadProjectConfig(),
        env,
    };
}
let cached;
export function getCommandContext() {
    cached ??= createCommandContext();
    return cached;
}
