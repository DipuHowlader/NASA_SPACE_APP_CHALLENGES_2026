# Integrating the Analog API into the XORA website

The API is CORS-enabled, so any frontend can call it directly. For a public site,
protect the API key by proxying calls through your own backend instead of embedding
the key in client code.

Base URL: `https://<analog-api-project>.vercel.app`

## 1. Recommended pattern (key stays server-side)

Next.js route handler example (`app/api/analog/route.ts` on your site):

```ts
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const upstream = new URL("https://<analog-api-project>.vercel.app/api/search");
  upstream.searchParams.set("target", searchParams.get("target") ?? "mars_jezero");
  upstream.searchParams.set("top", searchParams.get("top") ?? "5");

  const r = await fetch(upstream, {
    headers: { "X-Api-Key": process.env.ANALOG_API_KEY! }, // set in Vercel env vars
  });
  return Response.json(await r.json(), { status: r.status });
}
```

Your frontend then calls `/api/analog?target=mars_jezero` and the key is never exposed.

## 2. Direct browser call (prototype/demo only)

```js
const API = "https://<analog-api-project>.vercel.app";
const KEY = "xora_live_..."; // demo keys only

// public metadata - no key needed
const targets = await fetch(`${API}/api/targets`).then(r => r.json());

// ranked analogs - key required
const res = await fetch(`${API}/api/search?target=mars_jezero&top=5`, {
  headers: { "X-Api-Key": KEY },
});
if (!res.ok) {
  const { error } = await res.json();
  // handle: MISSING_KEY / INVALID_KEY / RATE_LIMITED (429)
}
const { results, target } = await res.json();

for (const r of results) {
  // r.rank, r.score (0-100), r.site.name/country/coords
  // r.why_analog - why this site is analogous
  // r.breakdown_limitations - site-specific mismatch
  // r.strengths[], r.gaps[] - short dimension summaries
  // r.breakdown[] - every dimension: label, site_value, target_value, similarity, weight
  // target.universal_breakdown[] - gravity/atmosphere/radiation lines
}
```

## 3. Custom-planet mode (power feature)

Users can build their own target (sliders for temperature, aridity, terrain tags) and
send the feature vector directly:

```js
const res = await fetch(`${API}/api/search`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Api-Key": KEY },
  body: JSON.stringify({
    top: 5,
    features: {
      temp_mean_c: -60,      // °C
      precip_mm_yr: 0,       // mm/yr
      barrenness: 1.0,       // 0-1
      impact_crater: 1.0,    // 0-1
      permafrost_ice: 0.5,   // 0-1
      subsurface_cave: 0.5,  // 0-1
      // ...any subset of the 20 scoring features (see GET /api/model)
    },
  }),
});
```

## 4. UI ideas

- Bar or radar chart of `r.breakdown` (see `public/index.html` in the API repo).
- Score badge from `r.score` with tooltips on `strengths` and `gaps`.
- Map view of `r.site.coords` colored by score (Leaflet/Mapbox free tiers).
- Flow: user picks a Mars target, sees the top Earth analogs, opens a card with
  `why_analog`, `key_studies` and `universal_breakdown`.

## 5. Rate limits

The `xora-website` key allows 300 requests per hour. If you need more, generate
another key in the API repo with `npm run key`.
