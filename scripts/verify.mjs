import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 18188;

function checkSyntax() {
  const targets = ["serve.mjs", "scripts/verify.mjs"];
  const srcDir = path.join(root, "src");
  for (const name of fs.readdirSync(srcDir)) {
    if (/\.m?js$/.test(name)) targets.push(path.join("src", name));
  }
  for (const rel of targets) {
    execFileSync(process.execPath, ["--check", path.join(root, rel)], { stdio: "inherit" });
  }
  console.log(`Syntax check passed (${targets.length} JS files).`);
}

function checkAssets() {
  const required = [
    "index.html",
    "styles.css",
    "assets/bust.glb",
    "assets/fonts/inter-400.woff2",
    "assets/fonts/inter-500.woff2",
    "assets/fonts/inter-600.woff2",
    "assets/fonts/ibm-plex-mono-400.woff2",
    "assets/fonts/ibm-plex-mono-500.woff2",
  ];
  for (const rel of required) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`Missing required asset: ${rel}`);
    }
    const stat = fs.statSync(abs);
    if (stat.size < 100) {
      throw new Error(`Asset too small / empty: ${rel} (${stat.size} bytes)`);
    }
  }

  const glbSize = fs.statSync(path.join(root, "assets/bust.glb")).size;
  console.log(`Asset manifest check passed (${required.length} files, bust.glb=${glbSize} bytes).`);
}

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once("error", (err) => {
      reject(new Error(`Dedicated verification port ${port} is busy: ${err.message}`));
    });
    tester.once("listening", () => {
      tester.close(() => resolve());
    });
    tester.listen(port, "127.0.0.1");
  });
}

function waitForServer(port, timeoutMs = 8000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Server did not listen on 127.0.0.1:${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 120);
        }
      });
    };
    attempt();
  });
}

async function run() {
  checkSyntax();
  checkAssets();
  await assertPortFree(PORT);

  const server = spawn(process.execPath, ["serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverLogs = "";
  server.stdout.on("data", (d) => {
    serverLogs += d.toString();
  });
  server.stderr.on("data", (d) => {
    serverLogs += d.toString();
  });

  try {
    await waitForServer(PORT);
    execFileSync(
      "python",
      [path.join(root, "scripts/verify_browser.py"), `http://127.0.0.1:${PORT}/`],
      { cwd: root, stdio: "inherit" }
    );
  } catch (err) {
    if (serverLogs) {
      console.error("--- Server logs ---\n" + serverLogs);
    }
    throw err;
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 250));
    if (!server.killed) {
      server.kill("SIGKILL");
    }
  }
}

run().catch((err) => {
  console.error("Verification failed:", err.message || err);
  process.exit(1);
});
