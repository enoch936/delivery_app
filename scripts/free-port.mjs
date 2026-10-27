import { execFileSync, execSync } from "node:child_process";

const port = Number(process.argv[2] ?? 3000);

function listenerPids() {
  if (process.platform === "win32") {
    const output = execSync("netstat -ano -p TCP", { encoding: "utf8" });
    return [
      ...new Set(
        output
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/))
          .filter((parts) => parts.includes("LISTENING") && parts[1]?.endsWith(`:${port}`))
          .map((parts) => Number(parts.at(-1)))
          .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid),
      ),
    ];
  }

  try {
    const output = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    return [
      ...new Set(
        output
          .split(/\s+/)
          .map(Number)
          .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid),
      ),
    ];
  } catch {
    return [];
  }
}

function terminate(pid) {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

const pids = listenerPids();

if (pids.length === 0) {
  console.log(`Port ${port} is free.`);
  process.exit(0);
}

for (const pid of pids) {
  if (terminate(pid)) {
    console.log(`Freed port ${port} (terminated PID ${pid}).`);
  } else {
    console.log(`Warning: could not terminate PID ${pid} holding port ${port}.`);
  }
}
