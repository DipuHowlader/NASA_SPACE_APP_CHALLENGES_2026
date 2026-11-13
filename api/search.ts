/**
 * /api/search — the core endpoint: rank Earth analogs for a Moon/Mars target.
 *
 * Requires an API key: X-Api-Key header (or ?api_key=).
 *
 * GET  /api/search?target=mars_jezero&top=5&tag=impact_crater
 * POST /api/search { "target": "mars_jezero", "top": 5 }
 * POST /api/search { "features": { "temp_mean_c": -60, "barrenness": 1.0, ... }, "top": 5 }
 */

import { authenticate } from "../lib/auth.mjs";
import { json, methodNotAllowed, noContent, badRequest, setCORS, serverError } from "../lib/http.mjs";
import { resolveTarget, rankTarget, rankCustomTarget } from "../lib/scoring.mjs";

function clampTop(v: any): number {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 5;
  return Math.min(50, Math.max(1, n));
}

function run(res: any, params: { target?: any; features?: any; top?: any; filter?: any; offset?: any }) {
  const top = clampTop(params.top ?? 5);
  const offset = Math.max(0, parseInt(params.offset, 10) || 0);

  let payload;
  if (params.features && typeof params.features === "object") {
    payload = rankCustomTarget(params.features, { top, filter: params.filter, offset });
  } else {
    const target = resolveTarget(params.target);
    if (!target) {
      return badRequest(res, "Unknown or missing target. GET /api/targets lists valid keys (e.g. mars_jezero, moon_south_pole).");
    }
    payload = rankTarget(target, { top, filter: params.filter, offset });
  }
  payload.query = { target: params.target ?? "custom", top, offset, filter: params.filter ?? null };
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  return json(res, 200, payload);
}

export default async function handler(req: any, res: any) {
  try {
    setCORS(res);
    if (req.method === "OPTIONS") return noContent(res);

    const auth = authenticate(req);
    if (!auth.ok) {
      return json(res, auth.status, { error: { code: auth.code, message: auth.message, ...(auth as any).retry_after_minutes ? { retry_after_minutes: (auth as any).retry_after_minutes } : {} } });
    }

    if (req.method === "GET") {
      return run(res, {
        target: req.query.target,
        top: req.query.top,
        offset: req.query.offset,
        filter: {
          country: req.query.country,
          tag: req.query.tag,
        },
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
      if (!body || typeof body !== "object") return badRequest(res, "Body must be a JSON object.");
      return run(res, {
        target: body.target,
        features: body.features,
        top: body.top ?? req.query.top,
        offset: body.offset ?? req.query.offset,
        filter: body.filter ?? null,
      });
    }

    return methodNotAllowed(res, ["GET", "POST", "OPTIONS"]);
  } catch (err) {
    return serverError(res, err);
  }
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
