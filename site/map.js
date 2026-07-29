// map.js — draws the map from site/accomplishments.json
//
// In plain English: load the data file, drop a category-colored icon pin for each
// located accomplishment, fill the popup with its story + source link, build the
// clickable category legend (which also filters the map), and list any "statewide"
// (no-location) items in the sidebar.

// ---------------------------------------------------------------------------
// Leaflet.SmoothWheelZoom v1.0.2 — buttery trackpad/wheel zoom instead of
// jumpy steps. (c) mutsuyuki, MIT. https://github.com/mutsuyuki/Leaflet.SmoothWheelZoom
// Inlined so the site stays self-contained (same as loading Leaflet from a CDN).
// ---------------------------------------------------------------------------
L.Map.mergeOptions({ smoothWheelZoom: true, smoothSensitivity: 1 });
L.Map.SmoothWheelZoom = L.Handler.extend({
  addHooks: function () { L.DomEvent.on(this._map._container, "wheel", this._onWheelScroll, this); },
  removeHooks: function () { L.DomEvent.off(this._map._container, "wheel", this._onWheelScroll, this); },
  _onWheelScroll: function (e) {
    if (!this._isWheeling) this._onWheelStart(e);
    this._onWheeling(e);
  },
  _onWheelStart: function (e) {
    var map = this._map;
    this._isWheeling = true;
    this._wheelMousePosition = map.mouseEventToContainerPoint(e);
    this._centerPoint = map.getSize()._divideBy(2);
    this._startLatLng = map.containerPointToLatLng(this._centerPoint);
    this._wheelStartLatLng = map.containerPointToLatLng(this._wheelMousePosition);
    this._startZoom = map.getZoom();
    this._moved = false;
    this._zooming = true;
    map._stop();
    if (map._panAnim) map._panAnim.stop();
    this._goalZoom = map.getZoom();
    this._prevCenter = map.getCenter();
    this._prevZoom = map.getZoom();
    this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
  },
  _onWheeling: function (e) {
    var map = this._map;
    this._goalZoom = this._goalZoom - e.deltaY * 0.003 * map.options.smoothSensitivity;
    if (this._goalZoom < map.getMinZoom() || this._goalZoom > map.getMaxZoom()) {
      this._goalZoom = map._limitZoom(this._goalZoom);
    }
    this._wheelMousePosition = map.mouseEventToContainerPoint(e);
    clearTimeout(this._timeoutId);
    this._timeoutId = setTimeout(this._onWheelEnd.bind(this), 200);
    L.DomEvent.preventDefault(e);
    L.DomEvent.stopPropagation(e);
  },
  _onWheelEnd: function () {
    this._isWheeling = false;
    cancelAnimationFrame(this._zoomAnimationId);
    this._map._moveEnd(true);
  },
  _updateWheelZoom: function () {
    var map = this._map;
    if (!map.getCenter().equals(this._prevCenter) || map.getZoom() != this._prevZoom) return;
    this._zoom = map.getZoom() + (this._goalZoom - map.getZoom()) * 0.3;
    this._zoom = Math.floor(this._zoom * 100) / 100;
    var delta = this._wheelMousePosition.subtract(this._centerPoint);
    if (delta.x === 0 && delta.y === 0) return;
    var center = map.unproject(
      map.project(this._wheelStartLatLng, this._zoom).subtract(delta),
      this._zoom
    );
    map.setView(center, this._zoom, { animate: false });
    this._prevCenter = map.getCenter();
    this._prevZoom = map.getZoom();
    this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
  },
});
L.Map.addInitHook("addHandler", "smoothWheelZoom", L.Map.SmoothWheelZoom);

// ---------------------------------------------------------------------------
// The map itself
// ---------------------------------------------------------------------------
// Start centered on the Peninsula (District 13). We turn OFF Leaflet's default
// stepped wheel zoom and turn ON the smooth one above.
//
// zoomSnap MUST be 0 for smooth zoom to work: the smooth handler sets a new
// fractional zoom (e.g. 11.03) on every animation frame, but any non-zero
// zoomSnap rounds each of those back to the nearest step — which is exactly
// what made the wheel feel stuck/broken before. With zoomSnap:0 the zoom can
// glide continuously. zoomDelta still controls the +/- buttons & double-click.
const map = L.map("map", {
  scrollWheelZoom: false,
  smoothWheelZoom: true,
  smoothSensitivity: 1,
  zoomSnap: 0,
  zoomDelta: 0.6,
  maxBoundsViscosity: 1.0, // hard wall at the pan edge (set the edge itself below)
}).setView([37.47, -122.20], 11);

// Free CARTO "Voyager" basemap — clean and light, so pins stand out and the
// dimmed area outside the district blends in. keepBuffer/updateWhenIdle load a
// bigger ring of tiles so panning/zooming out doesn't flash blank gray.
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  subdomains: "abcd",
  maxZoom: 20,
  keepBuffer: 6,
  updateWhenIdle: false,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

// ---------------------------------------------------------------------------
// Category icons — one white line-glyph per category (Lucide icons, MIT).
// Sized by CSS (.pin-badge / .legend-badge / .badge svg), so no width here.
// ---------------------------------------------------------------------------
const ICON_PATHS = {
  environment: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>',
  energy: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  housing: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  education: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  health: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/><path d="M3.2 12h5.3l.5-1 2 4.5 2-7 1.5 3.5h5.3"/>',
  transportation: '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
  jobs: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  "public-safety": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  infrastructure: '<path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M14 6a6 6 0 0 1 6 6v2"/><path d="M4 14v-2a6 6 0 0 1 6-6"/><rect x="2" y="14" width="20" height="5" rx="1"/>',
  tech: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v2"/><path d="M15 2v2"/><path d="M9 20v2"/><path d="M15 20v2"/><path d="M2 9h2"/><path d="M2 15h2"/><path d="M20 9h2"/><path d="M20 15h2"/>',
  legislation: '<path d="M10 18v-7"/><path d="M11.1 2.2a2 2 0 0 1 1.8 0l7.9 3.85c.47.23.3.95-.23.95H3.44c-.53 0-.7-.72-.22-.95z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/>',
  recognition: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  service: '<path d="M11 14h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16"/><path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"/><path d="m2 15 6 6"/><path d="M19.5 8.5c.7-.7 1.5-1.6 1.5-2.7A2.73 2.73 0 0 0 16 4a2.78 2.78 0 0 0-5 1.8c0 1.2.8 2 1.5 2.8L16 12z"/>',
  _default: '<circle cx="12" cy="12" r="7"/>',
};

// Categories are stored hyphenated ("public-safety") because that's a safe key.
// For anything a person reads, swap the hyphen for a space so CSS `capitalize`
// renders "Public Safety" rather than "Public-Safety".
function prettyCat(category) {
  return String(category).replace(/-/g, " ");
}

function catSvg(category) {
  const inner = ICON_PATHS[category] || ICON_PATHS._default;
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>"
  );
}

// --- District spotlight: dim everything that isn't SD13 ---
// The trick: draw ONE gray shape over the region, then punch a hole in it shaped
// exactly like District 13. Inside the hole you see the normal map; everything
// outside is dimmed. The shape used to span the whole globe, which repainted a
// beat behind every pan/zoom (the "gray lag"). Now it's a rectangle only a little
// larger than the farthest you can pan, so it repaints instantly.
//
// The mask sits ABOVE the tiles but BELOW the pins, so pins stay bright + clickable.
map.createPane("maskPane");
map.getPane("maskPane").style.zIndex = 350; // tiles=200, mask=350, pins(markers)=600

// The "?v=" on the data fetches is a cache-buster. A browser caches by URL, so
// a plain "accomplishments.json" can be served from a stale copy for hours —
// which is exactly why the live map and localhost once looked like different
// sites while the files were byte-identical. map.js itself gets stamped the
// same way by scripts/stamp_assets.py. DATA_V is bumped whenever data changes.
const DATA_V = "2026-07-29";

fetch("sd13.geojson?v=" + DATA_V)
  .then((response) => response.json())
  .then((geo) => {
    // GeoJSON stores points as [longitude, latitude]; Leaflet wants [lat, lng].
    const district = geo.features[0].geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);

    // Gold boundary — the accent color from the senator's official site. It
    // reads clearly against both the bright district and the dimmed surround.
    const outline = L.polygon(district, {
      pane: "maskPane",
      color: "#f2b325",
      weight: 3,
      fill: false,
      interactive: false,
    }).addTo(map);

    // Frame the map on the whole district (this is the point of the view).
    map.fitBounds(outline.getBounds(), { padding: [20, 20] });

    // The farthest the user can pan: the district box grown ~35% on each side.
    const panBounds = outline.getBounds().pad(0.35);
    map.setMaxBounds(panBounds);
    map.setMinZoom(map.getZoom() - 1);

    // The dim mask's outer ring. This is a static rectangle (not a globe-spanning
    // polygon, which is what used to cause the gray "lag"), so we can make it
    // generously large with no performance cost. Grown 2x on each side so its
    // edges always sit far outside the viewport — even zoomed all the way out on
    // a wide monitor you never catch the gray running out.
    const m = outline.getBounds().pad(2.0);
    const outer = [
      [m.getSouth(), m.getWest()],
      [m.getSouth(), m.getEast()],
      [m.getNorth(), m.getEast()],
      [m.getNorth(), m.getWest()],
    ];
    L.polygon([outer, district], {
      pane: "maskPane",
      stroke: false,
      fillColor: "#07274b", // the official site's deep navy
      fillOpacity: 0.5,
      interactive: false, // clicks pass through to the map underneath
    }).addTo(map);
  })
  .catch((error) => console.error("Could not load the SD13 boundary:", error));

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function popupHtml(item, color) {
  const place = [item.location_name, item.city].filter(Boolean).join(", ");
  return `
    <div class="pop-title">${escapeHtml(item.title)}</div>
    <div class="pop-meta">
      ${item.year} &middot; ${escapeHtml(place)}
      <span class="badge" style="background:${color}">${catSvg(item.category)}${escapeHtml(prettyCat(item.category))}</span>
    </div>
    <div class="pop-summary">${escapeHtml(item.summary)}</div>
    <a class="pop-source" href="${encodeURI(item.source_url)}" target="_blank" rel="noopener">
      Read the official announcement &rarr;
    </a>`;
}

fetch("accomplishments.json?v=" + DATA_V)
  .then((response) => response.json())
  .then((data) => {
    const colors = data.colors || {};
    const usedCategories = new Set();
    const counts = {}; // category -> how many pins, shown as a pill in the legend
    const groups = {}; // category -> LayerGroup, so the legend can toggle each one

    function groupFor(category) {
      if (!groups[category]) groups[category] = L.layerGroup().addTo(map);
      return groups[category];
    }

    // --- pins: a colored badge with the category's white icon ---
    data.pins.forEach((item) => {
      const color = colors[item.category] || "#555";
      usedCategories.add(item.category);
      counts[item.category] = (counts[item.category] || 0) + 1;

      const icon = L.divIcon({
        className: "pin-marker",
        html: `<div class="pin-badge" style="--c:${color}">${catSvg(item.category)}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -16],
      });

      L.marker([item.lat, item.lon], { icon, title: item.title, keyboard: false })
        .bindPopup(popupHtml(item, color), { maxWidth: 300 })
        .addTo(groupFor(item.category));
    });

    // --- header stat line: "N accomplishments · M categories" ---
    const stat = document.getElementById("stat");
    if (stat) {
      const nPins = data.pins.length;
      const nCats = usedCategories.size;
      const nState = (data.statewide || []).length;
      stat.innerHTML =
        `<strong>${nPins}</strong> mapped accomplishment${nPins === 1 ? "" : "s"}` +
        ` <span class="stat-dot">&middot;</span> <strong>${nCats}</strong> categor${nCats === 1 ? "y" : "ies"}` +
        (nState ? ` <span class="stat-dot">&middot;</span> <strong>${nState}</strong> statewide` : "");
    }

    // --- legend / filter (only categories actually on the map) ---
    const legend = document.getElementById("legend");
    [...usedCategories].sort().forEach((category) => {
      const row = document.createElement("button");
      row.className = "legend-row";
      row.type = "button";
      row.innerHTML =
        `<span class="legend-badge" style="background:${colors[category] || "#555"}">${catSvg(category)}</span>` +
        `<span class="legend-label">${prettyCat(category)}</span>` +
        `<span class="legend-count">${counts[category] || 0}</span>`;
      row.addEventListener("click", () => {
        const g = groups[category];
        if (!g) return;
        if (map.hasLayer(g)) {
          map.removeLayer(g);
          row.classList.add("off");
        } else {
          map.addLayer(g);
          row.classList.remove("off");
        }
      });
      legend.appendChild(row);
    });

    // --- statewide list (no-location approved items) ---
    const statewide = document.getElementById("statewide");
    if (!data.statewide.length) {
      statewide.innerHTML =
        '<div id="statewide-empty">None yet. Bills and statewide wins will appear here as they\'re approved.</div>';
    } else {
      data.statewide.forEach((item) => {
        const el = document.createElement("div");
        el.className = "statewide-item";
        el.innerHTML = `<strong>${escapeHtml(item.title)}</strong> <span class="yr">(${item.year})</span><br>
          <a href="${encodeURI(item.source_url)}" target="_blank" rel="noopener">Read the source &rarr;</a>`;
        statewide.appendChild(el);
      });
    }
  })
  .catch((error) => {
    document.getElementById("map").innerHTML =
      '<p style="padding:20px">Could not load the data file. Make sure you are running the local server (see the how-to).</p>';
    console.error(error);
  });
