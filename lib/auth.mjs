/**
 * auth.mjs — API key authentication + best-effort rate limiting.
 *
 * Keys are validated by SHA-256 hash against lib/data/keys.mjs (the plaintext
 * never lives on the server). Rate limiting is in-memory per function
 * instance: it is enforced consistently for a single user during a burst and
 * approximately across instances (Vercel Hobby has no shared state for free).
 */

import crypto from "node:crypto";
import registry from "./data/keys.mjs";

const buckets = new Map(); // hash -> { start, count }
const HOUR = 60 * 60 * 1000;

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * @returns {{ ok: true, key: { name: string, rate_per_hour: number } } |
 *           { ok: false, status: number, code: string, message: string }}
 */
export function authenticate(req) {
  const headerKey = req.headers?.["x-api-key"];
  const queryKey = req.query?.api_key;
  const raw = (typeof headerKey === "string" && headerKey) || (typeof queryKey === "string" && queryKey) || "";

  if (!raw) {
    return {
      ok: false,
      status: 401,
      code: "MISSING_KEY",
      message:
        "Provide your API key in the X-Api-Key header (or ?api_key=). See the project README section 'API keys'.",
    };
  }

  const hash = sha256(String(raw).trim());
  const record = registry.keys.find((k) => k.hash === hash);
  if (!record) {
    return { ok: false, status: 401, code: "INVALID_KEY", message: "Unknown API key." };
  }
  if (!record.active) {
    return { ok: false, status: 403, code: "KEY_INACTIVE", message: "This API key has been disabled." };
  }

  const limit = record.rate_per_hour > 0 ? record.rate_per_hour : 120;
  const now = Date.now();
  let bucket = buckets.get(hash);
  if (!bucket || now - bucket.start > HOUR) {
    bucket = { start: now, count: 0 };
    buckets.set(hash, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const retryMin = Math.max(1, Math.ceil((HOUR - (now - bucket.start)) / 60000));
    return {
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      message: `Rate limit of ${limit} requests/hour reached for key "${record.name}".`,
      retry_after_minutes: retryMin,
    };
  }

  return { ok: true, key: { name: record.name, rate_per_hour: limit } };
}
