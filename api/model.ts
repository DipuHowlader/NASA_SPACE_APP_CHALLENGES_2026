import { json, methodNotAllowed, noContent, setCORS, serverError } from "../lib/http.mjs";
import { modelInfo } from "../lib/scoring.mjs";

export default function handler(req: any, res: any) {
  try {
    setCORS(res);
    if (req.method === "OPTIONS") return noContent(res);
    if (req.method !== "GET") return methodNotAllowed(res, ["GET", "OPTIONS"]);

    const model = modelInfo();
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
    return json(res, 200, {
      meta: model.meta,
      metrics: model.metrics,
      features: model.features.map((f) => ({
        key: f.key,
        label: f.label,
        unit: f.unit,
        kind: f.kind,
        source: f.source,
        weight: f.weight,
        sigma: f.sigma,
      })),
    });
  } catch (err) {
    return serverError(res, err);
  }
}
