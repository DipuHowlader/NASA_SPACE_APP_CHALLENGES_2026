# Model Card — Planetary Analog Finder (v1.0.0)

Trained 2026-11-13T09:42:31+00:00

## What the model does
Scores how closely an Earth candidate site matches a Moon/Mars exploration
target across 20 dimensions (NASA POWER climate + curated geology/terrain),
using weights learned from 47 expert-labeled analog pairs.

## Algorithm
1. Per-dimension similarity `s_i = exp(-0.5 ((x_i - t_i)/sigma_i)^2)` for continuous
   features (`sigma_i = 0.30 x span`), `s_i = 1 - |x_i - t_i|` for binary tags.
2. Ridge regression maps the similarity vector to expert scores (scale 0-1).
3. Learned coefficients are clipped at 0, normalized to sum 1, and deployed as the
   final weighted similarity: `score = sum_i w_i * s_i` (0-100 scale in the API).

## Hyperparameters
- Alpha selected by leave-one-out CV over [0.03, 0.1, 0.3, 1.0, 3.0, 10.0, 30.0, 100.0] -> **alpha = 1.0** (deployed-form LOO MAE 0.1176).

## Metrics (label = expert pair score, 0-1; deployed pipeline evaluated)
| Metric | Learned weights | Baseline (mean predictor) |
|---|---|---|
| MAE | 0.0971 | 0.1131 |
| RMSE | 0.1118 | — |
| R2 | 0.2976 | — |
| Pearson r | 0.5455 | — |
| Leave-one-out MAE | 0.1176 | — |

Calibration: score = 0.833 x (weighted similarity) + 0.189, clipped to [0,1].

## Learned feature weights (deployed)
| Feature | Source | Weight |
|---|---|---|
| Impact crater structure (`impact_crater`) | Curated (geologic maps) | 0.134 |
| Permafrost / ground ice (`permafrost_ice`) | Curated (geologic maps) | 0.127 |
| Local relief within study area (`relief_m`) | Curated (DEMs/literature) | 0.121 |
| Mean diurnal temperature range (`diurnal_range_c`) | NASA POWER | 0.106 |
| Evaporite / salt flat terrain (`salt_flat`) | Curated (geologic maps) | 0.101 |
| Caves / lava tubes (`subsurface_cave`) | Curated (geologic maps) | 0.083 |
| Mean annual air temperature (2 m) (`temp_mean_c`) | NASA POWER | 0.076 |
| Coldest-month mean daily min temperature (`temp_min_c`) | NASA POWER | 0.068 |
| Barrenness index (0 vegetated - 1 abiotic) (`barrenness`) | Curated | 0.066 |
| Basaltic volcanic terrain (`volcanic_basalt`) | Curated (geologic maps) | 0.059 |
| Dune fields / yardangs (aeolian) (`aeolian_dunes`) | Curated (geologic maps) | 0.048 |
| Ophiolite / olivine-rich crust (`ophiolite_olivine`) | Curated (geologic maps) | 0.009 |
| Warmest-month mean daily max temperature (`temp_max_c`) | NASA POWER | 0.000 |
| Mean annual precipitation (`precip_mm_yr`) | NASA POWER | 0.000 |
| Mean wind speed (2 m) (`wind_mean_ms`) | NASA POWER | 0.000 |
| Minimum monthly mean relative humidity (`rh_min_pct`) | NASA POWER | 0.000 |
| Mean daily surface solar irradiance (`solar_kwh_m2_day`) | NASA POWER | 0.000 |
| Paleolake / fluvial landforms (`fluvial_paleolake`) | Curated (geologic maps) | 0.000 |
| Hydrothermal / acid-sulfate alteration (`hydrothermal_acid`) | Curated (geologic maps) | 0.000 |
| Extremophile / astrobiology studies (`extremophile_studies`) | Curated (literature) | 0.000 |

## Training pairs
| Earth site | Space target | Expert score | Rationale |
|---|---|---|---|
| yungay_chile | mars_jezero | 0.90 | Canonical Mars soil analog: perchlorate-bearing, organic-depleted soils under hyperaridity |
| pampas_joya | mars_gale | 0.92 | Dry-limit soils used to calibrate life-detection; strongest aridity analog in the catalog. |
| danakil_dallol | mars_jezero | 0.72 | Acid-sulfate brines and iron-oxide terraces mirror Meridiani-type alteration; habitability |
| qaidam_yardangs | mars_jezero | 0.85 | Published Mars analog: yardangs + sulfates + hyperaridity at altitude; terrain-process mat |
| lut_gandom | mars_gale | 0.68 | Hottest measured land surface plus yardang province — thermal and aeolian-process analog. |
| bodele | mars_jezero | 0.55 | Process-only analog: world's largest dust source vs martian dust storms; geology does not  |
| namib_sand_sea | mars_gale | 0.75 | Full dune-type inventory (star/linear/barchan) matches Bagnold-dune morphology classes. |
| merzouga_erg | mars_gale | 0.65 | Compact barchan field analog for martian dunes and granular-mobility testing. |
| taklamakan | mars_jezero | 0.55 | Dust-lifting and storm-propagation process analog; otherwise dissimilar geology. |
| ladakh_puga | mars_jezero | 0.80 | Cold high-altitude desert with permafrost, springs and rover trials — multi-dimensional IS |
| svalbard_billefjorden | mars_utopia | 0.82 | Permafrost polygons and ground ice mirror Utopia's polygonal patterned ground. |
| dry_valleys | mars_utopia | 0.85 | Benchmark cold-desert permafrost analog; canonical but retained as calibration. |
| puna_antofalla | mars_jezero | 0.62 | High-altitude UV and salars approximate early-Mars surface chemistry; moderate overall. |
| el_tatio | mars_gale | 0.55 | Dust devils + hydrothermal sinter under high UV; thermal springs are the mismatch. |
| semail_ophiolite | mars_jezero | 0.72 | Olivine-rich crust with serpentinization habitability — matches Jezero's mafic-floor miner |
| troodos_ophiolite | mars_jezero | 0.68 | Subsurface H2-driven habitability analog in mafic crust. |
| erta_ale | mars_pavonis_skylight | 0.60 | Active basaltic shield volcanism process analog for Tharsis; no preserved tubes. |
| tolbachik | mars_pavonis_skylight | 0.65 | Fissure-fed basalt plains with tubes and ash zones; Russian planetary training analog. |
| harrat_rahat | mars_pavonis_skylight | 0.62 | Vast young basalt field used for Mars-mission field exercises. |
| lanzarote_corona | mars_pavonis_skylight | 0.88 | The strongest lava-tube/skylight analog in the catalog; ESA PANGAEA training site. |
| nullarbor | moon_hadley | 0.45 | Cave + meteorite-surface operations analog; geology mismatch for mare basalt. |
| turpan | mars_gale | 0.60 | Thermal-extreme, below-sea-level arid basin analog. |
| al_wahbah | mars_jezero | 0.55 | Small crater + evaporite floor combination; volcanic genesis is the mismatch. |
| chott_el_jerid | mars_gale | 0.50 | Evaporite crust polygon analog; otherwise wet and flat. |
| salar_uyuni | mars_gale | 0.55 | Large-scale evaporite terrain analog for martian chloride/sulfate regions. |
| lonar | moon_maria | 0.80 | Only Earth impact crater in flood basalt — the closest analog for craters in mare crust (I |
| meteor_crater | moon_maria | 0.85 | Benchmark fresh simple-crater morphology; Apollo-era training site. |
| tenoumer | moon_maria | 0.75 | Young simple crater in hard basement rock, crisp rim/ejecta. |
| wolfe_creek | moon_maria | 0.72 | Well-preserved simple crater interacting with dune sediments. |
| gosses_bluff | moon_hadley | 0.55 | Deeply eroded complex-crater ring — analog for degraded ancient craters, not fresh morphol |
| wabar_craters | moon_maria | 0.60 | Impact into loose sand = regolith-crater formation process analog at small scale. |
| craters_of_the_moon | moon_maria | 0.78 | Basalt plains + lava tubes; Apollo-era NASA analog for mare-plains operations. |
| deccan_traps | moon_maria | 0.62 | Flood-basalt plains analog for maria; weathering/vegetation reduce the match. |
| putorana_traps | moon_hadley | 0.58 | Basalt plateaus + deep canyon walls; permafrost cover mutes the match. |
| vidgelmir | moon_marius | 0.85 | Large intact lava tube — interior microenvironment analog for Kaguya skylight target. |
| askja | moon_marius | 0.75 | Apollo-trained volcanic field; caldera/rille-like volcanic landforms. |
| askja | moon_hadley | 0.70 | Apollo 15-era Iceland training context; volcanic collapse structures. |
| haughton_crater | moon_south_pole | 0.60 | Polar impact-crater operations analog; thermal cycle far milder than lunar PSRs. |
| frontier_blue_ice | moon_south_pole | 0.50 | Cryogenic sample-recovery process analog; not a landform analog. |
| roter_kamm | moon_maria | 0.65 | Impact crater partially buried by dunes — degradation-process analog. |
| movile_cave | mars_pavonis_skylight | 0.55 | Sealed chemosynthetic subsurface ecosystem — habitability-inside-caves analog. |
| semail_ophiolite | moon_maria | 0.55 | Olivine lithology matches mare basalts; tectonic setting does not. |
| white_sands | mars_gale | 0.45 | Bright high-albedo dunes and dust devils; gypsum chemistry is the mismatch. |
| kilbourne_hole | moon_maria | 0.60 | Official Apollo 17 training crater with olivine-bearing xenoliths. |
| yungay_chile | moon_south_pole | 0.35 | Weak: aridity helps, but lunar thermal cycle/vacuum dominate the mismatch. |
| qaidam_yardangs | mars_gale | 0.78 | Mars-like yardangs + sulfates + cold winters — a strong all-round Mars analog. |
| etosha_pan | mars_jezero | 0.50 | Playa desiccation analog for paleolake floors; biology and rainfall present. |

## Limitations (read before trusting)
- Labels are informed expert judgments (published analog literature), not ground truth.
- 47 pairs vs 20 features: heavy regularization is intentional; weights are conservative.
- NASA POWER is MERRA-2 reanalysis (~0.5 deg grid): climate values for a site are
  grid-cell-scale, and reanalysis can overestimate precipitation in complex terrain
  (e.g., Putorana, Danakil). Relative ranking between sites is more robust than absolutes.
- The metric knows nothing about gravity, atmospheric pressure, or radiation — those
  are reported as explicit 'where the analogy breaks down' fields in every API response.
