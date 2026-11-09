"""
Build the dataset for "Just Walk, London".

Inputs (put in ./data-raw/):
  NBT25TWT_Outputs.xlsx                                   NUMBAT 2025, typical Tue-Thu
  LU_DLR_LO_NR_Zones_1-3_-_approximate_walk_times.xlsx    TfL adjacent-station walk times

Output:
  apps/website/public/data/rush.json

Station coordinates come from the TfL Unified API (key read from .env: TFL_APP_KEY).
The API response is cached in data-raw/stoppoints.json so you only fetch once.

Run:  python3 scripts/build_data.py
"""
import json, os, re, sys, urllib.request
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-raw"
OUT = ROOT / "apps/website/public/data/rush.json"
NUMBAT = RAW / "NBT25TWT_Outputs.xlsx"
WALK = RAW / "LU_DLR_LO_NR_Zones_1-3_-_approximate_walk_times.xlsx"
CACHE = RAW / "stoppoints.json"
MODES = "tube,dlr,overground,elizabeth-line"


def env_key():
    if os.environ.get("TFL_APP_KEY"):
        return os.environ["TFL_APP_KEY"]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("TFL_APP_KEY="):
                return line.split("=", 1)[1].strip()
    sys.exit("No TFL_APP_KEY found in .env")


def norm(s):
    """Normalise station names so NUMBAT, walk-time and API names match."""
    s = str(s).lower()
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"\b(underground|dlr|rail|overground|elizabeth line)?\s*station\b", "", s)
    s = re.sub(r"\b(lu|dlr|lo|nr|el|tfl)\b", "", s)
    s = s.replace("&", "and").replace("'", "").replace("st.", "st")
    return re.sub(r"[^a-z]", "", s)


def load_coords():
    if not CACHE.exists():
        url = f"https://api.tfl.gov.uk/StopPoint/Mode/{MODES}?app_key={env_key()}"
        print("Fetching station locations from TfL API (takes ~30s)...")
        with urllib.request.urlopen(url, timeout=120) as r:
            CACHE.write_bytes(r.read())
    data = json.loads(CACHE.read_text())
    pts = data["stopPoints"] if isinstance(data, dict) else data
    coords = {}
    for p in pts:
        if p.get("stopType") not in ("NaptanMetroStation", "NaptanRailStation"):
            continue
        coords.setdefault(norm(p["commonName"]), (round(p["lat"], 5), round(p["lon"], 5)))
    # NUMBAT names that differ from the API's names
    aliases = {"bankandmonument": "bank", "heathrowterminals": "heathrowterminalsand"}
    for numbat_key, api_key in aliases.items():
        if api_key in coords:
            coords.setdefault(numbat_key, coords[api_key])
    return coords


def qhr_cols(df):
    # 96 quarter-hour columns, 0500-0515 ... 0445-0500 (service day order)
    return [c for c in df.columns if isinstance(c, str) and re.fullmatch(r"\d{4}-\d{4}", c)]


def main():
    coords = load_coords()

    ent = pd.read_excel(NUMBAT, sheet_name="Station_Entries", header=2)
    ext = pd.read_excel(NUMBAT, sheet_name="Station_Exits", header=2)
    links = pd.read_excel(NUMBAT, sheet_name="Link_Loads", header=2)
    walk = pd.read_excel(WALK)
    Q = qhr_cols(ent)

    # Stations: entries/exits per 15 min, integers to keep payload small
    ext_by = ext.set_index("NLC")
    stations, missing = {}, []
    for _, r in ent.iterrows():
        k = norm(r["Station"])
        if k not in coords:
            missing.append(r["Station"])
            continue
        x = ext_by.loc[r["NLC"]] if r["NLC"] in ext_by.index else None
        stations[k] = {
            "name": re.sub(r"\s+(LU|NR|DLR|LO|EL)$", "", str(r["Station"])),
            "zone": str(r["Fare Zone"]),
            "lat": coords[k][0], "lon": coords[k][1],
            "entries": [int(round(r[c])) for c in Q],
            "exits": [int(round(x[c])) for c in Q] if x is not None else None,
        }

    # Walk times (adjacent stations, both directions)
    wm = {}
    for _, r in walk.iterrows():
        a, b, t = norm(r["From"]), norm(r["To"]), r["Time to use on map"]
        if pd.notna(t):
            wm[(a, b)] = wm[(b, a)] = int(t)

    # Links: train load between adjacent stations, per 15 min
    out_links = []
    for _, r in links.iterrows():
        a, b = norm(r["From Station"]), norm(r["To Station"])
        if a not in stations or b not in stations:
            continue
        out_links.append({
            "from": a, "to": b, "line": r["Line"], "dir": r["Dir"],
            "walk": wm.get((a, b)),
            "load": [int(round(r[c])) for c in Q],
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "TfL NUMBAT 2025 (typical Tue-Thu), TfL walking times Zones 1-3",
        "slices": Q, "stations": stations, "links": out_links,
    }, separators=(",", ":")))

    walkable = [l for l in out_links if l["walk"] and l["walk"] <= 10]
    print(f"Stations: {len(stations)} (no coords for {len(missing)})")
    print(f"Links: {len(out_links)}, walkable <=10 min: {len(walkable)}")
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
    if missing:
        print("Unmatched stations (fine to ignore if small):", ", ".join(missing[:30]))


if __name__ == "__main__":
    main()
