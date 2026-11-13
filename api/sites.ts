import { json, methodNotAllowed, noContent, badRequest, setCORS, serverError } from "../lib/http.mjs";
import { listSites } from "../lib/scoring.mjs";

export default function handler(req: any, res: any) {
  try {
    setCORS(res);
    if (req.method === "OPTIONS") return noContent(res);
    if (req.method !== "GET") return methodNotAllowed(res, ["GET", "OPTIONS"]);

    const q = req.query || {};
    const country = (q.country ?? "").toString().trim();
    const tag = (q.tag ?? "").toString().trim();
    const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 50));

    let sites = listSites();
    if (country) sites = sites.filter((s) => (s.country || "").toLowerCase().includes(country.toLowerCase()));
    if (tag) {
      const invalid = !listSites().some((s) => s.tags && tag in s.tags);
      if (invalid) {
        return badRequest(res, `Unknown tag "${tag}". Valid tags: volcanic_basalt, impact_crater, aeolian_dunes, salt_flat, permafrost_ice, subsurface_cave, fluvial_paleolake, hydrothermal_acid, ophiolite_olivine, extremophile_studies`);
      }
      sites = sites.filter((s) => (s.tags?.[tag] ?? 0) >= 0.5);
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
    return json(res, 200, { count: sites.length, limit, sites: sites.slice(0, limit) });
  } catch (err) {
    return serverError(res, err);
  }
}
