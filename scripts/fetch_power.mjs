/**
 * fetch_power.mjs — Data preparation step 1
 * Fetches NASA POWER 25-year monthly climatology (2001-2025) for every Earth
 * candidate site in data/sites_earth.json and condenses it into the climate
 * features used by the model.
 *
 * No API key required (POWER is an open service). No dependencies (Node 20+).
 *
 *   npm run fetch:nasa            # fetch any missing sites
 *   npm run fetch:nasa -- --refetch  # force refetch everything
 *
 * Outputs:
 *   data/power_raw/<site>.json   raw POWER responses (provenance)
 *   data/climate_power.json      condensed climate features per site
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITES_FILE = path.join(ROOT, "data", "sites_earth.json");
const RAW_DIR = path.join(ROOT, "data", "power_raw");
const OUT_FILE = path.join(ROOT, "data", "climate_power.json");

const BASE =
  "https://power.larc.nasa.gov/api/temporal/climatology/point";
const PARAMS =
  "T2M,T2M_MAX,T2M_MIN,T2M_RANGE,RH2M,WS2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN";
const FILL = -999.0;

const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function valid(v) {
  return typeof v === "number" && v !== FILL && Number.isFinite(v);
}

function mean(arr) {
  const a = arr.filter(valid);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}

function buildClimate(site, prop) {
  const t2m = prop.T2M || {};
  const t2mMax = prop.T2M_MAX || {};
  const t2mMin = prop.T2M_MIN || {};
  const rh = prop.RH2M || {};
  const ws = prop.WS2M || {};
  const pre = prop.PRECTOTCORR || {};
  const sol = prop.ALLSKY_SFC_SW_DWN || {};

  // Warmest-month mean daily max, coldest-month mean daily min -> "extremes"
  const tempMaxC = Math.max(...months.map((m) => t2mMax[m]).filter(valid), -Infinity);
  const tempMinC = Math.min(...months.map((m) => t2mMin[m]).filter(valid), Infinity);
  // Diurnal range: use T2M_RANGE ANN when present, else mean(T2M_MAX - T2M_MIN)
  let diurnal = prop.T2M_RANGE ? prop.T2M_RANGE.ANN : null;
  if (!valid(diurnal)) {
    diurnal = mean(months.map((m) => (valid(t2mMax[m]) && valid(t2mMin[m]) ? t2mMax[m] - t2mMin[m] : NaN)));
  }
  const ann = (series) => (valid(series.ANN) ? series.ANN : null);

  return {
    temp_mean_c: ann(t2m),
    temp_max_c: Number.isFinite(tempMaxC) ? tempMaxC : null,
    temp_min_c: Number.isFinite(tempMinC) ? tempMinC : null,
    diurnal_range_c: valid(diurnal) ? diurnal : null,
    precip_mm_yr: ann(pre) === null ? null : +(ann(pre) * 365.25).toFixed(1),
    wind_mean_ms: ann(ws) === null ? null : +ann(ws).toFixed(2),
    rh_min_pct: (() => {
      const mins = months.map((m) => rh[m]).filter(valid);
      return mins.length ? Math.min(...mins) : null;
    })(),
    solar_kwh_m2_day: ann(sol) === null ? null : +(ann(sol) * 24 / 1000).toFixed(2),
  };
}

async function fetchSite(site, refetch) {
  const rawFile = path.join(RAW_DIR, `${site.key}.json`);
  if (!refetch) {
    try {
      const cached = JSON.parse(await readFile(rawFile, "utf8"));
      return { site, climate: buildClimate(site, cached.properties.parameter), cached: true };
    } catch {
      /* fetch below */
    }
  }
  const url = `${BASE}?parameters=${PARAMS}&community=SB&longitude=${site.lon}&latitude=${site.lat}&format=JSON`;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "planetary-analog-finder/1.0 (NASA Space Apps)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.properties?.parameter) {
        await writeFile(rawFile, JSON.stringify(json));
        return { site, climate: buildClimate(site, json.properties.parameter), cached: false };
      }
      throw new Error("unexpected response shape");
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return { site, climate: null, error: String(lastErr?.message || lastErr) };
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
      const c = results[i].climate;
      const tag = c ? "ok" : "FAIL";
      console.log(`[${String(i + 1).padStart(2)}/${items.length}] ${tag} ${results[i].site.key}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, lane));
  return results;
}

async function main() {
  const refetch = process.argv.includes("--refetch");
  const { sites } = JSON.parse(await readFile(SITES_FILE, "utf8"));
  await mkdir(RAW_DIR, { recursive: true });

  console.log(`Fetching NASA POWER climatology for ${sites.length} sites (2001-2025)...\n`);
  const results = await runPool(sites, (s) => fetchSite(s, refetch), 5);

  const climate = {};
  const failures = [];
  for (const r of results) {
    if (r.climate) climate[r.site.key] = r.climate;
    else failures.push({ site: r.site.key, error: r.error });
  }

  await writeFile(
    OUT_FILE,
    JSON.stringify(
      {
        meta: {
          source: "NASA POWER Climatology API v2 (https://power.larc.nasa.gov/)",
          period: "January 2001 - December 2025",
          variables: {
            temp_mean_c: "T2M ANN (mean annual air temperature at 2 m)",
            temp_max_c: "T2M_MAX: warmest-month mean daily max",
            temp_min_c: "T2M_MIN: coldest-month mean daily min",
            diurnal_range_c: "T2M_RANGE ANN (mean diurnal temperature range)",
            precip_mm_yr: "PRECTOTCORR ANN x 365.25 (mean annual precipitation)",
            wind_mean_ms: "WS2M ANN (mean wind speed at 2 m)",
            rh_min_pct: "RH2M: minimum monthly mean relative humidity",
            solar_kwh_m2_day: "ALLSKY_SFC_SW_DWN ANN x 24/1000 (mean daily solar irradiance)",
          },
        },
        climate,
      },
      null,
      2,
    ),
  );

  console.log(`\nDone: ${Object.keys(climate).length} sites OK, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failed sites:");
    for (const f of failures) console.log(`  - ${f.site}: ${f.error}`);
  }
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
