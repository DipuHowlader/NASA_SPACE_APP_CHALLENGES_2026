/**
 * generate_key.mjs — API key issuance for the Planetary Analog Finder API.
 *
 * Keys are random 48-hex secrets prefixed `xora_live_`. Only a SHA-256 hash is
 * stored (lib/data/keys.mjs) — the plaintext is shown exactly once, here.
 * The registry ships with the deployment, so issuing a key = run this script
 * and redeploy (or commit the change through GitHub Actions).
 *
 *   npm run key -- --name "xora-website"            # create key (default 120 req/h)
 *   npm run key -- --name "partner" --rate 600      # higher rate limit
 *   npm run key -- --list                           # list keys (masked)
 */

import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KEYS_FILE = path.join(ROOT, "lib", "data", "keys.mjs");

const KEY_PREFIX = "xora_live_";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") args.name = argv[++i];
    else if (a === "--rate") args.rate = Number(argv[++i]);
    else if (a === "--list") args.list = true;
    else args._.push(a);
  }
  return args;
}

async function loadRegistry() {
  try {
    const src = await readFile(KEYS_FILE, "utf8");
    return JSON.parse(src.replace(/^[\s\S]*?export default /, "").replace(/;\s*$/, ""));
  } catch {
    return { keys: [] };
  }
}

async function saveRegistry(registry) {
  const body = JSON.stringify(registry, null, 2);
  await writeFile(
    KEYS_FILE,
    `// AUTO-GENERATED API key registry — hashed keys only, never plaintext.\n// Manage with: npm run key -- --name "<label>"\nexport default ${body};\n`,
    "utf8",
  );
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = await loadRegistry();

  if (args.list) {
    console.log(`API keys (${registry.keys.length}):`);
    for (const k of registry.keys) {
      console.log(`  ${k.active ? "active" : "DISABLED"}  ${k.name.padEnd(24)} ${k.hash.slice(0, 12)}…  ${k.rate_per_hour}/h  created ${k.created}`);
    }
    return;
  }

  if (!args.name) {
    console.error('Usage: npm run key -- --name "<label>" [--rate 120]  (or --list)');
    process.exit(1);
  }

  const plaintext = KEY_PREFIX + crypto.randomBytes(24).toString("hex");
  const record = {
    name: args.name,
    hash: sha256(plaintext),
    created: new Date().toISOString().slice(0, 10),
    active: true,
    rate_per_hour: args.rate > 0 ? args.rate : 120,
  };
  registry.keys.push(record);
  await saveRegistry(registry);

  console.log("=".repeat(64));
  console.log(`API key created for "${record.name}" (${record.rate_per_hour}/h rate limit)`);
  console.log("");
  console.log(`  ${plaintext}`);
  console.log("");
  console.log("Copy it now — it is stored hashed (SHA-256) and CANNOT be shown again.");
  console.log("Commit lib/data/keys.mjs and redeploy to activate the key.");
  console.log("=".repeat(64));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
