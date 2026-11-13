#!/usr/bin/env python3
"""
train_model.py — Model training step
Trains the analog-similarity model from expert-labeled pairs using
scikit-learn ridge regression, evaluates it, and exports:

  model/model.json            trained artifact (feature weights + sigmas + metrics)
  model/training_report.md    human-readable model card
  lib/data/model.mjs          runtime module for the Vercel API
  lib/data/targets.mjs        runtime module with Moon/Mars targets

Method
------
Each labeled pair (Earth site, Moon/Mars target) becomes a vector of
per-dimension similarities s_i (Gaussian kernels for continuous features,
exact-match similarity for binary geology tags). A ridge model maps
s -> expert score. The learned, non-negative, normalized coefficients become
the final feature weights of the deployed weighted-similarity metric.

  python scripts/train_model.py
"""

import json
import pathlib
import datetime as dt

import numpy as np
from sklearn.linear_model import Ridge
from sklearn.model_selection import LeaveOneOut

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MODEL_DIR = ROOT / "model"
LIB = ROOT / "lib" / "data"

MODEL_VERSION = "1.0.0"
SIGMA_FRACTION = 0.30  # kernel width as fraction of feature span

FEATURES = [
    ("temp_mean_c", "Mean annual air temperature (2 m)", "\u00b0C", "continuous", "NASA POWER"),
    ("temp_max_c", "Warmest-month mean daily max temperature", "\u00b0C", "continuous", "NASA POWER"),
    ("temp_min_c", "Coldest-month mean daily min temperature", "\u00b0C", "continuous", "NASA POWER"),
    ("diurnal_range_c", "Mean diurnal temperature range", "\u00b0C", "continuous", "NASA POWER"),
    ("precip_mm_yr", "Mean annual precipitation", "mm/yr", "continuous", "NASA POWER"),
    ("wind_mean_ms", "Mean wind speed (2 m)", "m/s", "continuous", "NASA POWER"),
    ("rh_min_pct", "Minimum monthly mean relative humidity", "%", "continuous", "NASA POWER"),
    ("solar_kwh_m2_day", "Mean daily surface solar irradiance", "kWh/m2/day", "continuous", "NASA POWER"),
    ("relief_m", "Local relief within study area", "m", "continuous", "Curated (DEMs/literature)"),
    ("barrenness", "Barrenness index (0 vegetated - 1 abiotic)", "0-1", "continuous", "Curated"),
    ("volcanic_basalt", "Basaltic volcanic terrain", "0-1", "binary", "Curated (geologic maps)"),
    ("impact_crater", "Impact crater structure", "0-1", "binary", "Curated (geologic maps)"),
    ("aeolian_dunes", "Dune fields / yardangs (aeolian)", "0-1", "binary", "Curated (geologic maps)"),
    ("salt_flat", "Evaporite / salt flat terrain", "0-1", "binary", "Curated (geologic maps)"),
    ("permafrost_ice", "Permafrost / ground ice", "0-1", "binary", "Curated (geologic maps)"),
    ("subsurface_cave", "Caves / lava tubes", "0-1", "binary", "Curated (geologic maps)"),
    ("fluvial_paleolake", "Paleolake / fluvial landforms", "0-1", "binary", "Curated (geologic maps)"),
    ("hydrothermal_acid", "Hydrothermal / acid-sulfate alteration", "0-1", "binary", "Curated (geologic maps)"),
    ("ophiolite_olivine", "Ophiolite / olivine-rich crust", "0-1", "binary", "Curated (geologic maps)"),
    ("extremophile_studies", "Extremophile / astrobiology studies", "0-1", "binary", "Curated (literature)"),
]


def dim_similarity(kind, x, t, sigma):
    """Per-dimension similarity in [0,1]."""
    if kind == "binary":
        return 1.0 - min(1.0, abs(x - t))
    z = (x - t) / sigma
    return float(np.exp(-0.5 * z * z))


def main() -> None:
    dataset = json.loads((DATA / "dataset.json").read_text(encoding="utf-8"))
    targets_doc = json.loads((DATA / "targets_space.json").read_text(encoding="utf-8"))
    pairs_doc = json.loads((DATA / "expert_pairs.json").read_text(encoding="utf-8"))

    sites = {s["key"]: s["features"] for s in dataset["sites"]}
    targets = {t["key"]: t["features"] for t in targets_doc["targets"]}

    # ---- 1. Kernel widths: sigma_i = 0.3 * span(feature over sites+targets) ----
    sigmas, spans = {}, {}
    for key, _label, _unit, kind, _src in FEATURES:
        if kind != "continuous":
            sigmas[key] = None
            spans[key] = None
            continue
        vals = [v for v in (s.get(key) for s in sites.values()) if v is not None]
        vals += [v for v in (t.get(key) for t in targets.values()) if v is not None]
        if not vals:
            sigmas[key], spans[key] = 1.0, 0.0
            continue
        span = float(max(vals) - min(vals))
        spans[key] = round(span, 3)
        sigmas[key] = max(span * SIGMA_FRACTION, 1e-3)

    # ---- 2. Build labeled pairwise-similarity matrix ----
    rows, ys, used = [], [], []
    for p in pairs_doc["pairs"]:
        sfeat, tfeat = sites.get(p["site"]), targets.get(p["target"])
        if sfeat is None or tfeat is None:
            continue
        row, missing = [], False
        for key, _l, _u, kind, _src in FEATURES:
            x, t, sg = sfeat.get(key), tfeat.get(key), sigmas[key]
            if x is None or t is None:
                row.append(0.0)  # constant column; harmless (weight -> 0)
                continue
            row.append(dim_similarity(kind, x, t, sg))
        rows.append(row)
        ys.append(float(p["score"]))
        used.append(p)
    X = np.asarray(rows)
    y = np.asarray(ys)

    # ---- 3. Ridge + calibration, evaluated as the deployed pipeline ----
    # Deployed form: score = clip(a * sum_i w_i * s_i + b, 0, 1)
    #   w_i : ridge coefficients, clipped >= 0 and normalized (importance shares)
    #   a,b : monotone linear calibration fitted to expert labels
    def fit_deployed(X_fit, y_fit, alpha):
        m = Ridge(alpha=alpha).fit(X_fit, y_fit)
        w = np.clip(m.coef_, 0.0, None)
        s = w.sum()
        w = w / s if s > 0 else np.full_like(w, 1.0 / len(w))
        base = X_fit @ w
        a_cal, b_cal = np.polyfit(base, y_fit, 1)
        return w, float(a_cal), float(b_cal)

    def predict_deployed(X_eval, w, a_cal, b_cal):
        return np.clip(a_cal * (X_eval @ w) + b_cal, 0.0, 1.0)

    alphas = [0.03, 0.1, 0.3, 1.0, 3.0, 10.0, 30.0, 100.0]
    loo = LeaveOneOut()
    loo_scores = {}
    nonzero_by_alpha = {}
    for a in alphas:
        preds = np.empty_like(y)
        for tr, te in loo.split(X):
            w_f, a_f, b_f = fit_deployed(X[tr], y[tr], a)
            preds[te[0]] = predict_deployed(X[te], w_f, a_f, b_f)[0]
        loo_scores[a] = float(np.mean(np.abs(preds - y)))
        w_all, _, _ = fit_deployed(X, y, a)
        nonzero_by_alpha[a] = int((w_all > 0.005).sum())
    best_loo = min(loo_scores.values())
    # Within the LOO-MAE noise band (+0.005 on a 0-1 label scale), prefer the
    # most expressive model (most active features), then the smallest alpha.
    candidates = [a for a in alphas if loo_scores[a] <= best_loo + 0.005]
    best_alpha = sorted(candidates, key=lambda a: (-nonzero_by_alpha[a], a))[0]

    weights, cal_a, cal_b = fit_deployed(X, y, best_alpha)
    deployed_pred = predict_deployed(X, weights, cal_a, cal_b)

    def metrics(pred):
        pred = np.asarray(pred)
        mae = float(np.mean(np.abs(pred - y)))
        rmse = float(np.sqrt(np.mean((pred - y) ** 2)))
        ss_res = float(np.sum((pred - y) ** 2))
        ss_tot = float(np.sum((y - y.mean()) ** 2))
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
        r = float(np.corrcoef(pred, y)[0, 1]) if np.std(pred) > 1e-12 else 0.0
        return {"mae": round(mae, 4), "rmse": round(rmse, 4), "r2": round(r2, 4), "pearson_r": round(r, 4)}

    m_learned = metrics(deployed_pred)
    m_baseline = {"mae": round(float(np.mean(np.abs(y - y.mean()))), 4)}
    m_loo = {"loo_mae": round(loo_scores[best_alpha], 4)}

    coef = weights
    # ---- 4. Export artifacts ----
    features_out = [
        {
            "key": key, "label": label, "unit": unit, "kind": kind,
            "source": src,
            "weight": round(float(coef[i]), 4),
            "sigma": (round(sigmas[key], 4) if sigmas[key] is not None else None),
            "span": spans[key],
        }
        for i, (key, label, unit, kind, src) in enumerate(FEATURES)
    ]

    model_json = {
        "meta": {
            "name": "Planetary Analog Finder — weighted analog-similarity model",
            "version": MODEL_VERSION,
            "trained_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "algorithm": "Ridge regression on pairwise expert-similarity labels, non-negative normalized feature weights + monotone linear calibration; deployed as an explainable weighted multi-dimension similarity metric",
            "deployed_formula": "score = clip(calibration_a * sum_i weight_i * s_i + calibration_b, 0, 1); s_i = Gaussian kernel for continuous, 1-|x-t| for binary",
            "calibration": {"a": round(cal_a, 4), "b": round(cal_b, 4)},
            "kernel": f"Gaussian (sigma = {SIGMA_FRACTION:.2f} x feature span) for continuous; exact-match for binary",
            "alpha": best_alpha,
            "alpha_grid": alphas,
            "n_pairs": int(len(y)),
            "n_features": len(FEATURES),
            "labels_scale": "expert similarity 0-1 (see data/expert_pairs.json)",
        },
        "metrics": {**m_learned, **m_loo, "baseline_mean_predictor_mae": m_baseline["mae"]},
        "features": features_out,
    }

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    (MODEL_DIR / "model.json").write_text(json.dumps(model_json, indent=2), encoding="utf-8")
    LIB.mkdir(parents=True, exist_ok=True)
    (LIB / "model.mjs").write_text(
        "// AUTO-GENERATED by scripts/train_model.py — do not edit.\n"
        f"// Trained {model_json['meta']['trained_at']} (alpha={best_alpha}, n_pairs={len(y)})\n"
        "export default " + json.dumps(model_json) + ";\n",
        encoding="utf-8",
    )
    (LIB / "targets.mjs").write_text(
        "// AUTO-GENERATED from data/targets_space.json — do not edit.\n"
        "export default " + json.dumps(targets_doc) + ";\n",
        encoding="utf-8",
    )

    # ---- 5. Training report ----
    w_sorted = sorted(zip(FEATURES, coef), key=lambda t: -t[1])
    weight_lines = "\n".join(
        f"| {f[1]} (`{f[0]}`) | {f[4]} | {w:.3f} |" for f, w in w_sorted
    )
    pair_lines = "\n".join(
        f"| {p['site']} | {p['target']} | {p['score']:.2f} | {p['rationale'][:90]} |"
        for p in used
    )
    report = f"""# Model Card — Planetary Analog Finder (v{MODEL_VERSION})

Trained {model_json['meta']['trained_at']}

## What the model does
Scores how closely an Earth candidate site matches a Moon/Mars exploration
target across {len(FEATURES)} dimensions (NASA POWER climate + curated geology/terrain),
using weights learned from {len(y)} expert-labeled analog pairs.

## Algorithm
1. Per-dimension similarity `s_i = exp(-0.5 ((x_i - t_i)/sigma_i)^2)` for continuous
   features (`sigma_i = {SIGMA_FRACTION:.2f} x span`), `s_i = 1 - |x_i - t_i|` for binary tags.
2. Ridge regression maps the similarity vector to expert scores (scale 0-1).
3. Learned coefficients are clipped at 0, normalized to sum 1, and deployed as the
   final weighted similarity: `score = sum_i w_i * s_i` (0-100 scale in the API).

## Hyperparameters
- Alpha selected by leave-one-out CV over {alphas} -> **alpha = {best_alpha}** (deployed-form LOO MAE {loo_scores[best_alpha]:.4f}).

## Metrics (label = expert pair score, 0-1; deployed pipeline evaluated)
| Metric | Learned weights | Baseline (mean predictor) |
|---|---|---|
| MAE | {m_learned['mae']} | {m_baseline['mae']} |
| RMSE | {m_learned['rmse']} | — |
| R2 | {m_learned['r2']} | — |
| Pearson r | {m_learned['pearson_r']} | — |
| Leave-one-out MAE | {m_loo['loo_mae']} | — |

Calibration: score = {cal_a:.3f} x (weighted similarity) + {cal_b:.3f}, clipped to [0,1].

## Learned feature weights (deployed)
| Feature | Source | Weight |
|---|---|---|
{weight_lines}

## Training pairs
| Earth site | Space target | Expert score | Rationale |
|---|---|---|---|
{pair_lines}

## Limitations (read before trusting)
- Labels are informed expert judgments (published analog literature), not ground truth.
- {len(y)} pairs vs {len(FEATURES)} features: heavy regularization is intentional; weights are conservative.
- NASA POWER is MERRA-2 reanalysis (~0.5 deg grid): climate values for a site are
  grid-cell-scale, and reanalysis can overestimate precipitation in complex terrain
  (e.g., Putorana, Danakil). Relative ranking between sites is more robust than absolutes.
- The metric knows nothing about gravity, atmospheric pressure, or radiation — those
  are reported as explicit 'where the analogy breaks down' fields in every API response.
"""
    (MODEL_DIR / "training_report.md").write_text(report, encoding="utf-8")

    # ---- 6. Console summary ----
    print(f"Trained ridge model: alpha={best_alpha}, pairs={len(y)}, features={len(FEATURES)}")
    print(f"  learned : MAE={m_learned['mae']} RMSE={m_learned['rmse']} R2={m_learned['r2']} r={m_learned['pearson_r']} LOO_MAE={m_loo['loo_mae']}")
    print(f"  baseline mean-predictor MAE={m_baseline['mae']}")
    print("  top weights:")
    for f, w in w_sorted[:6]:
        print(f"    {w:.3f}  {f[0]}")
    print("Wrote model/model.json, model/training_report.md, lib/data/model.mjs, lib/data/targets.mjs")


if __name__ == "__main__":
    main()
