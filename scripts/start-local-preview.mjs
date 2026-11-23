import { access, cp, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = 3010;
const occupied = await new Promise((resolve) => {
  const socket = net.connect({ port, host: "127.0.0.1" });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
  socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
});
if (occupied) throw new Error("Port 3010 is already in use; keep the existing preview or stop its owner before replacing it.");
await access(path.join(root, ".next", "BUILD_ID"));
const snapshot = path.join(root, ".next-preview");
await mkdir(snapshot, { recursive: true });
for (const entry of await readdir(path.join(root, ".next"))) {
  if (entry !== "cache") await cp(path.join(root, ".next", entry), path.join(snapshot, entry), { recursive: true, force: true });
}
await mkdir(path.join(root, "data"), { recursive: true });
const stdout = await open(path.join(root, "data", "preview.stdout.log"), "a");
const stderr = await open(path.join(root, "data", "preview.stderr.log"), "a");
const child = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"),
  "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root, env: { ...process.env, ORAI_PREVIEW_DIST: "1" },
  detached: true, windowsHide: true, stdio: ["ignore", stdout.fd, stderr.fd],
});
await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
child.unref();
await stdout.close(); await stderr.close();
await writeFile(path.join(root, "data", "preview.pid"), String(child.pid));
console.log(`Detached local preview started: http://127.0.0.1:${port}/beauty (PID ${child.pid}). Build snapshot: .next-preview.`);
