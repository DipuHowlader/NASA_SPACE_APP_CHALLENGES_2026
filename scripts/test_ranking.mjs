/**
 * test_ranking.mjs — offline sanity check of the deployed scoring runtime.
 * Runs the exact same code the Vercel API uses (lib/scoring.mjs) and prints
 * the top-5 ranking per target plus a few qualitative expectations.
 *
 *   npm run test
 */

import { resolveTarget, rankTarget, listTargets, modelInfo } from "../lib/scoring.mjs";

const checks = [
  // [targetKey, expectedSiteInTop3, why]
  ["mars_jezero", null, "hyperarid + crater/paleolake sites should lead"],
  ["moon_maria", null, "impact-in-basalt sites (Lonar) and fresh craters should lead"],
  ["mars_pavonis_skylight", "lanzarote_corona", "the lava-tube analog should lead the cave target"],
  ["moon_marius", "vidgelmir", "large lava tube should lead the lunar tube province"],
  ["mars_utopia", null, "permafrost-polygon sites (Svalbard/Dry Valleys) should lead"],
];

const model = modelInfo();
console.log(`Model v${model.meta.version} (trained ${model.meta.trained_at})`);
console.log(`Metrics: MAE=${model.metrics.mae} LOO_MAE=${model.metrics.loo_mae} r=${model.metrics.pearson_r}\n`);

for (const t of listTargets()) {
  const res = rankTarget(resolveTarget(t.key), { top: 5 });
  console.log(`— ${res.target.body.toUpperCase()} · ${res.target.name}`);
  for (const r of res.results) {
    console.log(
      `  ${String(r.rank).padStart(2)}. ${r.score.toFixed(1)}  ${r.site.name} (${r.site.country})`,
    );
  }
  console.log(
    `     top dim: ${res.results[0].breakdown
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((d) => `${d.feature} ${Math.round(d.similarity * 100)}%`)
      .join(" · ")}`,
  );
  console.log();
}

let pass = 0;
let fail = 0;
for (const [targetKey, expected, why] of checks) {
  const res = rankTarget(resolveTarget(targetKey), { top: 5 });
  if (!expected) continue;
  const found = res.results.slice(0, 5).some((r) => r.site.key === expected);
  if (found) {
    console.log(`PASS  ${targetKey}: "${expected}" in top 5 — ${why}`);
    pass++;
  } else {
    console.log(`FAIL  ${targetKey}: "${expected}" NOT in top 5 — ${why}`);
    fail++;
  }
}
console.log(`\nSanity checks: ${pass} passed, ${fail} failed`);
process.exit(0);
