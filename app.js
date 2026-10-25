/* ==========================================================================
   Namma Metro Explorer
   MapLibre GL JS + OpenFreeMap. Data is embedded in data/metro-data.js so the
   page can also be opened directly from disk.
   ========================================================================== */

(() => {
  "use strict";

  const DATA = window.METRO_DATA;
  const appEl = document.querySelector(".app");
  const mapEl = document.getElementById("map");
  const mapShell = document.querySelector(".map-shell");
  const loadingEl = document.getElementById("mapLoading");
  const detailPanel = document.getElementById("detailPanel");
  const detailContent = document.getElementById("detailContent");
  const toastEl = document.getElementById("toast");
  const searchInput = document.getElementById("stationSearch");
  const searchResults = document.getElementById("searchResults");
  const clockEl = document.getElementById("clock");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobileQuery = window.matchMedia("(max-width: 900px)");

  const STYLES = {
    positron: { url: "https://tiles.openfreemap.org/styles/positron", label: "Positron" },
    liberty: { url: "https://tiles.openfreemap.org/styles/liberty", label: "Liberty" },
    bright: { url: "https://tiles.openfreemap.org/styles/bright", label: "Bright" },
    dark: { url: "https://tiles.openfreemap.org/styles/dark", label: "Night" },
  };

  const LINE_ICONS = {
    rail: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3" y="2" width="10" height="9" rx="2.5"/><path d="M5.2 5.2h5.6M5 14l1.4-2.8M11 14 9.6 11.2" stroke-linecap="round"/><circle cx="5.7" cy="8" r=".65" fill="currentColor" stroke="none"/><circle cx="10.3" cy="8" r=".65" fill="currentColor" stroke="none"/></svg>',
    bus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2.5" y="3" width="11" height="8.5" rx="2"/><path d="M2.5 7.2h11M4.5 14v-2.5M11.5 14v-2.5" stroke-linecap="round"/><circle cx="5.3" cy="9.4" r=".6" fill="currentColor" stroke="none"/><circle cx="10.7" cy="9.4" r=".6" fill="currentColor" stroke="none"/></svg>',
    metro: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M5.5 2.5v11M10.5 2.5v11" stroke-linecap="round"/><circle cx="5.5" cy="6.5" r="1.4"/><circle cx="10.5" cy="9.5" r="1.4"/></svg>',
    future: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="5.2" stroke-dasharray="2.2 2.2"/><path d="M8 5.3v3l1.8 1.1" stroke-linecap="round"/></svg>',
  };

  const state = {
    focusLineId: null,
    selectedStationId: null,
    drawerType: null,
    currentStyle: "positron",
    map: null,
    initialSetupDone: false,
    initialViewDone: false,
    searchMatches: [],
    searchIndex: -1,
    hoveredStationIndex: null,
    hoveredLineId: null,
    userMarker: null,
    toastTimer: null,
    loadTimer: null,
    viewTimer: null,
  };

  if (!DATA) {
    showFatal("Metro data did not load", "Check that data/metro-data.js exists next to index.html.");
    return;
  }

  /* ------------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------------ */

  const esc = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const pad2 = (number) => String(number).padStart(2, "0");

  const formatLength = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return number.toFixed(1);
  };

  const formatDate = (value) => {
    if (!value) return "—";
    return String(value).replace(/^(\d{1,2}) (\w+) (\d{4})$/, "$1 $2 $3");
  };

  const normalizeText = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const styleVar = (color) => `--dot:${esc(color)}`;

  const lineDots = (lineIds, extraClass = "") =>
    lineIds
      .map((lineId) => {
        const line = linesById.get(lineId);
        return line
          ? `<span class="line-dot ${extraClass}" style="${styleVar(line.color)}" title="${esc(line.name)}"></span>`
          : "";
      })
      .join("");

  const linesById = new Map(DATA.lines.map((line) => [line.id, line]));
  const stationsById = new Map(DATA.stations.map((station) => [station.id, station]));
  const stationIndexById = new Map(DATA.stations.map((station, index) => [station.id, index]));
  const lineIndexById = new Map(DATA.lines.map((line, index) => [line.id, index]));

  const stationTerminus = (station) =>
    Object.entries(station.sequences).some(([lineId, sequence]) => {
      const line = linesById.get(lineId);
      return line && (sequence === 1 || sequence === line.stationCount);
    });

  const stationMajor = (station) => Boolean(station.interchange) || station.rank <= 2;

  const getNeighbours = (station, lineId) => {
    const line = linesById.get(lineId);
    if (!line) return { previous: null, next: null };
    const index = line.stationIds.indexOf(station.id);
    if (index === -1) return { previous: null, next: null };
    return {
      previous: index > 0 ? stationsById.get(line.stationIds[index - 1]) : null,
      next: index < line.stationIds.length - 1 ? stationsById.get(line.stationIds[index + 1]) : null,
    };
  };

  function showFatal(title, message) {
    if (!loadingEl) return;
    loadingEl.classList.remove("is-hidden");
    loadingEl.classList.add("is-error");
    loadingEl.innerHTML = `
      <div class="loading-inner">
        <div class="loading-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <p>${esc(title)}</p>
        <small>${esc(message)}</small>
      </div>`;
  }

  function showToast(message, duration = 3200) {
    if (!toastEl) return;
    window.clearTimeout(state.toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add("visible");
    state.toastTimer = window.setTimeout(() => toastEl.classList.remove("visible"), duration);
  }

  /* ------------------------------------------------------------------------
     Static UI: stats, line cards, interchanges, legend, notes
     ------------------------------------------------------------------------ */

  function renderMeta() {
    const meta = DATA.meta;
    const lengthEl = document.getElementById("statLength");
    const linesEl = document.getElementById("statLines");
    const stationsEl = document.getElementById("statStations");
    const ridershipEl = document.getElementById("statRidership");
    const contextEl = document.getElementById("mapContext");

    if (lengthEl) lengthEl.textContent = formatLength(meta.lengthKm);
    if (linesEl) linesEl.textContent = meta.lines;
    if (stationsEl) stationsEl.textContent = meta.stations;
    if (ridershipEl) {
      const [number, unit] = String(meta.dailyRidership).split(" ");
      ridershipEl.innerHTML = `${esc(number)}<span>${esc((unit || "lakh").charAt(0).toUpperCase())}</span>`;
    }
    if (contextEl) {
      contextEl.textContent = `${meta.lines} lines · ${meta.stations} stations · ${formatLength(meta.lengthKm)} km`;
    }

    document.querySelectorAll('.sidebar-footer span:first-child').forEach((el) => {
      el.innerHTML = `Snapshot <strong>${esc(meta.snapshot)}</strong>`;
    });
  }

  function renderLineCards() {
    const container = document.getElementById("lineCards");
    if (!container) return;

    container.innerHTML = DATA.lines
      .map((line) => {
        const meta = [
          `${line.stationCount} stations`,
          `${formatLength(line.lengthKm)} km`,
          `${line.endToEndMin} min`,
        ];
        return `
          <button type="button" class="line-card" data-line="${esc(line.id)}"
            style="--line:${esc(line.color)};--soft:${esc(line.soft)};--badge-ink:${esc(line.contrast)}"
            aria-pressed="false" aria-label="Explore the ${esc(line.name)}">
            <span class="line-card-top">
              <span class="line-badge" aria-hidden="true">${esc(line.shortName.charAt(0))}</span>
              <span class="line-card-name">${esc(line.name)}</span>
              <span class="line-card-arrow" aria-hidden="true">
                <svg viewBox="0 0 20 20"><path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </span>
            <span class="line-card-route">${esc(line.terminals[0])} ↔ ${esc(line.terminals[1])}</span>
            <span class="line-card-meta">${meta.map((item) => `<span>${esc(item)}</span>`).join("")}</span>
          </button>`;
      })
      .join("");
  }

  function renderInterchanges() {
    const container = document.getElementById("interchangeList");
    if (!container) return;

    container.innerHTML = DATA.interchanges
      .map((stationId) => stationsById.get(stationId))
      .filter(Boolean)
      .map(
        (station) => `
          <button type="button" class="interchange-card" data-station="${esc(station.id)}"
            aria-label="Open details for ${esc(station.name)} interchange">
            <span class="interchange-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4.5 5.5h4.2a3 3 0 0 1 3 3v3a3 3 0 0 0 3 3h.8"/>
                <path d="m13.2 2.8 2.3 2.7-2.3 2.7M6.8 17.2l-2.3-2.7 2.3-2.7"/>
              </svg>
            </span>
            <span class="interchange-copy">
              <span class="interchange-name">${esc(station.short)}</span>
              <span class="interchange-lines">${lineDots(station.lines)} ${esc(station.line_names.map((name) => name.replace(" Line", "")).join(" · "))}</span>
            </span>
            <span class="interchange-type">${esc(station.type)}</span>
          </button>`
      )
      .join("");
  }

  function renderLegend() {
    const container = document.getElementById("mapLegend");
    if (!container) return;

    container.innerHTML = `
      <span class="legend-title">In service</span>
      <div class="legend-items">
        ${DATA.lines
          .map(
            (line) => `
              <button type="button" class="legend-item" data-line="${esc(line.id)}" style="--line:${esc(line.color)}">
                <span class="line-swatch" aria-hidden="true"></span>${esc(line.shortName)}
              </button>`
          )
          .join("")}
        <button type="button" class="legend-all" id="legendAll" title="Show all lines">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 8h10M8 3v10"/></svg>
          All
        </button>
      </div>`;
  }

  function renderNotes() {
    const notesEl = document.getElementById("networkNotes");
    const sourcesEl = document.getElementById("sourceLinks");
    if (notesEl) {
      notesEl.innerHTML = `<ul>${DATA.meta.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>`;
    }
    if (sourcesEl) {
      sourcesEl.innerHTML = DATA.meta.sources
        .map(
          (source) =>
            `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label)} ↗</a>`
        )
        .join("");
    }
  }

  /* ------------------------------------------------------------------------
     Search
     ------------------------------------------------------------------------ */

  function searchStations(query) {
    const normalized = normalizeText(query);
    if (!normalized) return [];
    const tokens = normalized.split(/\s+/);
    const matches = [];

    DATA.stations.forEach((station) => {
      const name = normalizeText(station.name);
      const short = normalizeText(station.short);
      const codes = normalizeText(station.codes.join(" "));
      const haystack = `${name} ${short} ${codes} ${normalizeText(station.line_names.join(" "))}`;
      if (!tokens.every((token) => haystack.includes(token))) return;

      let score = 50;
      if (name === normalized || short === normalized || codes === normalized) score = 0;
      else if (short.startsWith(normalized)) score = 1;
      else if (name.startsWith(normalized)) score = 2;
      else if (codes.split(" ").includes(normalized)) score = 3;
      else if (short.includes(normalized)) score = 8;
      else if (name.includes(normalized)) score = 12;
      else score = 24;

      if (station.interchange) score -= 1.5;
      if (stationTerminus(station)) score -= 0.5;
      score += station.rank * 0.05;
      matches.push({ station, score });
    });

    return matches.sort((a, b) => a.score - b.score).slice(0, 9).map((match) => match.station);
  }

  function highlightSnippet(text, query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return esc(text);
    const firstToken = normalizedQuery.split(" ")[0];
    const lower = String(text).toLowerCase();
    const index = lower.indexOf(firstToken);
    if (index === -1) return esc(text);
    return `${esc(String(text).slice(0, index))}<mark>${esc(
      String(text).slice(index, index + firstToken.length)
    )}</mark>${esc(String(text).slice(index + firstToken.length))}`;
  }

  function renderSearch(query) {
    state.searchMatches = searchStations(query);
    state.searchIndex = state.searchMatches.length ? 0 : -1;

    if (!query.trim()) {
      hideSearchResults();
      return;
    }

    if (!state.searchMatches.length) {
      searchResults.innerHTML = `
        <div class="search-empty">
          <strong>No station found</strong>
          Try Majestic, Indiranagar or a station code like KGWA.
        </div>`;
    } else {
      searchResults.innerHTML = `
        <div class="search-group-label">${state.searchMatches.length} matching station${state.searchMatches.length === 1 ? "" : "s"}</div>
        ${state.searchMatches
          .map((station, index) => {
            const meta = [
              station.line_names.map((name) => name.replace(" Line", "")).join(" · "),
              station.type,
              station.interchange ? "Interchange" : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return `
              <button type="button" class="search-result${index === 0 ? " is-active" : ""}"
                data-station="${esc(station.id)}" data-index="${index}" role="option" aria-selected="${index === 0}">
                <span class="result-dots" aria-hidden="true">${lineDots(station.lines)}</span>
                <span class="result-copy">
                  <span class="result-name">${highlightSnippet(station.short, query)}</span>
                  <span class="result-meta">${esc(meta)}</span>
                </span>
                <span class="result-code">${esc(station.codes[0] || "")}</span>
              </button>`;
          })
          .join("")}`;
    }

    searchResults.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  function updateSearchActive(nextIndex) {
    if (!state.searchMatches.length) return;
    const length = state.searchMatches.length;
    state.searchIndex = (nextIndex + length) % length;
    searchResults.querySelectorAll(".search-result").forEach((button, index) => {
      const active = index === state.searchIndex;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      if (active) button.scrollIntoView({ block: "nearest" });
    });
  }

  function chooseSearchStation(stationId) {
    if (!stationId) return;
    searchInput.value = "";
    hideSearchResults();
    searchInput.blur();
    selectStation(stationId);
  }

  function hideSearchResults() {
    searchResults.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    state.searchMatches = [];
    state.searchIndex = -1;
  }

  function bindSearch() {
    if (!searchInput || !searchResults) return;

    searchInput.addEventListener("input", () => renderSearch(searchInput.value));
    searchInput.addEventListener("focus", () => {
      if (searchInput.value.trim()) renderSearch(searchInput.value);
    });

    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (searchResults.hidden) renderSearch(searchInput.value);
        updateSearchActive(state.searchIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        updateSearchActive(state.searchIndex - 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const station = state.searchMatches[state.searchIndex];
        if (station) chooseSearchStation(station.id);
      } else if (event.key === "Escape") {
        event.preventDefault();
        hideSearchResults();
        searchInput.blur();
      }
    });

    searchResults.addEventListener("pointerdown", (event) => {
      const result = event.target.closest(".search-result");
      if (result) {
        event.preventDefault();
        chooseSearchStation(result.dataset.station);
      }
    });

    searchResults.addEventListener("pointermove", (event) => {
      const result = event.target.closest(".search-result");
      if (result && Number(result.dataset.index) !== state.searchIndex) {
        updateSearchActive(Number(result.dataset.index));
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".search-wrap")) hideSearchResults();
    });

    document.addEventListener("keydown", (event) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if (event.key === "Escape" && !typing) {
        if (!searchResults.hidden) hideSearchResults();
        else if (detailPanel.classList.contains("open")) clearSelection();
      }
    });
  }

  /* ------------------------------------------------------------------------
     GeoJSON
     ------------------------------------------------------------------------ */

  const lineFeatures = DATA.lines.map((line, index) => ({
    type: "Feature",
    id: index,
    properties: {
      id: line.id,
      name: line.name,
      shortName: line.shortName,
      color: line.color,
      stationCount: line.stationCount,
      lengthKm: line.lengthKm,
      endToEndMin: line.endToEndMin,
      terminalA: line.terminals[0],
      terminalB: line.terminals[1],
    },
    geometry: {
      type: "LineString",
      coordinates: line.coordinates,
    },
  }));

  const stationFeatures = DATA.stations.map((station, index) => {
    const primary = linesById.get(station.primary_line);
    return {
      type: "Feature",
      id: index,
      properties: {
        id: station.id,
        name: station.name,
        short: station.short,
        type: station.type,
        interchange: Boolean(station.interchange),
        major: stationMajor(station),
        terminus: stationTerminus(station),
        primary_line: station.primary_line,
        color: primary ? primary.color : "#121926",
        line_purple: station.lines.includes("purple"),
        line_green: station.lines.includes("green"),
        line_yellow: station.lines.includes("yellow"),
        line_names: station.line_names,
        codes: station.codes,
        rank: station.rank,
      },
      geometry: {
        type: "Point",
        coordinates: station.display,
      },
    };
  });

  const lineCollection = { type: "FeatureCollection", features: lineFeatures };
  const stationCollection = { type: "FeatureCollection", features: stationFeatures };

  /* ------------------------------------------------------------------------
     Map
     ------------------------------------------------------------------------ */

  const lineCoreWidth = [
    "interpolate", ["linear"], ["zoom"],
    9, 2.6,
    12, 4.2,
    15, 6,
    17.5, 7.4,
  ];

  const lineCasingWidth = [
    "interpolate", ["linear"], ["zoom"],
    9, 4.7,
    12, 6.7,
    15, 9,
    17.5, 10.8,
  ];

  const stationDotRadius = [
    "interpolate", ["linear"], ["zoom"],
    10, ["case", ["get", "interchange"], 4.1, 2.5],
    13, ["case", ["get", "interchange"], 5.3, 3.4],
    16, ["case", ["get", "interchange"], 6.3, 4.5],
  ];

  const stationCasingRadius = [
    "interpolate", ["linear"], ["zoom"],
    10, ["case", ["get", "interchange"], 5.8, 4.2],
    13, ["case", ["get", "interchange"], 7.0, 5.1],
    16, ["case", ["get", "interchange"], 8.0, 6.2],
  ];

  const stationStrokeColor = [
    "match", ["get", "primary_line"],
    "purple", "#7E22CE",
    "green", "#16A34A",
    "yellow", "#EAB308",
    "#121926",
  ];

  const labelOpacity = 1;

  // The basemap's city label sits directly under the central metro lines and
  // competes with the station labels. The app already names the city, so hide
  // just the city-level label layers in every OpenFreeMap style.
  const CITY_LABEL_LAYERS = [
    "label_city",
    "label_city_capital",
    "place_city",
    "place_city_large",
  ];

  function tuneBasemapLabels() {
    const map = state.map;
    if (!map || !map.getStyle()) return;
    CITY_LABEL_LAYERS.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    });
  }

  function initMap() {
    if (!window.maplibregl) {
      showFatal("MapLibre did not load", "Connect to the internet to load MapLibre GL JS from unpkg.");
      return;
    }

    try {
      state.map = new maplibregl.Map({
        container: "map",
        style: STYLES[state.currentStyle].url,
        center: [77.5946, 12.9716],
        zoom: 10.4,
        minZoom: 9,
        maxZoom: 18.5,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: false,
      });
    } catch (error) {
      console.error(error);
      showFatal("The map could not start", "This browser may not support WebGL.");
      return;
    }

    const map = state.map;
    appEl.dataset.basemap = state.currentStyle;

    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    map.on("load", () => {
      if (state.initialSetupDone) return;
      state.initialSetupDone = true;
      tuneBasemapLabels();
      addMetroLayers();
      applyMapTheme();
      applyInitialView();
      finishLoading();
    });

    map.on("style.load", () => {
      if (!state.initialSetupDone) return;
      tuneBasemapLabels();
      addMetroLayers();
      state.hoveredStationIndex = null;
      state.hoveredLineId = null;
      updateLineHover(null);
      applyMapTheme();
      updateFocusPaint();
      updateSelectionFilters();
    });

    map.on("error", (event) => {
      if (event?.error) console.warn("MapLibre:", event.error);
    });

    map.on("mousemove", handleMapHover);
    map.on("click", handleMapClick);
    map.on("movestart", () => {
      hideTooltip();
      setStationHover(null);
    });

    const canvas = map.getCanvas();
    canvas.addEventListener("mouseleave", () => {
      hideTooltip();
      setStationHover(null);
      updateLineHover(null);
      canvas.style.cursor = "";
    });

    state.loadTimer = window.setTimeout(() => {
      if (!state.initialSetupDone) {
        showFatal(
          "OpenFreeMap is taking too long",
          "The basemap could not be reached. Check your connection, then reload the page."
        );
      }
    }, 15000);
  }

  function addMetroLayers() {
    const map = state.map;
    if (!map || map.getSource("metro-lines")) return;

    map.addSource("metro-lines", { type: "geojson", data: lineCollection });
    map.addSource("metro-stations", { type: "geojson", data: stationCollection });

    map.addLayer({
      id: "line-shadow",
      type: "line",
      source: "metro-lines",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#0f172a",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          9, 7.1,
          12, 9.1,
          15, 11.4,
          17.5, 13.2,
        ],
        "line-opacity": 0.13,
        "line-blur": 4,
      },
    });

    map.addLayer({
      id: "line-casing",
      type: "line",
      source: "metro-lines",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#fffdf8",
        "line-width": lineCasingWidth,
        "line-opacity": 0.96,
      },
    });

    map.addLayer({
      id: "line-hover-glow",
      type: "line",
      source: "metro-lines",
      layout: { "line-join": "round", "line-cap": "round" },
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "line-color": ["get", "color"],
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          9, 8.1,
          12, 9.7,
          15, 11.5,
          17.5, 12.9,
        ],
        "line-opacity": 0.18,
        "line-blur": 2,
      },
    });

    map.addLayer({
      id: "line-core",
      type: "line",
      source: "metro-lines",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": lineCoreWidth,
        "line-opacity": 1,
      },
    });

    map.addLayer({
      id: "line-hit",
      type: "line",
      source: "metro-lines",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#000000",
        "line-width": 19,
        "line-opacity": 0.01,
      },
    });

    map.addLayer({
      id: "station-casing",
      type: "circle",
      source: "metro-stations",
      paint: {
        "circle-radius": stationCasingRadius,
        "circle-color": "#fffdf8",
        "circle-opacity": 0.97,
      },
    });

    map.addLayer({
      id: "station-dot",
      type: "circle",
      source: "metro-stations",
      paint: {
        "circle-radius": stationDotRadius,
        "circle-color": "#fffdf8",
        "circle-stroke-color": stationStrokeColor,
        "circle-stroke-width": ["case", ["get", "interchange"], 2.3, 1.7],
        "circle-opacity": 1,
        "circle-stroke-opacity": 1,
      },
    });

    map.addLayer({
      id: "station-interchange-core",
      type: "circle",
      source: "metro-stations",
      filter: ["==", ["get", "interchange"], true],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 15, 1.9],
        "circle-color": "#0f172a",
        "circle-opacity": 1,
      },
    });

    map.addLayer({
      id: "station-hover-ring",
      type: "circle",
      source: "metro-stations",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 6.5, 14, 9.5, 17, 11.5],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#121926",
        "circle-stroke-width": 1.6,
        "circle-stroke-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.85, 0],
      },
    });

    map.addLayer({
      id: "station-selected-ring",
      type: "circle",
      source: "metro-stations",
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 9, 14, 13, 17, 16],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#121926",
        "circle-stroke-width": 1.8,
        "circle-opacity": 0.92,
      },
    });

    map.addLayer({
      id: "station-label-major",
      type: "symbol",
      source: "metro-stations",
      minzoom: 9.2,
      filter: ["==", ["get", "major"], true],
      layout: {
        "text-field": ["get", "short"],
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 11.5, 17, 12.5],
        "text-anchor": "top",
        "text-offset": [0, 0.85],
        "text-max-width": 9,
        "text-line-height": 1.05,
        "text-padding": 3,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
      },
      paint: {
        "text-color": "#121926",
        "text-halo-color": "#fbfaf7",
        "text-halo-width": 1.8,
        "text-halo-blur": 0.4,
        "text-opacity": labelOpacity,
      },
    });

    map.addLayer({
      id: "station-label-minor",
      type: "symbol",
      source: "metro-stations",
      minzoom: 13.1,
      filter: ["!=", ["get", "major"], true],
      layout: {
        "text-field": ["get", "short"],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10.5, 17, 12],
        "text-anchor": "top",
        "text-offset": [0, 0.85],
        "text-max-width": 9,
        "text-line-height": 1.05,
        "text-padding": 3,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
      },
      paint: {
        "text-color": "#293140",
        "text-halo-color": "#fbfaf7",
        "text-halo-width": 1.7,
        "text-halo-blur": 0.4,
        "text-opacity": labelOpacity,
      },
    });

    updateSelectionFilters();
    updateFocusPaint();
  }

  function applyMapTheme() {
    const map = state.map;
    if (!map || !map.getLayer("line-core")) return;
    const dark = state.currentStyle === "dark";
    const casing = dark ? "#0b1220" : "#fffdf8";
    const nodeFill = dark ? "#0b1220" : "#fffdf8";
    const labelColor = dark ? "#f1f5f9" : "#121926";
    const minorLabel = dark ? "#dbe3ef" : "#293140";
    const halo = dark ? "#0b1220" : "#fbfaf7";

    map.setPaintProperty("line-casing", "line-color", casing);
    map.setPaintProperty("station-casing", "circle-color", casing);
    map.setPaintProperty("station-dot", "circle-color", nodeFill);
    map.setPaintProperty(
      "station-interchange-core",
      "circle-color",
      dark ? "#f8fafc" : "#0f172a"
    );
    map.setPaintProperty(
      "station-hover-ring",
      "circle-stroke-color",
      dark ? "#f8fafc" : "#121926"
    );
    map.setPaintProperty(
      "station-selected-ring",
      "circle-stroke-color",
      dark ? "#f8fafc" : "#121926"
    );
    map.setPaintProperty("station-label-major", "text-color", labelColor);
    map.setPaintProperty("station-label-major", "text-halo-color", halo);
    map.setPaintProperty("station-label-minor", "text-color", minorLabel);
    map.setPaintProperty("station-label-minor", "text-halo-color", halo);
  }

  function updateFocusPaint() {
    const map = state.map;
    if (!map || !map.getLayer("line-core")) return;
    const focus = state.focusLineId;
    const lineOpacity = focus
      ? ["case", ["==", ["get", "id"], focus], 1, 0.22]
      : 1;
    const casingOpacity = focus
      ? ["case", ["==", ["get", "id"], focus], 0.96, 0.08]
      : 0.96;
    const shadowOpacity = focus
      ? ["case", ["==", ["get", "id"], focus], 0.15, 0.02]
      : 0.13;
    const stationOpacity = focus
      ? ["case", ["==", ["get", `line_${focus}`], true], 1, 0]
      : 1;
    const casingStationOpacity = focus
      ? ["case", ["==", ["get", `line_${focus}`], true], 0.97, 0]
      : 0.97;
    const stationLabelOpacity = focus
      ? ["case", ["==", ["get", `line_${focus}`], true], 1, 0.26]
      : 1;

    map.setPaintProperty("line-core", "line-opacity", lineOpacity);
    map.setPaintProperty("line-casing", "line-opacity", casingOpacity);
    map.setPaintProperty("line-shadow", "line-opacity", shadowOpacity);
    map.setPaintProperty("station-casing", "circle-opacity", casingStationOpacity);
    map.setPaintProperty("station-dot", "circle-opacity", stationOpacity);
    map.setPaintProperty("station-dot", "circle-stroke-opacity", stationOpacity);
    map.setPaintProperty("station-interchange-core", "circle-opacity", stationOpacity);
    map.setPaintProperty("station-label-major", "text-opacity", stationLabelOpacity);
    map.setPaintProperty("station-label-minor", "text-opacity", stationLabelOpacity);
  }

  function updateSelectionFilters() {
    const map = state.map;
    if (!map || !map.getLayer("station-selected-ring")) return;
    map.setFilter("station-selected-ring", [
      "==",
      ["get", "id"],
      state.selectedStationId || "__none__",
    ]);
  }

  /* ------------------------------------------------------------------------
     Hover and tooltips
     ------------------------------------------------------------------------ */

  const tooltip = document.createElement("div");
  tooltip.className = "map-tooltip";
  tooltip.setAttribute("aria-hidden", "true");
  mapShell.appendChild(tooltip);

  function showTooltip(html, point) {
    if (!tooltip || !point) return;
    tooltip.innerHTML = html;
    const width = mapEl.clientWidth;
    const x = Math.max(146, Math.min(point.x, width - 146));
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${point.y}px`;
    tooltip.classList.toggle("below", point.y < 108);
    tooltip.classList.add("visible");
    tooltip.setAttribute("aria-hidden", "false");
  }

  function hideTooltip() {
    if (!tooltip) return;
    tooltip.classList.remove("visible");
    tooltip.setAttribute("aria-hidden", "true");
  }

  function setStationHover(feature) {
    const map = state.map;
    if (!map) return;
    const nextIndex = feature ? feature.id : null;
    if (nextIndex === state.hoveredStationIndex) return;
    if (state.hoveredStationIndex != null) {
      try {
        map.setFeatureState(
          { source: "metro-stations", id: state.hoveredStationIndex },
          { hover: false }
        );
      } catch {
        /* style changed while hovering */
      }
    }
    state.hoveredStationIndex = nextIndex;
    if (nextIndex != null) {
      try {
        map.setFeatureState({ source: "metro-stations", id: nextIndex }, { hover: true });
      } catch {
        /* no-op */
      }
    }
  }

  function updateLineHover(lineId) {
    if (state.hoveredLineId === lineId) return;
    state.hoveredLineId = lineId;
    const map = state.map;
    if (!map || !map.getLayer("line-hover-glow")) return;
    map.setFilter("line-hover-glow", ["==", ["get", "id"], lineId || "__none__"]);
  }

  function stationTooltip(station) {
    const lineNames = station.line_names.map((name) => name.replace(" Line", "")).join(" · ");
    return `
      <div class="tooltip-head">
        ${lineDots(station.lines)}
        <span class="tooltip-title">${esc(station.short)}</span>
      </div>
      <div class="tooltip-meta">${esc(lineNames)} · ${esc(station.type)}</div>
      ${station.interchange ? '<span class="tooltip-badge">Interchange station</span>' : ""}`;
  }

  function lineTooltip(line) {
    return `
      <div class="tooltip-head">
        <span class="line-dot" style="${styleVar(line.color)}"></span>
        <span class="tooltip-title">${esc(line.name)}</span>
      </div>
      <div class="tooltip-meta">${line.stationCount} stations · ${formatLength(line.lengthKm)} km · ${line.endToEndMin} min end to end</div>`;
  }

  function handleMapHover(event) {
    const map = state.map;
    if (!map || !map.getLayer("station-dot")) return;

    const stationHit = map.queryRenderedFeatures(event.point, { layers: ["station-dot"] })[0];
    if (stationHit) {
      const station = stationsById.get(stationHit.properties.id);
      if (!station) return;
      setStationHover(stationHit);
      updateLineHover(null);
      map.getCanvas().style.cursor = "pointer";
      showTooltip(stationTooltip(station), event.point);
      return;
    }

    setStationHover(null);

    const lineHit = map.queryRenderedFeatures(event.point, { layers: ["line-hit"] })[0];
    if (lineHit) {
      const line = linesById.get(lineHit.properties.id);
      if (!line) return;
      updateLineHover(line.id);
      map.getCanvas().style.cursor = "pointer";
      showTooltip(lineTooltip(line), event.point);
      return;
    }

    updateLineHover(null);
    hideTooltip();
    map.getCanvas().style.cursor = "";
  }

  function handleMapClick(event) {
    const map = state.map;
    if (!map || !map.getLayer("station-dot")) return;

    const stationHit = map.queryRenderedFeatures(event.point, { layers: ["station-dot"] })[0];
    if (stationHit) {
      selectStation(stationHit.properties.id);
      return;
    }

    const lineHit = map.queryRenderedFeatures(event.point, { layers: ["line-hit"] })[0];
    if (lineHit) {
      selectLine(lineHit.properties.id);
      return;
    }

    clearSelection();
  }

  /* ------------------------------------------------------------------------
     Selection
     ------------------------------------------------------------------------ */

  function selectStation(stationId, options = {}) {
    const station = stationsById.get(stationId);
    if (!station) return;
    if (state.focusLineId && !station.lines.includes(state.focusLineId)) {
      state.focusLineId = null;
    }
    state.selectedStationId = station.id;
    state.drawerType = "station";
    renderStationDetail(station);
    openDrawer();
    updateFocusPaint();
    updateSelectionFilters();
    updateActiveUI();
    syncHash();
    if (options.fly !== false) {
      const stationId = station.id;
      scheduleMapView(() => {
        if (state.selectedStationId === stationId) flyToStation(station);
      });
    }
  }

  function selectLine(lineId, options = {}) {
    const line = linesById.get(lineId);
    if (!line) return;
    state.focusLineId = line.id;
    state.selectedStationId = null;
    state.drawerType = "line";
    renderLineDetail(line);
    openDrawer();
    updateFocusPaint();
    updateSelectionFilters();
    updateActiveUI();
    syncHash();
    if (options.fit !== false) {
      const focusId = line.id;
      scheduleMapView(() => {
        if (state.focusLineId === focusId) fitLine(line, options.animate !== false);
      });
    }
  }

  function clearSelection(options = {}) {
    window.clearTimeout(state.viewTimer);
    state.focusLineId = null;
    state.selectedStationId = null;
    state.drawerType = null;
    closeDrawer();
    updateFocusPaint();
    updateSelectionFilters();
    updateActiveUI();
    syncHash();
    hideTooltip();
    if (options.fitNetwork) fitNetwork(true);
  }

  function openDrawer() {
    detailPanel.classList.add("open");
    detailPanel.setAttribute("aria-hidden", "false");
    detailContent.scrollTop = 0;
  }

  function closeDrawer() {
    detailPanel.classList.remove("open");
    detailPanel.setAttribute("aria-hidden", "true");
  }

  function scheduleMapView(callback) {
    window.clearTimeout(state.viewTimer);
    let delay = 0;
    if (mobileQuery.matches && !appEl.classList.contains("sidebar-collapsed")) {
      setSidebarCollapsed(true);
      delay = 500;
    }
    if (delay) {
      state.viewTimer = window.setTimeout(callback, delay);
    } else {
      callback();
    }
  }

  function flyToStation(station) {
    const map = state.map;
    if (!map) return;
    const mobile = mobileQuery.matches;
    map.flyTo({
      center: station.display,
      zoom: Math.max(map.getZoom(), 14.4),
      padding: mobile
        ? { top: 55, right: 20, bottom: 20, left: 20 }
        : { top: 80, right: 410, bottom: 70, left: 60 },
      duration: reducedMotion ? 0 : 1050,
      essential: true,
    });
  }

  function fitLine(line, animate = true) {
    const map = state.map;
    if (!map || !line.bounds) return;
    const [west, south, east, north] = line.bounds;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      {
        padding: fitPadding(true),
        duration: animate && !reducedMotion ? 950 : 0,
        maxZoom: 13.6,
      }
    );
  }

  function fitNetwork(animate = true) {
    const map = state.map;
    if (!map) return;
    const [west, south, east, north] = DATA.meta.bounds;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      {
        padding: fitPadding(false),
        duration: animate && !reducedMotion ? 950 : 0,
        maxZoom: 12.3,
      }
    );
  }

  function fitPadding(withDrawer) {
    if (mobileQuery.matches) {
      return { top: 58, right: 48, bottom: withDrawer ? 22 : 30, left: 48 };
    }
    return {
      top: 82,
      right: withDrawer ? 410 : 72,
      bottom: 68,
      left: 58,
    };
  }

  function applyInitialView() {
    const params = readHashState();
    const stationId = params.get("station");
    const lineId = params.get("line");

    if (stationId && stationsById.has(stationId)) {
      selectStation(stationId, { fly: false });
      if (mobileQuery.matches) setSidebarCollapsed(true);
      const station = stationsById.get(stationId);
      state.map.jumpTo({ center: station.display, zoom: 14.4 });
      return;
    }

    if (lineId && linesById.has(lineId)) {
      selectLine(lineId, { fit: false });
      if (mobileQuery.matches) setSidebarCollapsed(true);
      fitLine(linesById.get(lineId), false);
      return;
    }

    fitNetwork(false);
  }

  function syncHash() {
    const params = new URLSearchParams();
    if (state.currentStyle !== "positron") params.set("style", state.currentStyle);
    if (state.selectedStationId) params.set("station", state.selectedStationId);
    else if (state.focusLineId) params.set("line", state.focusLineId);
    const hash = params.toString();
    try {
      const next = `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ""}`;
      window.history.replaceState(null, "", next);
    } catch {
      /* file:// in some browsers blocks history updates */
    }
  }

  function readHashState() {
    try {
      return new URLSearchParams(window.location.hash.replace(/^#/, ""));
    } catch {
      return new URLSearchParams();
    }
  }

  /* ------------------------------------------------------------------------
     Detail panel
     ------------------------------------------------------------------------ */

  function renderLineDetail(line) {
    const lineNumber = DATA.lines.findIndex((item) => item.id === line.id) + 1;
    const stations = line.stationIds.map((stationId) => stationsById.get(stationId)).filter(Boolean);
    const openedYear = (String(line.opened).match(/\d{4}/) || ["—"])[0];
    const averageSpeed = line.operatingSpeedKmph ? `${line.operatingSpeedKmph} km/h` : null;

    const routeStops = stations
      .map((station, index) => {
        const isTerminus = index === 0 || index === stations.length - 1;
        return `
          <button type="button" class="route-stop${station.interchange ? " is-interchange" : ""}"
            data-station="${esc(station.id)}"
            title="Open ${esc(station.name)}"
            aria-label="Open ${esc(station.name)}">
            <span class="stop-node" aria-hidden="true"></span>
            <span class="stop-index">${pad2(index + 1)}</span>
            <span class="stop-name">${esc(station.short)}</span>
            <span class="stop-flags">
              ${station.interchange ? '<span class="stop-flag interchange">Interchange</span>' : ""}
              ${isTerminus && !station.interchange ? '<span class="stop-flag">Terminus</span>' : ""}
            </span>
            <span class="stop-type">${esc(station.type)}</span>
          </button>`;
      })
      .join("");

    detailContent.innerHTML = `
      <div class="detail-hero" style="--accent:${esc(line.color)}">
        <p class="detail-kicker">
          <span class="line-dot" style="${styleVar(line.color)}"></span>
          Operational line · ${pad2(lineNumber)} / ${pad2(DATA.lines.length)}
        </p>
        <h2 class="detail-title">${esc(line.name)}</h2>
        <p class="detail-route">
          <strong>${esc(line.terminals[0])}</strong>
          <span class="route-arrow" aria-hidden="true">↔</span>
          <strong>${esc(line.terminals[1])}</strong>
        </p>
        <div class="detail-badges">
          <span class="detail-badge accent">${line.stationCount} stations</span>
          <span class="detail-badge">${formatLength(line.lengthKm)} km</span>
          <span class="detail-badge">${line.endToEndMin} min end to end</span>
        </div>
      </div>

      <div class="detail-body">
        <div class="metric-grid">
          <div class="metric">
            <span class="metric-label">Route length</span>
            <span class="metric-value">${formatLength(line.lengthKm)}<small> km</small></span>
          </div>
          <div class="metric">
            <span class="metric-label">Stations</span>
            <span class="metric-value">${line.stationCount}<small> stops</small></span>
          </div>
          <div class="metric">
            <span class="metric-label">End to end</span>
            <span class="metric-value">${line.endToEndMin}<small> min</small></span>
          </div>
          <div class="metric">
            <span class="metric-label">First opened</span>
            <span class="metric-value">${esc(openedYear)}</span>
          </div>
        </div>

        <p class="detail-description">${esc(line.description)}</p>

        <div class="detail-actions">
          <button type="button" class="btn solid" data-action="fit-line">Fit line on map</button>
          <button type="button" class="btn" data-action="fit-network">Whole network</button>
        </div>

        <section class="detail-section">
          <h3 class="detail-section-title">Line facts <span>BMRCL</span></h3>
          <dl class="detail-facts">
            <div><dt>Opened</dt><dd>${esc(line.opened)}</dd></div>
            <div><dt>Last extension</dt><dd>${esc(line.lastExtension)}</dd></div>
            ${averageSpeed ? `<div><dt>Avg. speed</dt><dd>${esc(averageSpeed)}</dd></div>` : ""}
            <div><dt>Depots</dt><dd>${esc(line.depots.join(", "))}</dd></div>
            <div><dt>Corridor</dt><dd>${esc(line.neighbourhoods.join(" · "))}</dd></div>
          </dl>
        </section>

        <section class="detail-section">
          <h3 class="detail-section-title">Stations <span>${stations.length} stops · ${esc(line.shortName)}</span></h3>
          <div class="route-list" style="--accent:${esc(line.color)}">${routeStops}</div>
        </section>
      </div>`;
  }

  function formatConnections(connections) {
    if (!connections.length) {
      return '<p class="connection-empty">No rail or bus interchange is listed at this station.</p>';
    }
    return `
      <div class="connections">
        ${connections
          .map((connection) => {
            const icon = LINE_ICONS[connection.type] || LINE_ICONS.future;
            return `<span class="connection-chip ${esc(connection.type)}">${icon}${esc(connection.label)}</span>`;
          })
          .join("")}
      </div>`;
  }

  function renderStationDetail(station) {
    const primary = linesById.get(station.primary_line) || linesById.get(station.lines[0]);
    const accent = station.interchange ? "#121926" : primary?.color || "#121926";
    const typeLabel = station.type === "At grade" ? "At-grade" : station.type;

    const lineButtons = station.lines
      .map((lineId) => {
        const line = linesById.get(lineId);
        if (!line) return "";
        return `
          <button type="button" class="station-line-btn" data-line="${esc(line.id)}">
            <span class="line-dot" style="${styleVar(line.color)}" aria-hidden="true"></span>
            <span class="station-line-btn-copy">
              <strong>${esc(line.name)}</strong>
              <small>Stop ${station.sequences[lineId]} of ${line.stationCount} · opened ${esc(
                station.opened_by_line?.[lineId] || line.opened
              )}</small>
            </span>
            <span class="station-line-btn-arrow" aria-hidden="true">→</span>
          </button>`;
      })
      .join("");

    const primaryLine = primary || null;
    const neighbours = primaryLine ? getNeighbours(station, primaryLine.id) : { previous: null, next: null };
    const adjacentButtons = [
      neighbours.previous
        ? `<button type="button" class="adjacent-btn" data-station="${esc(neighbours.previous.id)}">
             <small>Previous${primaryLine ? ` · ${esc(primaryLine.shortName)}` : ""}</small>
             <span>← ${esc(neighbours.previous.short)}</span>
           </button>`
        : "",
      neighbours.next
        ? `<button type="button" class="adjacent-btn" data-station="${esc(neighbours.next.id)}">
             <small>Next${primaryLine ? ` · ${esc(primaryLine.shortName)}` : ""}</small>
             <span>${esc(neighbours.next.short)} →</span>
           </button>`
        : "",
    ].join("");

    const description = station.interchange
      ? `An interchange station between the ${station.line_names.join(" and ")}. Change trains here without leaving the paid area.`
      : `An ${typeLabel.toLowerCase()} station on the ${station.line_names[0]}, opened in ${esc(
          String(station.opened)
        )}.`;

    detailContent.innerHTML = `
      <div class="detail-hero" style="--accent:${esc(accent)}">
        <p class="detail-kicker">
          ${lineDots(station.lines)}
          ${station.interchange ? "Interchange" : "Station"} · ${esc(typeLabel)}
        </p>
        <h2 class="detail-title">${esc(station.name)}</h2>
        <p class="detail-route">${esc(station.line_names.join(" ↔ "))}</p>
        <div class="detail-badges">
          ${station.interchange ? '<span class="detail-badge accent">Interchange</span>' : ""}
          ${station.codes.map((code) => `<span class="detail-badge">${esc(code)}</span>`).join("")}
          <span class="detail-badge">${esc(String(station.opened))}</span>
        </div>
      </div>

      <div class="detail-body">
        <div class="metric-grid">
          <div class="metric">
            <span class="metric-label">Station type</span>
            <span class="metric-value">${esc(typeLabel)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Station code</span>
            <span class="metric-value">${esc(station.codes.join(" · ") || "—")}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Opened</span>
            <span class="metric-value">${esc(String(station.opened))}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Lines</span>
            <span class="metric-value">${station.lines.length}<small> ${station.lines.length === 1 ? "line" : "lines"}</small></span>
          </div>
        </div>

        <p class="detail-description">${esc(description)}</p>

        <div class="detail-actions">
          <button type="button" class="btn solid" data-action="recenter-station">Recentre on map</button>
          <button type="button" class="btn" data-action="fit-network">Whole network</button>
        </div>

        <section class="detail-section">
          <h3 class="detail-section-title">On the network</h3>
          <div class="station-lines">${lineButtons}</div>
        </section>

        <section class="detail-section">
          <h3 class="detail-section-title">Connections</h3>
          ${formatConnections(station.connections)}
        </section>

        <section class="detail-section">
          <h3 class="detail-section-title">
            Nearby stops
            <span>${primaryLine ? esc(primaryLine.shortName) + " Line" : ""}</span>
          </h3>
          <div class="adjacent-grid">${adjacentButtons}</div>
        </section>

        <p class="coords-line">${Number(station.display[1]).toFixed(5)}° N · ${Number(
          station.display[0]
        ).toFixed(5)}° E</p>
      </div>`;
  }

  function bindDetailPanel() {
    document.getElementById("detailClose")?.addEventListener("click", () => clearSelection());

    detailContent.addEventListener("click", (event) => {
      const stationTarget = event.target.closest("[data-station]");
      if (stationTarget) {
        selectStation(stationTarget.dataset.station);
        return;
      }

      const lineTarget = event.target.closest("[data-line]");
      if (lineTarget) {
        selectLine(lineTarget.dataset.line);
        return;
      }

      const actionTarget = event.target.closest("[data-action]");
      if (!actionTarget) return;
      const action = actionTarget.dataset.action;

      if (action === "fit-line" && state.focusLineId) {
        fitLine(linesById.get(state.focusLineId), true);
      } else if (action === "fit-network") {
        clearSelection({ fitNetwork: true });
      } else if (action === "recenter-station" && state.selectedStationId) {
        flyToStation(stationsById.get(state.selectedStationId));
      }
    });
  }

  /* ------------------------------------------------------------------------
     Sidebar and UI bindings
     ------------------------------------------------------------------------ */

  function updateActiveUI() {
    document.querySelectorAll(".line-card").forEach((card) => {
      const active = card.dataset.line === state.focusLineId;
      card.classList.toggle("is-active", active);
      card.setAttribute("aria-pressed", String(active));
    });

    document.querySelectorAll(".legend-item").forEach((item) => {
      item.classList.toggle(
        "is-dim",
        Boolean(state.focusLineId) && item.dataset.line !== state.focusLineId
      );
      item.classList.toggle("is-active", item.dataset.line === state.focusLineId);
    });

    document.getElementById("legendAll")?.classList.toggle("is-active", !state.focusLineId);
  }

  function setSidebarCollapsed(collapsed) {
    appEl.classList.toggle("sidebar-collapsed", collapsed);
    const toggle = document.getElementById("panelToggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", collapsed ? "Expand network panel" : "Collapse network panel");
    }
    window.setTimeout(() => state.map?.resize(), 460);
  }

  function bindSidebar() {
    document.getElementById("lineCards")?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-line]");
      if (card) selectLine(card.dataset.line);
    });

    document.getElementById("interchangeList")?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-station]");
      if (card) selectStation(card.dataset.station);
    });

    document.getElementById("mapLegend")?.addEventListener("click", (event) => {
      const lineButton = event.target.closest("[data-line]");
      if (lineButton) {
        selectLine(lineButton.dataset.line);
        return;
      }
      if (event.target.closest("#legendAll")) {
        clearSelection();
      }
    });

    document.getElementById("panelToggle")?.addEventListener("click", () => {
      setSidebarCollapsed(!appEl.classList.contains("sidebar-collapsed"));
    });

    document.getElementById("sidebarOpen")?.addEventListener("click", () => {
      setSidebarCollapsed(false);
    });
  }

  function bindMapControls() {
    document.getElementById("zoomIn")?.addEventListener("click", () => state.map?.zoomIn());
    document.getElementById("zoomOut")?.addEventListener("click", () => state.map?.zoomOut());
    document.getElementById("fitNetwork")?.addEventListener("click", () => {
      clearSelection({ fitNetwork: true });
    });
    document.getElementById("locateMe")?.addEventListener("click", locateUser);

    window.addEventListener("resize", () => {
      window.clearTimeout(bindMapControls.resizeTimer);
      bindMapControls.resizeTimer = window.setTimeout(() => state.map?.resize(), 120);
    });
  }

  function locateUser() {
    const button = document.getElementById("locateMe");
    if (!navigator.geolocation) {
      showToast("Location is not available in this browser.");
      return;
    }

    button?.classList.add("is-locating");
    button?.setAttribute("aria-busy", "true");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords;
        if (!state.map) return;

        state.userMarker?.remove();
        const markerEl = document.createElement("div");
        markerEl.className = "user-location";
        markerEl.setAttribute("aria-label", "Your location");
        state.userMarker = new maplibregl.Marker({ element: markerEl, anchor: "center" })
          .setLngLat([longitude, latitude])
          .addTo(state.map);

        const nearest = nearestStation(latitude, longitude);
        state.map.flyTo({
          center: [longitude, latitude],
          zoom: Math.max(state.map.getZoom(), 13.7),
          duration: reducedMotion ? 0 : 1200,
          essential: true,
        });

        if (nearest) {
          const distance =
            nearest.distanceKm < 1
              ? `${Math.round(nearest.distanceKm * 1000)} m`
              : `${nearest.distanceKm.toFixed(1)} km`;
          showToast(`You are here. Nearest metro station: ${nearest.station.name} · ${distance}.`, 5200);
        } else {
          showToast("You are here.");
        }

        button?.classList.remove("is-locating");
        button?.removeAttribute("aria-busy");
      },
      (error) => {
        const messages = {
          1: "Location permission was denied. Allow location access to find the nearest station.",
          2: "Your location could not be determined right now.",
          3: "Location lookup timed out. Please try again.",
        };
        showToast(messages[error.code] || "Your location could not be determined.", 4500);
        button?.classList.remove("is-locating");
        button?.removeAttribute("aria-busy");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function nearestStation(latitude, longitude) {
    let nearest = null;
    DATA.stations.forEach((station) => {
      const [lng, lat] = station.display;
      const distanceKm = haversine(latitude, longitude, lat, lng);
      if (!nearest || distanceKm < nearest.distanceKm) nearest = { station, distanceKm };
    });
    return nearest;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const earthRadius = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ------------------------------------------------------------------------
     Basemap switching
     ------------------------------------------------------------------------ */

  function getInitialStyle() {
    const fromHash = readHashState().get("style");
    if (fromHash && STYLES[fromHash]) return fromHash;
    try {
      const saved = window.localStorage.getItem("namma-metro-basemap");
      if (saved && STYLES[saved]) return saved;
    } catch {
      /* localStorage can be unavailable on file:// */
    }
    return "positron";
  }

  function setStyleButtons() {
    document.querySelectorAll(".style-switcher [data-style]").forEach((button) => {
      const active = button.dataset.style === state.currentStyle;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setBasemap(styleName, options = {}) {
    if (!STYLES[styleName]) return;
    const changed = styleName !== state.currentStyle;
    state.currentStyle = styleName;
    appEl.dataset.basemap = styleName;
    setStyleButtons();

    try {
      window.localStorage.setItem("namma-metro-basemap", styleName);
    } catch {
      /* ignored */
    }

    syncHash();

    if (!changed) return;

    if (state.map) {
      state.map.setStyle(STYLES[styleName].url, { diff: false });
    }

    if (options.announce !== false) {
      showToast(`${STYLES[styleName].label} basemap`, 1800);
    }
  }

  function bindStyleSwitcher() {
    document.querySelectorAll(".style-switcher [data-style]").forEach((button) => {
      button.addEventListener("click", () => setBasemap(button.dataset.style));
    });
  }

  /* ------------------------------------------------------------------------
     Clock, loading and init
     ------------------------------------------------------------------------ */

  function updateClock() {
    if (!clockEl) return;
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
    clockEl.textContent = `${time} IST`;
    clockEl.title = "Indian Standard Time · Asia/Kolkata";
  }

  function finishLoading() {
    window.clearTimeout(state.loadTimer);
    const elapsed = performance.now() - initStartedAt;
    window.setTimeout(
      () => {
        loadingEl?.classList.add("is-hidden");
        state.map?.resize();
      },
      Math.max(0, 650 - elapsed)
    );
  }

  const initStartedAt = performance.now();

  function init() {
    renderMeta();
    renderLineCards();
    renderInterchanges();
    renderLegend();
    renderNotes();
    bindSearch();
    bindSidebar();
    bindDetailPanel();
    bindMapControls();
    bindStyleSwitcher();
    updateActiveUI();

    state.currentStyle = getInitialStyle();
    appEl.dataset.basemap = state.currentStyle;
    setStyleButtons();

    updateClock();
    window.setInterval(updateClock, 20000);

    if (searchResults) searchResults.setAttribute("role", "listbox");

    initMap();
  }

  init();
})();
