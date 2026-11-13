# 🪐 Planetary Analog Finder

**ML-assisted global search for terrestrial analogs of Moon & Mars exploration sites.**
NASA Space Apps Challenge — *" Searching for Planetary Analog Sites on Earth"*.

The deployed API is **public** (key-protected search, open metadata endpoints) and runs
**free** on Vercel's Hobby tier as zero-dependency serverless functions.

**Live demo page:** `https://<your-project>.vercel.app/` (served by this repo once deployed)

---

## What it does

```
┌──────────────────────┐   ┌───────────────────────┐   ┌──────────────────────┐
│ NASA POWER climatology │   │ 50 curated Earth sites  │   │ 8 Moon/Mars targets  │
│ 2001–2025 (50 sites)   │ + │ geology/terrain tags    │ + │ mission-measured     │
│ scripts/fetch_power    │   │ scripts/build_dataset   │   │ features (REMS/MEDA, │
└──────────┬─────────────┘   └──────────┬──────────────┘   │ Diviner, MOLA/LOLA…) │
           └──────────────┬─────────────┴───────────────────┴───────────┬──────────┘
                          ▼                                              ▼
              ┌────────────────────────────────────────────────────────────────┐
              │ train_model.py — ridge regression over 47 expert-labeled pairs │
              │ learns per-dimension weights → model/model.json (deployed)     │
              └──────────────────────────────┬─────────────────────────────────┘
                                             ▼
        ┌────────────────────────────────────────────────────────────────────┐
        │ Vercel serverless API (api/*.ts + lib/*.mjs, zero npm dependencies) │
        │  /api/search  /api/targets  /api/sites  /api/model  /api/health     │
        │  API-key auth (hashed keys) + rate limiting + CORS                  │
        └──────────────────────────────┬─────────────────────────────────────┘
                                       ▼
                        Your website (XORA) / any client
```

Given a Moon/Mars target (e.g. *Jezero Crater*), the API scans all 50 Earth sites and
returns a **ranked list with a per-dimension breakdown** — which NASA-measured
characteristics match, which don't, and the universal breakdowns (gravity, atmosphere,
radiation) that make every Earth analog imperfect.

### Sample result — Mars · Jezero Crater (real output)

| # | Earth analog | Score | What matches | What breaks down |
|---|---|---|---|---|
| 1 | Roter Kamm crater (Namibia) | 82.0 | impact structure, aeolian degradation by dunes | +19 °C vs −60 °C air temp |
| 2 | Wabar craters (Saudi Arabia) | 80.8 | impact into loose sand ≈ regolith | hyperarid but warm |
| 3 | Wolfe Creek crater (Australia) | 80.3 | fresh simple-crater morphology | … |
| 4 | Barringer Meteor Crater (USA) | 80.0 | canonical young impact crater | … |
| 5 | Lonar crater (India) | 79.5 | **impact crater in basalt** — the only one on Earth | paleolake present |

---

## Why this is more than "looks like Mars"

- **Multi-dataset, not visual.** Scoring uses NASA POWER climate measurements
  (temperature, precipitation, humidity, wind, solar flux, 2001–2025 climatology) plus
  curated geology/terrain attributes — geology and climate are weighted separately.
- **Process-aware catalog.** Includes *teaching counter-examples*: Makhtesh Ramon (an
  erosion crater that *looks* like an impact crater but isn't) and Al Wahbah / Kilbourne
  (volcanic maars) — demonstrating that morphology alone misleads.
- **Beyond the famous four.** 50 sites across 26 countries; Iceland/Hawaii are reduced to
  single representative sites, while Ladakh, Qaidam, Bodélé, Lonar, Putorana, Samail
  ophiolite and Movile Cave bring less-known but published analog value.
- **Honest limits.** Every response carries the universal breakdown (gravity, pressure,
  radiation, day-length) and each site's own limitations — matching the challenge's
  "where the analogy breaks down" requirement.
- **Explainable ML.** The deployed metric is a weighted sum of per-dimension
  similarities with weights *learned* from expert-labeled analog pairs (ridge regression,
  LOO-CV). Every score decomposes into 20 visible dimensions.

---

## API reference

Base URL after deployment: `https://<project>.vercel.app`

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/health` | — | Service status, model version, catalog size |
| `GET /api/targets[?body=moon\|mars]` | — | Moon/Mars reference targets |
| `GET /api/sites?country=India&tag=impact_crater` | — | Earth catalog (filterable) |
| `GET /api/model` | — | Model card: learned weights, σ kernels, metrics |
| `GET /api/search?target=mars_jezero&top=5` | **key** | Ranked Earth analogs + breakdowns |
| `POST /api/search` | **key** | Same; body `{ "target": "moon_maria", "top": 5 }` — or a **custom target**: `{ "features": { "temp_mean_c": -60, "barrenness": 1.0, "impact_crater": 1.0 }, "top": 5 }` |

Valid target keys: `mars_jezero` · `mars_gale` · `mars_utopia` · `mars_pavonis_skylight`
· `moon_south_pole` · `moon_maria` · `moon_marius` · `moon_hadley`

Valid tags: `volcanic_basalt` `impact_crater` `aeolian_dunes` `salt_flat` `permafrost_ice`
`subsurface_cave` `fluvial_paleolake` `hydrothermal_acid` `ophiolite_olivine` `extremophile_studies`

### Quick start

```bash
# list targets (no key needed)
curl https://<project>.vercel.app/api/targets

# search (API key required)
curl "https://<project>.vercel.app/api/search?target=mars_jezero&top=3" \
     -H "X-Api-Key: xora_live_..."

# custom planet (API key required)
curl -X POST https://<project>.vercel.app/api/search \
     -H "Content-Type: application/json" -H "X-Api-Key: xora_live_..." \
     -d '{"features":{"temp_mean_c":-60,"precip_mm_yr":0,"barrenness":1.0,"impact_crater":1.0},"top":5}'
```

Errors are structured: `401 MISSING_KEY|INVALID_KEY`, `403 KEY_INACTIVE`,
`429 RATE_LIMITED` (with `retry_after_minutes`), `400 BAD_REQUEST`.

---

## API keys

Keys are **random 48-hex secrets prefixed `xora_live_`**. Only a SHA-256 hash is stored
in `lib/data/keys.mjs` — the plaintext is printed exactly once when generated.

```bash
npm run key -- --name "xora-website" --rate 300   # create a key (300 req/h)
npm run key -- --list                             # list keys (masked)
```

Then commit the updated `lib/data/keys.mjs` and push — GitHub Actions redeploys and the
key becomes live. Two pre-issued keys ship with this repo (ask the team leads for the
plaintext): `xora-website` (300 req/h) for the main site, `public-demo` (60 req/h).

Rate limiting is per-key, enforced in-memory per serverless instance — a best-effort
abuse guard, not a billing meter (documented limitation of the free tier).

---

## The model

See `model/training_report.md` for the full auto-generated model card.

- **Features (20):** 8 NASA POWER climate dimensions + local relief + barrenness + 10
  geology/terrain tags. Absolute elevation is carried as *context only* — Earth altitude
  is not comparable with martian/lunar elevation.
- **Similarity kernels:** Gaussian `exp(-0.5·((x−t)/σ)²)` with `σ = 0.3 × feature span`
  for continuous features; exact-match similarity for binary tags.
- **Training:** 47 expert-labeled (site, target) analog pairs → ridge regression
  (α=1.0, selected by leave-one-out CV within the noise band) → non-negative normalized
  weights + monotone linear calibration.
- **Metrics (0–1 label scale):** MAE 0.097 · RMSE 0.112 · R² 0.298 · Pearson r 0.55 ·
  LOO MAE 0.118 (vs mean-predictor MAE 0.113).
- **Interpretation:** learned weights concentrate on impact-crater structure (0.13),
  permafrost/ground ice (0.13), local relief (0.12), diurnal temperature range (0.11),
  salt flats (0.10), subsurface caves (0.08) — i.e. *process* and *environment-extreme*
  dimensions, exactly what the challenge asks the analog search to respect.
- **Limitations:** labels are literature-informed expert judgments, not ground truth;
  NASA POWER is a ~0.5° reanalysis grid (relative rankings are more robust than absolute
  values); 47 pairs vs 20 features requires heavy regularization — the point of the model
  is explainable ranking, not high-precision prediction.

---

## Repository layout

```
├── api/                    # Vercel serverless functions (TypeScript, zero deps)
│   ├── health.ts  targets.ts  sites.ts  model.ts  search.ts
├── lib/
│   ├── scoring.mjs         # deployed model runtime (shared by API & tests)
│   ├── auth.mjs            # API-key auth + rate limiting
│   ├── http.mjs            # CORS + JSON helpers
│   └── data/*.mjs          # generated runtime modules (sites, targets, model, keys)
├── data/
│   ├── sites_earth.json    # 50 curated Earth candidate sites
│   ├── targets_space.json  # 8 Moon/Mars reference targets
│   ├── expert_pairs.json   # 47 labeled analog pairs (training labels)
│   ├── climate_power.json  # fetched NASA POWER climatology
│   ├── dataset.json        # merged feature dataset
│   └── power_raw/*.json    # raw POWER responses (provenance)
├── model/
│   ├── model.json          # trained artifact (weights, sigmas, calibration, metrics)
│   └── training_report.md  # auto-generated model card
├── scripts/
│   ├── fetch_power.mjs     # NASA POWER fetcher (npm run fetch:nasa)
│   ├── build_dataset.py    # merge features (npm run build:data)
│   ├── train_model.py      # training (npm run train)
│   ├── generate_key.mjs    # key issuance (npm run key)
│   ├── test_ranking.mjs    # ranking sanity checks (npm run test)
│   └── dev_server.mjs      # local harness for the Vercel functions
├── public/index.html       # demo web app
├── docs/INTEGRATION.md     # how to consume the API from the XORA website
└── .github/workflows/      # deploy.yml (Vercel) + ci.yml (pipeline checks)
```

---

## Reproduce the full pipeline

```bash
npm install            # no dependencies — installs nothing
npm run fetch:nasa     # pull NASA POWER climatology for all 50 sites (~1 min)
npm run build:data     # merge POWER + curated attributes
npm run train          # train + evaluate + export model artifacts
npm run test           # ranking sanity checks
npm run key -- --name "your-key"   # issue an API key
```

## Local development

```bash
npx vercel dev          # full Vercel runtime (requires vercel login)
# or, without any account:
node scripts/dev_server.mjs 3000   # local harness for the same function code
```

## Deploy free on Vercel (GitHub Actions path)

1. **Push this folder to a GitHub repo** (e.g. `planetary-analog-finder`).
2. **Vercel:** Add New → Project → *Import* the repo — but do **not** finish dashboard
   deploys; instead grab the IDs: Project → Settings → General → *Vercel Project ID*,
   and your team/org id from `vercel whoami` or the dashboard URL.
3. **GitHub repo → Settings → Secrets and variables → Actions**, add:
   - `VERCEL_TOKEN` — Vercel → Account Settings → Tokens (scope: the project's team)
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`
4. Push to `main` → `.github/workflows/deploy.yml` builds and deploys to production.
5. Update `docs/INTEGRATION.md` and your website with the final URL.

*Zero-cost notes:* the API has **no npm dependencies** (fast cold starts), data/static
files are served free, and Hobby-tier function limits (10 s duration) are far above what
each request needs (~10 ms of compute). CI runs the full pipeline on every push.

## Data sources & credits

- **NASA POWER** — CERES/MERRA-2 climatological solar & meteorology data
  (https://power.larc.nasa.gov/) — Earth climate features, 2001–2025.
- **Mars targets:** REMS (Curiosity/Gale), MEDA (Perseverance/Jezero), Viking 2
  (Utopia), HiRISE skylight catalog (Pavonis Mons).
- **Moon targets:** LRO Diviner temperatures, LOLA topography, illumination maps
  (Speyerer & Robinson), Kaguya/SELENE Marius Hills skylight (Haruyama et al. 2009).
- **Curated geology/terrain attributes & labels:** published analog literature
  (Navarro-González et al. 2003/2006; ESA PANGAEA; NASA Haughton-Mars Project; AMASE;
  ISRO Ladakh/Lonar analog studies; Qaidam Mars-analog papers; etc.).
- Built for the NASA Space Apps Challenge. Team: SpaceApps team (XORA).

## License

MIT — see `LICENSE`.
