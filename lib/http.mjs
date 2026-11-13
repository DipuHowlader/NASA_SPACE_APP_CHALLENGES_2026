/**
 * http.mjs — tiny helpers shared by the Vercel functions (CORS + JSON).
 * Uses portable Node response APIs (statusCode/setHeader/end) so the same code
 * runs on Vercel's augmented response and on plain Node (local harness/tests).
 */

export function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key");
}

export function noContent(res) {
  setCORS(res);
  res.statusCode = 204;
  res.end();
}

export function json(res, status, body) {
  setCORS(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res, allowed = ["GET", "POST", "OPTIONS"]) {
  res.setHeader("Allow", allowed.join(", "));
  return json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: `Allowed: ${allowed.join(", ")}` } });
}

export function badRequest(res, message, extra = {}) {
  return json(res, 400, { error: { code: "BAD_REQUEST", message, ...extra } });
}

export function serverError(res, err) {
  console.error(err);
  return json(res, 500, { error: { code: "SERVER_ERROR", message: "Internal error. Check function logs." } });
}
