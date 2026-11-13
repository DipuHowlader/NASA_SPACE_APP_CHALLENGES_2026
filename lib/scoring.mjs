/**
 * scoring.mjs — the deployed model runtime (used by the Vercel API and tests).
 *
 * Deployed formula (from model/model.json):
 *   score = clip(calibration_a * sum_i weight_i * s_i + calibration_b, 0, 1)
 *   s_i   = exp(-0.5 * ((x_i - t_i) / sigma_i)^2)   for continuous features
 *   s_i   = 1 - min(1, |x_i - t_i|)                 for binary geology tags
 *
 * Null features (e.g. absolute elevation for Moon/Mars targets, where Earth
 * values are not comparable) are skipped and weights re-normalized, so every
 * response reports exactly which dimensions drove the score.
 */

import model from "./data/model.mjs";
import sitesModule from "./data/sites.mjs";
import targetsModule from "./data/targets.mjs";

const SITES = sitesModule.sites;
const TARGETS = targetsModule.targets;
const TARGET_META = targetsModule.meta;
const CAL = model.meta.calibration || { a: 1, b: 0 };

const FEATURE_BY_KEY = new Map(model.features.map((f) => [f.key, f]));

function dimensionSim(f, x, t) {
  if (f.kind === "binary") return 1 - Math.min(1, Math.abs(x - t));
  const sigma = f.sigma || 1;
  const z = (x - t) / sigma;
  return Math.exp(-0.5 * z * z);
}

function round(v, d = 3) {
  return v == null ? null : +Number(v).toFixed(d);
}

function fmtValue(v, f) {
  if (v == null) return "n/a";
  if (f.kind === "binary") return (+v).toFixed(2);
  const unit = f.unit || "";
  if (unit === "\u00b0C") return `${+v.toFixed(1)}\u00b0C`;
  if (unit === "m") return `${Math.round(v)} m`;
  if (unit === "0-1") return (+v).toFixed(2);
  const digits = Math.abs(v) >= 100 ? 0 : 1;
  return `${+v.toFixed(digits)} ${unit}`;
}

/**
 * Core scoring: one site vs one target feature set.
 * Returns score (0-1) and the per-dimension breakdown.
 */
export function scoreSite(siteFeatures, targetFeatures) {
  const dims = [];
  let weighted = 0;
  let weightSum = 0;

  for (const f of model.features) {
    const x = siteFeatures[f.key];
    const t = targetFeatures[f.key];
    if (x == null || t == null) continue; // skip non-comparable dimension
    const sim = dimensionSim(f, x, t);
    const w = f.weight || 0;
    dims.push({
      feature: f.key,
      label: f.label,
      unit: f.unit,
      site_value: round(x, 3),
      target_value: round(t, 3),
      site_display: fmtValue(x, f),
      target_display: fmtValue(t, f),
      similarity: round(sim),
      weight: round(w, 4),
      contribution: round(sim * w, 4),
    });
    weighted += sim * w;
    weightSum += w;
  }

  const raw = weightSum > 0 ? weighted / weightSum : 0;
  const score = Math.min(1, Math.max(0, CAL.a * raw + CAL.b));
  dims.sort((p, q) => q.similarity - p.similarity);
  return { score, dims };
}

function describe(d, { best }) {
  return `${d.label} — site ${d.site_display} vs target ${d.target_display} (${Math.round(d.similarity * 100)}% match)`;
}

function summarize(dims, weights) {
  const byWeight = [...dims].sort((a, b) => b.weight - a.weight);
  const strengths = byWeight
    .filter((d) => d.similarity >= 0.6 && d.weight > 0.01)
    .slice(0, 4)
    .map((d) => describe(d, { best: true }));
  const gaps = byWeight
    .filter((d) => d.similarity <= 0.45 && d.weight > 0.01)
    .sort((a, b) => a.similarity - b.similarity)
    .slice(0, 4)
    .map((d) => describe(d, { best: false }));
  return { strengths, gaps };
}

function siteCard(site) {
  return {
    key: site.key,
    name: site.name,
    country: site.country,
    region: site.region,
    coords: { lat: site.lat, lon: site.lon },
    elevation_m: site.elevation_m,
  };
}

function filterSites(filter) {
  if (!filter) return SITES;
  return SITES.filter((s) => {
    if (filter.country && !(s.country || "").toLowerCase().includes(filter.country.toLowerCase())) return false;
    if (filter.tag) {
      const v = s.features?.[filter.tag];
      if (typeof v !== "number" || v < 0.5) return false;
    }
    return true;
  });
}

export function resolveTarget(nameOrKey) {
  if (!nameOrKey) return null;
  const q = String(nameOrKey).trim().toLowerCase();
  return (
    TARGETS.find((t) => t.key.toLowerCase() === q) ||
    TARGETS.find((t) => t.name.toLowerCase().includes(q)) ||
    TARGETS.find((t) => t.body.toLowerCase() === q && q.length > 3) ||
    null
  );
}

/**
 * Rank Earth sites for a resolved target. Returns the full API payload.
 */
export function rankTarget(target, { top = 5, filter = null, offset = 0 } = {}) {
  const scored = filterSites(filter)
    .map((site) => {
      const { score, dims } = scoreSite(site.features, target.features);
      return { site, score, dims };
    })
    .sort((a, b) => b.score - a.score);

  const total = scored.length;
  const page = scored.slice(offset, offset + Math.max(1, top));

  const results = page.map(({ site, score, dims }, i) => {
    const { strengths, gaps } = summarize(dims);
    return {
      rank: offset + i + 1,
      score: round(score * 100, 1),
      similarity: round(score),
      site: siteCard(site),
      why_analog: site.notes?.why || null,
      breakdown_limitations: site.notes?.breakdown || null,
      key_studies: site.notes?.studies || null,
      breakdown: dims,
      strengths,
      gaps,
    };
  });

  return {
    target: {
      key: target.key,
      name: target.name,
      body: target.body,
      overview: target.overview,
      sources: target.sources,
      universal_breakdown: (TARGET_META.universal_breakdown || {})[target.body] || [],
      features: target.features,
    },
    searched_count: total,
    count: results.length,
    offset,
    results,
    method: {
      model_version: model.meta.version,
      algorithm: model.meta.algorithm,
      formula: model.meta.deployed_formula,
      data_sources: ["NASA POWER climatology (2001-2025)", "curated geology/terrain attributes", "ridge-learned weights from 47 expert-labeled pairs"],
    },
  };
}

/** Rank against a fully custom target feature vector (advanced). */
export function rankCustomTarget(customFeatures, { top = 5, filter = null, offset = 0 } = {}) {
  const target = {
    key: "custom",
    name: "Custom target",
    body: "Custom",
    overview: "User-supplied target feature vector.",
    sources: "user-provided",
    features: customFeatures,
  };
  const payload = rankTarget(target, { top, filter, offset });
  return payload;
}

export function listTargets() {
  return TARGETS.map((t) => ({
    key: t.key,
    name: t.name,
    body: t.body,
    overview: t.overview,
    sources: t.sources,
  }));
}

export function listSites() {
  return SITES.map((s) => ({
    key: s.key,
    name: s.name,
    country: s.country,
    region: s.region,
    coords: { lat: s.lat, lon: s.lon },
    elevation_m: s.elevation_m,
    tags: s.tags,
    notes: s.notes,
  }));
}

export const modelInfo = () => model;
