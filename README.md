# Planetary Analog Finder

NASA Space Apps Challenge 2026. This project searches for places on Earth that work as
analogs for candidate Moon-base and Mars-landing sites. It uses NASA POWER climate data
together with geology and terrain attributes, fits similarity weights from a set of
published analog comparisons, and serves the results through a small REST API.

The API runs on Vercel (free tier, serverless functions, no npm dependencies). The demo
page in `public/` works as a simple client for it.

## How it works

1. `scripts/fetch_power.mjs` pulls the 2001-2025 climatology for all 50 Earth sites
   from the NASA POWER API (no key needed) and stores raw responses in `data/power_raw/`.
2. `scripts/build_dataset.py` merges the POWER climate values with curated geology and
   terrain attributes into one dataset.
3. `scripts/train_model.py` fits ridge regression on 47 expert-labeled analog pairs
   (site, target, similarity score). The learned coefficients are clipped, normalized
   and calibrated into the deployed scoring function. Artifacts: `model/model.json`,
   `model/training_report.md`.
4. The API (`api/*.ts`, `lib/*.mjs`) loads the trained model and ranks all 50 sites
   against any Moon/Mars target, returning the score, the per-dimension breakdown, and
   notes on what matches and what does not.

Every search response also includes the physical breakdowns that no Earth site can
reproduce (gravity, atmospheric pressure, radiation, day length) so the results stay
honest about the limits of each analog.

## Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/health` | none | status, model version, catalog size |
| `GET /api/targets` | none | Moon/Mars reference targets |
| `GET /api/sites?country=India&tag=impact_crater` | none | Earth site catalog |
| `GET /api/model` | none | weights, metrics, feature list |
| `GET /api/search?target=mars_jezero&top=5` | key | ranked analogs with breakdown |
| `POST /api/search` | key | same, or a custom target feature vector |

Target keys: `mars_jezero`, `mars_gale`, `mars_utopia`, `mars_pavonis_skylight`,
`moon_south_pole`, `moon_maria`, `moon_marius`, `moon_hadley`.

Example:

```bash
curl "https://<deploy-url>/api/search?target=mars_jezero&top=3" -H "X-Api-Key: xora_live_..."
```

Search responses contain `results[].score` (0-100), `results[].breakdown` (every scored
dimension with site value, target value and match percentage), `strengths`, `gaps`,
`why_analog` and `breakdown_limitations`. See `docs/INTEGRATION.md` for frontend
examples.

## API keys

Keys are random secrets prefixed `xora_live_`, stored only as SHA-256 hashes in
`lib/data/keys.mjs`. Generate and list them with:

```bash
npm run key -- --name "xora-website" --rate 300
npm run key -- --list
```

The new key activates after the next deploy. Rate limits are per key, enforced
in-memory per function instance (best effort on the free tier).

## Running and deploying

```bash
npm run fetch:nasa     # NASA POWER data (about a minute)
npm run build:data     # merge features
npm run train          # train and export the model
npm run test           # ranking sanity checks
node scripts/dev_server.mjs 3000   # local server for the api handlers
npx vercel dev                     # or the real Vercel runtime
```

Deployment goes through `.github/workflows/deploy.yml`. It needs three repository
secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Pushing to `main`
deploys to production. `ci.yml` reruns the full pipeline on every push.

## Data sources

- NASA POWER climatology API: https://power.larc.nasa.gov/
- Mars target values: REMS (Gale), MEDA (Jezero), Viking 2 (Utopia), HiRISE skylight
  catalog (Pavonis Mons).
- Moon target values: LRO Diviner temperatures, LOLA topography, illumination maps,
  Kaguya Marius Hills skylight (Haruyama et al. 2009).
- Site selection and training labels follow published analog literature
  (Navarro-Gonzalez et al. 2003/2006, ESA PANGAEA, NASA Haughton-Mars Project, AMASE,
  ISRO Ladakh and Lonar studies, Qaidam Mars-analog work, and others).

## License

MIT.
