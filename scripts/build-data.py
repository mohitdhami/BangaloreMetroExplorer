#!/usr/bin/env python3
"""Build the Namma Metro map dataset from OpenStreetMap route relations and
public station data. Outputs a JSON file and a browser-friendly JS wrapper.

The route geometries are OSM relation members (ODbL). Station coordinates and
line metadata are compiled from BMRCL/Wikipedia/OSM. Edit the curated maps at
the bottom of this file to update connections, station types or opening years.
"""

from __future__ import annotations

import csv
import json
import math
import os
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
DATA = ROOT / "data"
UA = "NammaMetroExplorer/1.0 (https://openfreemap.org/)"

ROUTES = {
    "purple": {
        "osm_relation": "1798771",  # Whitefield (Kadugodi) -> Challaghatta
        "osm_name": "Purple Line (Whitefield (Kadugodi) → Challaghatta)",
        "csv_line": "Purple Line",
        "name": "Purple Line",
        "short_name": "Purple",
        "color": "#7E22CE",
        "soft": "#F3E8FF",
        "contrast": "#FFFFFF",
        "terminals": ["Whitefield (Kadugodi)", "Challaghatta"],
        "length_km": 43.49,
        "stations": 37,
        "opened": "20 October 2011",
        "last_extension": "9 October 2023",
        "end_to_end_min": 80,
        "operating_speed_kmph": 36,
        "depots": ["Kadugodi", "Challaghatta (under construction)"],
        "description": (
            "Bengaluru's east–west spine, linking Whitefield's tech corridor with "
            "Krishnarajapura, Indiranagar, MG Road, the central business district, "
            "Majestic and the southwestern suburbs. It was the city's first metro line."
        ),
        "neighbourhoods": [
            "Whitefield", "ITPL", "KR Puram", "Indiranagar", "MG Road",
            "CBD", "Majestic", "Vijayanagar", "Kengeri", "Challaghatta",
        ],
        "station_openings": (
            ["2023"] * 13 + ["2011"] * 6 + ["2016"] * 5 +
            ["2015"] * 6 + ["2021"] * 6 + ["2023"]
        ),
        "underground": {
            "Cubbon Park",
            "Dr B R Ambedkar Station Vidhana Soudha",
            "Sir M Visvesvaraya Central College",
            "Nadaprabhu Kempegowda Station Majestic",
            "Krantivira Sangolli Rayanna Railway Station",
        },
        "at_grade": {"Baiyappanahalli"},
    },
    "green": {
        "osm_relation": "1798772",  # Silk Institute -> Madavara
        "osm_name": "Green Line (Silk Institute -> Madavara)",
        "csv_line": "Green Line",
        "name": "Green Line",
        "short_name": "Green",
        "color": "#16A34A",
        "soft": "#DCFCE7",
        "contrast": "#FFFFFF",
        "terminals": ["Madavara", "Silk Institute"],
        "length_km": 33.46,
        "stations": 32,
        "opened": "1 March 2014",
        "last_extension": "7 November 2024",
        "end_to_end_min": 61,
        "operating_speed_kmph": 40,
        "depots": ["Peenya", "Anjanapura (under construction)"],
        "description": (
            "The north–south line, connecting Madavara and the Peenya industrial belt "
            "with Yeshwanthpur, Malleshwaram, Majestic, Basavanagudi, Jayanagar, "
            "Banashankari and the Kanakapura Road suburbs."
        ),
        "neighbourhoods": [
            "Madavara", "Peenya", "Yeshwanthpur", "Malleshwaram", "Majestic",
            "Basavanagudi", "Jayanagar", "Banashankari", "Konanakunte",
            "Thalaghattapura",
        ],
        "station_openings": (
            ["2024"] * 3 + ["2015"] * 3 + ["2014"] * 10 +
            ["2017"] * 11 + ["2021"] * 5
        ),
        "underground": {
            "Nadaprabhu Kempegowda Station Majestic",
            "Chickpete",
            "Krishna Rajendra Market",
        },
        "at_grade": set(),
    },
    "yellow": {
        "osm_relation": "19421944",  # RV Road -> Delta Electronics Bommasandra
        "osm_name": "Yellow Line (Rashtreeya Vidyalaya Road → Delta Electronics Bommasandra)",
        "csv_line": "Yellow Line",
        "name": "Yellow Line",
        "short_name": "Yellow",
        "color": "#EAB308",
        "soft": "#FEF9C3",
        "contrast": "#1F2937",
        "terminals": ["Rashtreeya Vidyalaya Road", "Delta Electronics Bommasandra"],
        "length_km": 19.15,
        "stations": 16,
        "opened": "10 August 2025",
        "last_extension": "10 August 2025",
        "end_to_end_min": 40,
        "operating_speed_kmph": None,
        "depots": ["Hebbagodi"],
        "description": (
            "Bengaluru's newest operational line, opened in August 2025. The fully "
            "elevated corridor runs from RV Road through BTM Layout and Central Silk "
            "Board to Electronic City and Bommasandra, serving the city's southern tech belt."
        ),
        "neighbourhoods": [
            "RV Road", "Jayanagar", "BTM Layout", "Silk Board", "Bommanahalli",
            "Hosa Road", "Electronic City", "Hebbagodi", "Bommasandra",
        ],
        "station_openings": ["2025"] * 16,
        "underground": set(),
        "at_grade": set(),
    },
}

SHORT_NAMES = {
    "Whitefield (Kadugodi)": "Whitefield",
    "Hopefarm Channasandra": "Hopefarm",
    "Kadugodi Tree Park": "Tree Park",
    "Sri Sathya Sai Hospital": "Sathya Sai Hospital",
    "Krishnarajapura": "KR Puram",
    "Swami Vivekananda Road": "SV Road",
    "Mahatma Gandhi Road": "MG Road",
    "Dr B R Ambedkar Station Vidhana Soudha": "Vidhana Soudha",
    "Sir M Visvesvaraya Central College": "Sir M. Visvesvaraya",
    "Nadaprabhu Kempegowda Station Majestic": "Majestic",
    "Krantivira Sangolli Rayanna Railway Station": "KSR Bengaluru",
    "Sri Balagangadharanatha Swamiji Hosahalli": "Hosahalli",
    "Pantharapalya Nayandahalli": "Pantharapalya–Nayandahalli",
    "Kengeri Bus Terminal": "Kengeri Bus Terminal",
    "Rashtreeya Vidyalaya Road": "RV Road",
    "Delta Electronics Bommasandra": "Bommasandra",
}

CONNECTIONS = {
    "Whitefield (Kadugodi)": [
        {"type": "rail", "label": "Whitefield railway station"},
        {"type": "bus", "label": "Kadugodi TTMC"},
    ],
    "Hoodi": [{"type": "rail", "label": "Hoodi Halt"}],
    "Krishnarajapura": [
        {"type": "rail", "label": "Krishnarajapuram railway station"},
        {"type": "future", "label": "Blue Line (under construction)"},
    ],
    "Baiyappanahalli": [{"type": "rail", "label": "Baiyappanahalli railway station"}],
    "Mahatma Gandhi Road": [{"type": "future", "label": "Pink Line (under construction)"}],
    "Nadaprabhu Kempegowda Station Majestic": [
        {"type": "rail", "label": "KSR Bengaluru City railway station"},
        {"type": "bus", "label": "Kempegowda Bus Station"},
        {"type": "metro", "label": "Purple ↔ Green interchange"},
    ],
    "Krantivira Sangolli Rayanna Railway Station": [
        {"type": "rail", "label": "KSR Bengaluru City railway station"}
    ],
    "Mysuru Road": [{"type": "future", "label": "Orange Line (approved)"}],
    "Sri Balagangadharanatha Swamiji Hosahalli": [
        {"type": "future", "label": "Grey Line (approved)"}
    ],
    "Sir M Visvesvaraya Central College": [
        {"type": "future", "label": "Red Line (approved)"}
    ],
    "Kengeri Bus Terminal": [{"type": "bus", "label": "Kengeri TTMC"}],
    "Kengeri": [{"type": "rail", "label": "Kengeri railway station"}],
    "Yeshwanthpur": [{"type": "rail", "label": "Yesvantpur Junction railway station"}],
    "Sandal Soap Factory": [{"type": "bus", "label": "Yeshwanthpura TTMC"}],
    "Attiguppe": [{"type": "bus", "label": "Vijayanagara TTMC"}],
    "Jayanagar": [{"type": "bus", "label": "Jayanagar TTMC"}],
    "Banashankari": [{"type": "bus", "label": "Banashankari TTMC"}],
    "Jaya Prakash Nagar": [{"type": "future", "label": "Orange Line (approved)"}],
    "Peenya": [{"type": "future", "label": "Orange Line (approved)"}],
    "Rashtreeya Vidyalaya Road": [
        {"type": "metro", "label": "Green ↔ Yellow interchange"}
    ],
    "Jayadeva Hospital": [{"type": "future", "label": "Pink Line (under construction)"}],
    "Central Silk Board": [
        {"type": "bus", "label": "Silk Board TTMC"},
        {"type": "future", "label": "Blue Line (under construction)"},
    ],
}

# The OSM route relations omit a code for these recently opened or renamed
# stations. Use the official BMRCL abbreviations where the stop node lacks one.
STATION_CODE_FALLBACKS = {
    "Benniganahalli": "JTPM",
    "Challaghatta": "CLGA",
    "Chikkabidarakallu": "CKBD",
    "Madavara": "BIET",
    "Manjunath Nagar": "MNJN",
}

MAJOR_STATIONS = {
    "Whitefield (Kadugodi)", "Krishnarajapura", "Baiyappanahalli", "Indiranagar",
    "Mahatma Gandhi Road", "Nadaprabhu Kempegowda Station Majestic", "Kengeri",
    "Madavara", "Yeshwanthpur", "Rajajinagar", "Silk Institute",
    "Rashtreeya Vidyalaya Road", "Jayanagar", "Banashankari", "Central Silk Board",
    "Electronic City", "Delta Electronics Bommasandra", "Peenya", "Jayadeva Hospital",
}


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(request, timeout=120) as response:
            path.write_bytes(response.read())
    return path


def parse_route(path: Path):
    import xml.etree.ElementTree as ET

    root = ET.parse(path).getroot()
    nodes = {
        n.get("id"): (float(n.get("lon")), float(n.get("lat")))
        for n in root.findall("node")
    }
    node_tags = {
        n.get("id"): {tag.get("k"): tag.get("v") for tag in n.findall("tag")}
        for n in root.findall("node")
    }
    ways = {
        w.get("id"): [nd.get("ref") for nd in w.findall("nd")]
        for w in root.findall("way")
    }
    relation = root.find("relation")
    way_ids = [
        m.get("ref") for m in relation.findall("member") if m.get("type") == "way"
    ]

    # Ordered stop_position members carry BMRCL station codes and coordinates.
    # Using them avoids snapping a third-party coordinate set onto the route,
    # which previously collapsed two Yellow Line stations onto one point.
    stops = []
    for member in relation.findall("member"):
        if member.get("type") != "node" or member.get("role") != "stop":
            continue
        ref = member.get("ref")
        tags = node_tags.get(ref, {})
        if tags.get("network") != "Namma Metro" or tags.get("railway") != "stop":
            continue
        stops.append(
            {
                "name": tags.get("name", ""),
                "code": tags.get("code"),
                "coordinates": list(nodes[ref]),
            }
        )

    adjacency = defaultdict(list)
    endpoint_count = defaultdict(int)
    for way_id in way_ids:
        nds = ways[way_id]
        a, b = nds[0], nds[-1]
        adjacency[a].append((way_id, b))
        adjacency[b].append((way_id, a))
        endpoint_count[a] += 1
        endpoint_count[b] += 1

    terminals = [node for node, count in endpoint_count.items() if count == 1]
    if len(terminals) != 2:
        raise ValueError(f"Expected 2 terminal nodes, found {len(terminals)}")

    coords = []
    used = set()
    current = terminals[0]
    while True:
        choices = [(wid, nxt) for wid, nxt in adjacency[current] if wid not in used]
        if not choices:
            break
        way_id, nxt = choices[0]
        used.add(way_id)
        nds = ways[way_id]
        points = [nodes[node_id] for node_id in nds]
        if nds[0] != current:
            points.reverse()
        if coords and coords[-1] == points[0]:
            coords.extend(points[1:])
        else:
            coords.extend(points)
        current = nxt

    if len(used) != len(way_ids):
        raise ValueError(f"Traversed {len(used)} of {len(way_ids)} route ways")

    return {
        "coordinates": coords,
        "stops": stops,
        "way_count": len(used),
        "terminals": terminals,
    }


def haversine(a, b):
    lon1, lat1 = a
    lon2, lat2 = b
    radius = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


def line_length(coords):
    return sum(haversine(a, b) for a, b in zip(coords, coords[1:]))


def point_segment_distance(p, a, b):
    px, py = p
    ax, ay = a
    bx, by = b
    scale = math.cos(math.radians(py))
    ax, bx, px = ax * scale, bx * scale, px * scale
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay), a
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    closest = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy)), closest


def snap_to_line(point, coords):
    best = (float("inf"), None)
    for a, b in zip(coords, coords[1:]):
        distance, closest = point_segment_distance(point, a, b)
        if distance < best[0]:
            best = (distance, closest)
    return best


def simplify(coords, tolerance=0.000055):
    """Douglas-Peucker in lng/lat with a latitude correction."""
    if len(coords) <= 2:
        return coords
    scale = math.cos(math.radians(sum(p[1] for p in coords) / len(coords)))
    points = [(p[0] * scale, p[1]) for p in coords]

    def get_sq_seg_dist(p, a, b):
        x, y = p
        dx, dy = b[0] - a[0], b[1] - a[1]
        if dx == 0 and dy == 0:
            return (x - a[0]) ** 2 + (y - a[1]) ** 2
        t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)
        t = max(0.0, min(1.0, t))
        proj = (a[0] + t * dx, a[1] + t * dy)
        return (x - proj[0]) ** 2 + (y - proj[1]) ** 2

    def rdp(first, last, sq_tol):
        max_sq = 0
        index = None
        for i in range(first + 1, last):
            sq = get_sq_seg_dist(points[i], points[first], points[last])
            if sq > max_sq:
                index, max_sq = i, sq
        if max_sq > sq_tol:
            left = rdp(first, index, sq_tol)
            right = rdp(index, last, sq_tol)
            return left[:-1] + right
        return [coords[first], coords[last]]

    return rdp(0, len(coords) - 1, tolerance * tolerance)


def bounds(coords):
    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]
    return [min(xs), min(ys), max(xs), max(ys)]


def round_coords(coords, digits=6):
    return [[round(x, digits), round(y, digits)] for x, y in coords]


def main():
    CACHE.mkdir(exist_ok=True)
    DATA.mkdir(exist_ok=True)

    csv_path = fetch(
        "https://raw.githubusercontent.com/Vinayak-Chinchakhandi/"
        "Bengaluru-Metro-Network-Dataset/main/bengaluru_metro_network.csv",
        CACHE / "bengaluru_metro_network.csv",
    )
    with csv_path.open(newline="", encoding="utf-8") as handle:
        station_rows = list(csv.DictReader(handle))

    routes = {}
    for key, route in ROUTES.items():
        path = fetch(
            f"https://api.openstreetmap.org/api/0.6/relation/{route['osm_relation']}/full",
            CACHE / f"{key}.osm",
        )
        parsed = parse_route(path)
        coords = parsed["coordinates"]
        stops = parsed["stops"]
        # Green's OSM relation starts at Silk Institute; present it Madavara -> Silk Institute.
        if key == "green":
            coords = list(reversed(coords))
            stops = list(reversed(stops))
        if len(stops) != route["stations"]:
            raise ValueError(
                f"{route['name']}: found {len(stops)} OSM stops, expected {route['stations']}"
            )
        simplified = simplify(coords)
        routes[key] = {
            "raw": coords,
            "coordinates": round_coords(simplified),
            "measured_km": round(line_length(coords) / 1000, 2),
            "stops": stops,
        }

    # Group station rows by canonical station name. Interchanges appear once per line.
    by_name = {}
    for row in station_rows:
        name = row["station_name"].strip()
        line_key = next(k for k, v in ROUTES.items() if v["csv_line"] == row["line"])
        seq = int(row["sequence"])
        osm_stop = routes[line_key]["stops"][seq - 1]
        fallback = [float(row["longitude"]), float(row["latitude"])]
        actual = osm_stop["coordinates"] if osm_stop else fallback
        item = by_name.setdefault(
            name,
            {
                "name": name,
                "short": SHORT_NAMES.get(name, name),
                "actual": actual,
                "routes": [],
            },
        )
        item["routes"].append(
            {
                "line": line_key,
                "sequence": seq,
                "code": (osm_stop or {}).get("code")
                or STATION_CODE_FALLBACKS.get(name)
                or row["station_code"],
                "actual": actual,
                "on_route": bool(osm_stop),
                "type": (
                    "Underground"
                    if name in ROUTES[line_key]["underground"]
                    else "At grade"
                    if name in ROUTES[line_key]["at_grade"]
                    else "Elevated"
                ),
                "opened": ROUTES[line_key]["station_openings"][seq - 1],
            }
        )

    stations = []
    for name, item in by_name.items():
        positioned = []
        for route in item["routes"]:
            key = route["line"]
            if route["on_route"]:
                positioned.append(route["actual"])
                continue
            # Fallback for a stop missing from the OSM relation: snap the
            # compiled coordinate to the route if it is close enough.
            distance, closest = snap_to_line(item["actual"], routes[key]["raw"])
            if closest is not None and distance * 111_000 < 400:
                positioned.append(closest)
        display = item["actual"]
        if positioned:
            display = [
                round(sum(p[0] for p in positioned) / len(positioned), 6),
                round(sum(p[1] for p in positioned) / len(positioned), 6),
            ]

        item["routes"].sort(key=lambda r: r["line"])
        line_ids = [r["line"] for r in item["routes"]]
        primary_line = line_ids[0]
        station_type = next(
            (r["type"] for r in item["routes"] if r["type"] == "Underground"),
            item["routes"][0]["type"],
        )
        opened = sorted({r["opened"] for r in item["routes"]})
        item.update(
            {
                "id": name.lower().replace(" ", "-").replace(".", "").replace("(", "").replace(")", "").replace("–", "-"),
                "display": display,
                "lines": line_ids,
                "line_names": [ROUTES[k]["name"] for k in line_ids],
                "primary_line": primary_line,
                "type": station_type,
                "codes": sorted({r["code"] for r in item["routes"]}),
                "sequences": {r["line"]: r["sequence"] for r in item["routes"]},
                "opened": opened[0] if len(opened) == 1 else f"{opened[0]}–{opened[-1]}",
                "opened_by_line": {r["line"]: r["opened"] for r in item["routes"]},
                "interchange": len(item["routes"]) > 1,
                "connections": CONNECTIONS.get(name, []),
                "rank": 0
                if len(item["routes"]) > 1
                else 1
                if name in {ROUTES[k]["terminals"][i] for k in ROUTES for i in (0, 1)}
                else 2
                if name in MAJOR_STATIONS
                else 3,
            }
        )
        stations.append(item)

    stations.sort(key=lambda s: (s["rank"], s["name"]))
    station_by_name = {s["name"]: s for s in stations}

    lines = []
    for key, route in ROUTES.items():
        line_stations = sorted(
            [s for s in stations if key in s["lines"]],
            key=lambda s: s["sequences"][key],
        )
        line = {
            "id": key,
            "name": route["name"],
            "shortName": route["short_name"],
            "color": route["color"],
            "soft": route["soft"],
            "contrast": route["contrast"],
            "terminals": route["terminals"],
            "lengthKm": route["length_km"],
            "measuredKm": routes[key]["measured_km"],
            "stationCount": len(line_stations),
            "opened": route["opened"],
            "lastExtension": route["last_extension"],
            "endToEndMin": route["end_to_end_min"],
            "operatingSpeedKmph": route["operating_speed_kmph"],
            "depots": route["depots"],
            "description": route["description"],
            "neighbourhoods": route["neighbourhoods"],
            "coordinates": routes[key]["coordinates"],
            "bounds": bounds(routes[key]["coordinates"]),
            "stationIds": [s["id"] for s in line_stations],
        }
        lines.append(line)

    metro_bounds = bounds(
        [point for key in ROUTES for point in routes[key]["coordinates"]]
    )
    interchanges = [s for s in stations if s["interchange"]]
    total_unique = len(stations)

    meta = {
        "title": "Namma Metro Explorer",
        "city": "Bengaluru",
        "state": "Karnataka, India",
        "operator": "Bangalore Metro Rail Corporation Limited (BMRCL)",
        "snapshot": "25 October 2026",
        "systemOpened": "20 October 2011",
        "lines": len(lines),
        "stations": total_unique,
        "lengthKm": 96.10,
        "dailyRidership": "9.16 lakh",
        "recordRidership": "11.20 lakh",
        "recordDate": "10 August 2026",
        "fareMin": 10,
        "fareMax": 90,
        "frequency": "3–15 min",
        "hours": "05:00–23:00",
        "sundayFrom": "07:00",
        "topSpeedKmph": 80,
        "averageSpeedKmph": 34,
        "gauge": "1,435 mm standard gauge",
        "electrification": "750 V DC third rail",
        "coaches": 6,
        "bounds": metro_bounds,
        "generatedFrom": {
            "basemap": "OpenFreeMap",
            "geometry": "OpenStreetMap route relations 1798771, 1798772, 19421944 (ODbL)",
            "stations": "BMRCL / Wikipedia / OSM route-relation stop positions (ODbL)",
        },
        "notes": [
            "The Pink Line's 7.5 km elevated section (Kalena Agrahara–Tavarekere) is awaiting final safety approval; it is not included in this operational map.",
            "The Blue Line (Central Silk Board–K.R. Puram–Kempegowda International Airport) remains under construction.",
            "Service hours are from terminal stations; last trains generally leave around 23:00, with occasional late-night special services.",
            "Fares range from ₹10 to ₹90; smart-card journeys receive a 5% discount.",
        ],
        "sources": [
            {"label": "BMRCL", "url": "https://english.bmrc.co.in/"},
            {"label": "OpenStreetMap", "url": "https://www.openstreetmap.org/"},
            {"label": "OpenFreeMap", "url": "https://openfreemap.org/"},
            {"label": "Wikipedia: Namma Metro", "url": "https://en.wikipedia.org/wiki/Namma_Metro"},
        ],
    }

    output = {
        "meta": meta,
        "lines": lines,
        "stations": stations,
        "interchanges": [s["id"] for s in interchanges],
    }

    (DATA / "metro-data.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DATA / "metro-data.js").write_text(
        "/* Generated by scripts/build-data.py. Data: OSM contributors (ODbL), BMRCL, Wikipedia. */\n"
        "window.METRO_DATA = "
        + json.dumps(output, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )

    print(f"Lines: {len(lines)}")
    for line in lines:
        print(
            f"  {line['name']}: {line['stationCount']} stations, "
            f"{line['lengthKm']} km official / {line['measuredKm']} km OSM geometry, "
            f"{len(line['coordinates'])} points"
        )
    print(f"Unique stations: {total_unique}")
    print(f"Interchanges: {', '.join(s['name'] for s in interchanges)}")
    print(f"Wrote {DATA / 'metro-data.json'} and {DATA / 'metro-data.js'}")


if __name__ == "__main__":
    main()
