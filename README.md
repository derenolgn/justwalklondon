# Just Walk, London

**At rush hour, some of London's most crowded Tube journeys are quicker on foot.**

An interactive data story built for Imperial College London's **Data Observatory**, a room-sized wall of screens. It uses TfL open data to show how the city's transport network breathes through a typical weekday, where the trains are most packed, and which of those packed hops you could simply walk instead.

At 08:30, around **5,900 people ride the Victoria line from Euston to Warren Street in a single 15-minute window**. The walk takes **9 minutes**.

---

## The story: three scenes

An operator drives the wall from a tablet (`/control`), choosing a scene and scrubbing through the day in 15-minute steps (or pressing **Play**).

| Scene                 | What you see                                                                                                                          | Data                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **1 · The heartbeat** | Every Tube and rail station pulses with the number of people entering and leaving it. The morning flood into Zone 1, the evening ebb. | NUMBAT station entries + exits        |
| **2 · The crush**     | Every link between adjacent stations, coloured and thickened by how many passengers are on the trains.                                | NUMBAT link loads                     |
| **3 · Just walk**     | The 6 busiest hops right now that TfL says take **10 minutes or less to walk**, highlighted and labelled.                             | NUMBAT link loads × TfL walking times |

A large clock and a live headline statistic sit on one corner of the wall, sized to be readable from about 10 m away. All primary text (headings, stats, ranking rows) is at least 21% of one screen's height, meeting the DO guideline of 20%; supporting notes and map labels use a smaller secondary size, and the type scale lives in one constant (`TYPE` in `wall-overlay.tsx`).

## Data

All data is open data from Transport for London.

- **NUMBAT 2025, typical Tuesday–Thursday** ([crowding.data.tfl.gov.uk](https://crowding.data.tfl.gov.uk)): station entries, exits and link loads for London Underground, Overground, DLR and the Elizabeth line, in 96 quarter-hour slices from 05:00.
- **Approximate walking times between adjacent stations, Zones 1–3** ([tfl.gov.uk/walking](https://tfl.gov.uk/walking)): TfL's own estimates, used for the walking-time map.
- **Station locations** from the [TfL Unified API](https://api-portal.tfl.gov.uk/) (`/Line/{id}/StopPoints`).

The map is limited to **Zones 1–3**, the area the walking-time data covers. NUMBAT figures describe an average weekday, not a specific date.

### How the data is processed

`scripts/build_data.py` joins the three sources into one compact file, `apps/website/public/data/rush.json`:

1. Reads station entries/exits and link loads from the NUMBAT workbook.
2. Normalises station names (e.g. `Euston LU`, `Euston Underground Station`, `Euston`) so the three sources line up.
3. Attaches coordinates from the TfL API and walking times to each station-to-station link.
4. Rounds all counts to integers to keep the payload small.

Result: about 416 stations and 1,140 links, 210 of which are 10 minutes or less on foot. The unmatched stations are tram stops, which are outside the story.

## Running it

Requires Node 18+ and pnpm (via `corepack enable`).

```bash
pnpm install
pnpm dev
```

Then open:

| URL                                      | What it is                                                      |
| ---------------------------------------- | --------------------------------------------------------------- |
| `http://localhost:5780/control`          | Operator controller: scenes, time slider, Play, zoom            |
| `http://localhost:5780/screen?preview=1` | The whole wall in one browser window (drag / scroll to explore) |
| `http://localhost:5780/screen?c=0&r=0`   | One physical wall tile (column `c`, row `r`)                    |
| `http://localhost:5780/`                 | Simulator: 6 wall tiles + 2 controllers on one page             |

### Rebuilding the data

Raw TfL files are not committed. To regenerate `rush.json`:

1. Download into `data-raw/`:
    - `NBT25TWT_Outputs.xlsx` from crowding.data.tfl.gov.uk (NUMBAT 2025 folder)
    - `LU_DLR_LO_NR_Zones_1-3_-_approximate_walk_times.xlsx` from tfl.gov.uk/walking
2. Get a free key at [api-portal.tfl.gov.uk](https://api-portal.tfl.gov.uk/) and put `TFL_APP_KEY=...` in `.env`.
3. Run:

```bash
pip3 install pandas openpyxl
python3 scripts/build_data.py
```

## How it's built

- **React + TanStack Router/Start**, run with [Vite+](https://viteplus.dev).
- **Deck.GL** (`LineLayer`, `ScatterplotLayer`, `TextLayer`) over a **MapLibre** basemap (CARTO Dark Matter). Inside wall iframes, a lighter MapLibre-only renderer avoids running out of WebGL contexts.
- **Control / screen separation over WebSockets** (`/bus`). The controller sends small commands (`screen/rush` with a time slice or scene); every screen renders independently and stays in sync. Late-joining screens receive the current state on connect.
- **Wall-aware camera.** Each tile computes its own slice of one shared map view, so the wall reads as a single continuous map.
- **Viewer comfort.** Data changes ease over about one second, autoplay advances one quarter hour every 1.5 s, and the palette is muted, with no flashing, as recommended for the Data Observatory.

Key files:

```
scripts/build_data.py                          data pipeline
apps/website/src/lib/realtime/rush-data.ts     loading, validation, "walkable" logic
apps/website/src/routes/screen.tsx             wall rendering (three scenes)
apps/website/src/routes/control.tsx            operator controller
apps/website/src/routes/bus.ts                 WebSocket bus + shared state
```

## Limitations and next steps

- Walking times are TfL's approximations and only cover adjacent stations in Zones 1–3.
- Link loads count passengers per hop, so one journey through several walkable hops is counted on each.
- NUMBAT shows a typical weekday; it can't show disruptions, weather or specific events.
- Ideas: a weekday vs weekend toggle (NUMBAT has Friday, Saturday and Sunday files), estimated time saved per walk, and step-free access as an accessibility layer.

## Credits

Built by **Deren Olgun** for Imperial College London's Data for Humanity internship application.
Based on the [DO starter playground](https://github.com/dsi-icl/do-starter-playground) by the Data Science Institute, Imperial College London (Apache-2.0).
Contains TfL data. Powered by TfL Open Data. Map tiles © CARTO, © OpenStreetMap contributors.
