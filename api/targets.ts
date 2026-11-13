import { json, methodNotAllowed, noContent, setCORS, serverError } from "../lib/http.mjs";
import { listTargets } from "../lib/scoring.mjs";

export default function handler(req: any, res: any) {
  try {
    setCORS(res);
    if (req.method === "OPTIONS") return noContent(res);
    if (req.method !== "GET") return methodNotAllowed(res, ["GET", "OPTIONS"]);

    const body = (req.query?.body ?? "").toString().toLowerCase().trim();
    let targets = listTargets();
    if (body === "mars" || body === "moon") {
      targets = targets.filter((t) => t.body.toLowerCase() === body);
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
    return json(res, 200, { count: targets.length, targets });
  } catch (err) {
    return serverError(res, err);
  }
}
