/**
 * Start Expo on the PC's current network.
 * A saved address from the last cafe/campus/hotspot is never reused.
 */
const { execSync, spawn } = require("child_process");

function defaultRouteIpv4() {
  if (process.platform !== "win32") return null;
  const out = execSync("route print -4", { encoding: "utf8" });
  let best = null;
  let bestMetric = Infinity;
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(
      /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+\S+\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)/
    );
    if (!match) continue;
    const ip = match[1];
    const metric = Number(match[2]);
    if (ip.startsWith("127.") || ip.startsWith("169.254.")) continue;
    if (metric < bestMetric) {
      bestMetric = metric;
      best = ip;
    }
  }
  return best;
}

const ip = defaultRouteIpv4();
if (ip) {
  process.env.REACT_NATIVE_PACKAGER_HOSTNAME = ip;
  console.log(`[start] This network: exp://${ip}:8081`);
} else {
  console.log("[start] No LAN address yet. Connect Wi-Fi, then run this again.");
}

const child = spawn(
  "npx",
  ["expo", "start", "--lan", ...process.argv.slice(2)],
  { stdio: "inherit", shell: true, env: process.env }
);

child.on("exit", (code) => process.exit(code ?? 0));
