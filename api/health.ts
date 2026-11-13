import model from "../lib/data/model.mjs";
import { json, methodNotAllowed, noContent, setCORS, serverError } from "../lib/http.mjs";
import { listTargets, listSites } from "../lib/scoring.mjs";

export default function handler(req: any, res: any) {
  try {
    setCORS(res);
    if (req.method === "OPTIONS") return noContent(res);
    if (req.method !== "GET") return methodNotAllowed(res, ["GET", "OPTIONS"]);

    return json(res, 200, {
      status: "ok",
      service: "Planetary Analog Finder API",
      description: "ML-assisted global search for terrestrial analogs of Moon & Mars exploration sites (NASA Space Apps Challenge).",
      model_version: model.meta.version,
      trained_at: model.meta.trained_at,
      catalog: { earth_sites: listSites().length, moon_mars_targets: listTargets().length },
      endpoints: {
        "GET /api/health": "service status (public)",
        "GET /api/targets": "list Moon/Mars reference targets (public)",
        "GET /api/sites": "list Earth candidate sites (public)",
        "GET /api/model": "model card: weights + metrics (public)",
        "GET /api/search?target=<key>&top=5": "rank Earth analogs (API key required)",
        "POST /api/search": "rank analogs; body { target, top } or { features } for custom targets (API key required)",
      },
    });
  } catch (err) {
    return serverError(res, err);
  }
}
