/**
 * dev_server.mjs — LOCAL ONLY test harness (never deployed).
 *
 * Serves the actual Vercel function code (api/*.ts, via Node type-stripping)
 * plus public/ over localhost so the endpoints can be curl-tested without a
 * deployment. Mirrors what Vercel injects: req.query, req.body, res.status().json().
 *
 *   node scripts/dev_server.mjs [port]
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.argv[2] || 3000);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function parseUrl(url) {
  const [pathname, query = ""] = url.split("?");
  const q = {};
  for (const [k, v] of new URLSearchParams(query)) q[k] = v;
  return { pathname, query: q };
}

const server = http.createServer(async (req, res) => {
  const { pathname, query } = parseUrl(req.url || "/");

  // Static files from public/
  if (!pathname.startsWith("/api/")) {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    try {
      const file = await readFile(path.join(ROOT, "public", rel));
      res.writeHead(200, { "Content-Type": MIME[path.extname(rel)] || "application/octet-stream" });
      return res.end(file);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: `No route: ${pathname}` } }));
    }
  }

  // API function: /api/<name> -> api/<name>.ts
  const name = pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  let mod;
  try {
    mod = await import(pathToFileURL(path.join(ROOT, "api", `${name}.ts`)).href);
  } catch (e) {
    if (e?.code === "ERR_MODULE_NOT_FOUND") {
      res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: `No API function: ${name}` } }));
    }
    throw e;
  }
  try {    const handler = mod.default;

    // Minimal Vercel-compatible req augmentation
    let body;
    if (req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = raw;
      }
    }
    Object.defineProperty(req, "body", { value: body, configurable: true });
    Object.defineProperty(req, "query", { value: query, configurable: true });

    await handler(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: { code: "SERVER_ERROR", message: String(err?.message || err) } }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`Local dev harness on http://localhost:${PORT}`);
  console.log(`  GET  /                  (demo page)`);
  console.log(`  GET  /api/health`);
  console.log(`  GET  /api/search?target=mars_jezero&top=3  (needs X-Api-Key)`);
});
