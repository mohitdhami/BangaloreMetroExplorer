# Namma Metro Explorer

An interactive, responsive map of Bengaluru's **currently operating** Namma Metro network, built with [MapLibre GL JS](https://maplibre.org/) and the [OpenFreeMap](https://openfreemap.org/) basemap. It covers the Purple, Green and Yellow lines: **83 unique stations** and **96.1 km** at the 25 October 2026 snapshot.

The page is a static site — no build step, framework or API key is needed to view it.

## Run it

Open `index.html` directly, or serve the folder locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

An internet connection is required for MapLibre GL JS (unpkg), the OpenFreeMap basemaps and Google Fonts. The metro dataset is embedded in `data/metro-data.js`, so it also works when the page is opened from disk (`file://`) in a modern browser with WebGL.

## Features

- Three operating lines drawn from OpenStreetMap route geometry, with colour-coded stations and interchanges.
- Click a line in the sidebar, legend or map to focus it; click a station dot, a route stop or a search result to open its details.
- Line drawer with route length, station count, journey time, opening history, depots and the full station sequence.
- Station drawer with BMRCL station code, type, opening year, line membership, connections and previous/next stops.
- Search by station name or code (for example `Majestic` or `KGWA`). Press `/` to focus search, use arrow keys to browse and Enter to select.
- Four OpenFreeMap styles: Positron, Liberty, Bright and Night. The choice is remembered in `localStorage`.
- Shareable hash state, for example:
  - `#style=dark&line=yellow`
  - `#style=bright&station=mahatma-gandhi-road`
  - `#line=purple`
- Desktop sidebar and mobile bottom-sheet layouts; choosing a line or station on mobile collapses the network panel and opens the detail sheet over the map.
- Network fit, zoom controls, geolocation with nearest-station feedback, reduced-motion support and keyboard-operable controls.

## Data

| Line | Stations | Official length | OSM geometry length | End to end | Opened | Last extension |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Purple | 37 | 43.49 km | 43.52 km | 80 min | 20 Oct 2011 | 9 Oct 2023 |
| Green | 32 | 33.46 km | 33.94 km | 61 min | 1 Mar 2014 | 7 Nov 2024 |
| Yellow | 16 | 19.15 km | 18.09 km | 40 min | 10 Aug 2025 | 10 Aug 2025 |

- **Geometry:** OpenStreetMap route relations [1798771](https://www.openstreetmap.org/relation/1798771) (Purple), [1798772](https://www.openstreetmap.org/relation/1798772) (Green) and [19421944](https://www.openstreetmap.org/relation/19421944) (Yellow), simplified for display. OSM data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).
- **Station positions and codes:** ordered `stop_position` members of those OSM relations, cross-checked against BMRCL and public station lists. Fallback station names, sequence numbers and coordinates come from the [Bengaluru Metro Network Dataset](https://github.com/Vinayak-Chinchakhandi/Bengaluru-Metro-Network-Dataset) table. A small fallback set in `scripts/build-data.py` supplies official codes where the OSM stop node has none.
- **Route lengths:** official BMRCL/Wikipedia figures are shown in the interface. OSM geometry lengths are retained in the dataset (`measuredKm`) for reference; short gaps at terminal platforms and simplification explain the differences.
- **Network facts:** 9.16 lakh average daily rides, 11.20 lakh record ridership on 10 August 2026, ₹10–₹90 fares (5% smart-card discount), 05:00–23:00 service (Sunday from 07:00), 3–15 minute headways and an 80 km/h top speed.

### Scope

Only lines currently carrying passengers are mapped. The Pink Line's 7.5 km elevated section (Kalena Agrahara–Tavarekere) is awaiting final safety approval, and the Blue Line (Central Silk Board–K.R. Puram–Kempegowda International Airport) is under construction. Future-line connections appear only as text in station connection chips; they are not drawn on the map.

## Project structure

```text
index.html                 Page shell, controls and external dependencies
styles.css                 Layout, drawer, desktop/mobile and dark-theme styling
app.js                     Map layers, interactions, search, detail views and URL state
data/metro-data.js         Generated browser-ready dataset (embedded via window.METRO_DATA)
data/metro-data.json       Generated dataset for inspection or reuse
scripts/build-data.py      Rebuilds both data files from OSM and the source station table
```

## Rebuild the dataset

```bash
python3 scripts/build-data.py
```

The script uses only the Python standard library. It downloads the OSM relations and a station table into `.cache/` on first run, then writes both `data/metro-data.js` and `data/metro-data.json`. The cache is disposable — delete it to force a fresh download.

To update station connections, types or opening years, edit the curated maps near the top of `scripts/build-data.py` (`ROUTES`, `CONNECTIONS`, `STATION_CODE_FALLBACKS` and `MAJOR_STATIONS`). If OSM changes a route relation in a way that no longer matches the expected stop count, the build fails loudly rather than silently producing a broken line.

## Notes and limitations

- This is a network explorer, not a journey planner: it does not provide live train times, disruptions or fare calculations.
- Basemap labels can change when OpenFreeMap updates its styles. City-level basemap labels are hidden so they do not compete with metro station labels; the other geographic labels remain for context.
- The OpenFreeMap Night style emits a harmless third-party warning about its `wood-pattern` sprite. It does not affect the metro layer; the map still falls back cleanly.
- Station codes follow the abbreviations supplied by the sources and may change if BMRCL renames a station.

## Credits

- Map rendering: MapLibre GL JS 5.6.1.
- Basemap styles and tiles: OpenFreeMap, OpenMapTiles, OpenStreetMap contributors.
- Network data: BMRCL, OpenStreetMap contributors, Wikipedia.
- Typography: Manrope and IBM Plex Mono via Google Fonts.
