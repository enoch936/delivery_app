import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
const project = "tsconfig.build.json";

const initialBuild = spawnSync(process.execPath, [tsc, "-p", project], { stdio: "inherit" });
if (initialBuild.status !== 0) process.exit(initialBuild.status ?? 1);

const compiler = spawn(process.execPath, [tsc, "-p", project, "--watch", "--preserveWatchOutput"], {
  stdio: "inherit"
});
const server = spawn(process.execPath, ["--watch", "dist/main.js"], {
  stdio: "inherit",
  env: process.env
});

const shutdown = (signal) => {
  for (const child of [server, compiler]) {
    try {
      child.kill(signal);
    } catch {
      // Child already exited.
    }
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
server.on("exit", (code) => {
  compiler.kill();
  process.exit(code ?? 0);
});
