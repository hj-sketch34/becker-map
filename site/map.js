// map.js — draws the map from site/accomplishments.json
//
// In plain English: load the data file, drop a category-colored icon pin for each
// located accomplishment, fill the popup with its story + source link, and build
// everything in the side panel — the category legend (which also filters the
// map), a searchable list of every pin, a city scoreboard, a year scrubber, a
// "what's near me" lookup, and a guided tour.
//
// The shape of this file:
//   1. Smooth wheel zoom (a small third-party plugin, inlined)
//   2. The map itself
//   3. Small helpers — icons, text, money, distance
//   4. The district outline, the dim mask, and the opening flight
//   5. Everything that needs the data: pins, filters, panel, widgets
//
// One rule runs through all of it: the filters are the single source of truth.
// Nothing — not the map, not the list, not the city counts — decides for itself
// what to show. They all ask isVisible(), so they can never disagree.

// ---------------------------------------------------------------------------
// 1. Leaflet.SmoothWheelZoom v1.0.2 — buttery trackpad/wheel zoom instead of
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
// 2. The map itself
// ---------------------------------------------------------------------------
// We deliberately start ZOOMED OUT over the whole Bay Area, not on the
// district. The opening flight (section 4) then eases in to District 13, which
// tells you where you are before it tells you what you're looking at.
//
// zoomSnap MUST be 0 for smooth zoom to work: the smooth handler sets a new
// fractional zoom (e.g. 11.03) on every animation frame, but any non-zero
// zoomSnap rounds each of those back to the nearest step — which is exactly
// what made the wheel feel stuck/broken before. With zoomSnap:0 the zoom can
// glide continuously. zoomDelta still controls the +/- buttons & double-click.
//
// Note what is NOT set here: maxBounds and minZoom. Those are the pan/zoom
// walls, and they get applied only AFTER the opening flight lands (see
// applyMapWalls). Setting them up front would fence the map in at the district
// and make the wide opening shot impossible — Leaflet would yank the view back
// mid-flight.
const map = L.map("map", {
  scrollWheelZoom: false,
  smoothWheelZoom: true,
  smoothSensitivity: 1,
  zoomSnap: 0,
  zoomDelta: 0.6,
  maxBoundsViscosity: 1.0, // hard wall at the pan edge (set the edge itself later)
}).setView([37.62, -122.05], 9);

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

// Does this person want animation at all? If their system says "reduce motion"
// we skip the opening flight, the tour's easing, and the pulsing pin.
const REDUCED_MOTION =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// 3. Small helpers
// ---------------------------------------------------------------------------

// Category icons — one white line-glyph per category (Lucide icons, MIT).
// Sized by CSS (.pin-badge / .legend-badge / .badge svg), so no width here.
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

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : text;
  return div.innerHTML;
}

// $8,000,000 -> "$8M".  $4,450,000 -> "$4.45M".  $500,000 -> "$500K".
function money(n) {
  if (n >= 1_000_000) return "$" + String(+(n / 1_000_000).toFixed(2)) + "M";
  if (n >= 1_000) return "$" + Math.round(n / 1_000) + "K";
  return "$" + n;
}

// "$2 million secured for..." -> "2-million-secured-for..."
// This becomes the shareable link (#pin=...), so it has to be stable: it is
// derived from the title alone and never from a position in the list, which
// would change every time a pin is added.
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// A year field can be "2023" or "2023-05-01"; we only ever care about the year.
function yearOf(item) {
  const n = parseInt(String(item.year).slice(0, 4), 10);
  return Number.isFinite(n) ? n : 0;
}

// Straight-line distance between two lat/lon points, in miles. This is the
// "haversine" formula — the standard way to measure across a curved surface.
function milesBetween(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Is a point inside the district shape? This is the "ray casting" trick: draw
// an imaginary line from the point out to infinity and count how many times it
// crosses the boundary. Odd number of crossings = inside. It's the same check
// scripts/geo_guard.py does on the Python side before a pin is ever added — we
// repeat it here so the "are you in District 13?" answer needs no server.
function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lonI] = ring[i];
    const [latJ, lonJ] = ring[j];
    const straddles = latI > lat !== latJ > lat;
    if (straddles && lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI) {
      inside = !inside;
    }
  }
  return inside;
}

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// 4. The district outline, the dim mask, and the opening flight
// ---------------------------------------------------------------------------
// The dimming trick: draw ONE gray shape over the region, then punch a hole in
// it shaped exactly like District 13. Inside the hole you see the normal map;
// everything outside is dimmed. The shape used to span the whole globe, which
// repainted a beat behind every pan/zoom (the "gray lag"). Now it's a rectangle
// only a little larger than the farthest you can pan, so it repaints instantly.
//
// The mask sits ABOVE the tiles but BELOW the pins, so pins stay bright + clickable.
map.createPane("maskPane");
map.getPane("maskPane").style.zIndex = 350; // tiles=200, mask=350, pins(markers)=600

// The "?v=" on the data fetches is a cache-buster. A browser caches by URL, so
// a plain "accomplishments.json" can be served from a stale copy for hours —
// which is exactly why the live map and localhost once looked like different
// sites while the files were byte-identical.
//
// DATA_V is written automatically by scripts/stamp_assets.py — it's a hash of
// the data files themselves, so it changes exactly when the data changes.
// DON'T EDIT IT BY HAND.
//
// It used to be a hand-typed date, which was a real trap: stamping index.html
// re-downloaded map.js whenever the CODE changed, but on a day where only the
// DATA changed this string stayed put, the URL stayed put, and the browser
// served the old accomplishments.json — so newly added pins simply didn't
// appear. That is the single most confusing failure this project has had.
const DATA_V = "3b78cb95";

// The district boundary, as [[lat, lon], ...]. Filled in below; the "near me"
// widget needs it, so it lives out here where everything can reach it.
let districtRing = null;
let districtBounds = null;

const districtReady = fetch("sd13.geojson?v=" + DATA_V)
  .then((response) => response.json())
  .then((geo) => {
    // GeoJSON stores points as [longitude, latitude]; Leaflet wants [lat, lng].
    districtRing = geo.features[0].geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);

    // Gold boundary — the accent color from the senator's official site. It
    // reads clearly against both the bright district and the dimmed surround.
    const outline = L.polygon(districtRing, {
      pane: "maskPane",
      color: "#f2b325",
      weight: 3,
      fill: false,
      interactive: false,
    }).addTo(map);

    districtBounds = outline.getBounds();

    // The dim mask's outer ring. This is a static rectangle (not a globe-spanning
    // polygon, which is what used to cause the gray "lag"), so we can make it
    // generously large with no performance cost. Grown 2x on each side so its
    // edges always sit far outside the viewport — even zoomed all the way out on
    // a wide monitor you never catch the gray running out.
    //
    // IMPORTANT for the opening flight: the mask is drawn BEFORE the flight
    // starts, not after. It's a plain Leaflet polygon, so it's part of the same
    // transform Leaflet animates during a flyTo — it slides and scales with the
    // tiles instead of being redrawn behind them. That's the whole reason the
    // flight doesn't reintroduce the old gray-lag problem: nothing recomputes
    // the mask mid-animation, because there is nothing to recompute.
    const m = districtBounds.pad(2.0);
    const outer = [
      [m.getSouth(), m.getWest()],
      [m.getSouth(), m.getEast()],
      [m.getNorth(), m.getEast()],
      [m.getNorth(), m.getWest()],
    ];
    L.polygon([outer, districtRing], {
      pane: "maskPane",
      stroke: false,
      fillColor: "#07274b", // the official site's deep navy
      fillOpacity: 0.5,
      interactive: false, // clicks pass through to the map underneath
    }).addTo(map);

    flyIntoDistrict();
    return districtRing;
  })
  .catch((error) => {
    console.error("Could not load the SD13 boundary:", error);
    return null;
  });

// Put up the pan/zoom walls. Deliberately NOT called until the opening flight
// has landed — see the note where the map is created.
//
// The fitted zoom is worked out with getBoundsZoom rather than by reading
// map.getZoom() after the fact, so a stray scroll during the flight can't leave
// the minimum zoom set to some accidental value.
function applyMapWalls() {
  if (!districtBounds) return;
  const fitZoom = map.getBoundsZoom(districtBounds, false, L.point(20, 20));
  map.setMaxBounds(districtBounds.pad(0.35)); // the farthest you can pan
  map.setMinZoom(fitZoom - 1);                // how far you can zoom out
}

function flyIntoDistrict() {
  const padding = [20, 20];

  // No animation for anyone who asked for no animation — and none if the page
  // was opened with a deep link to a specific pin, because in that case the
  // person already told us where they want to be.
  if (REDUCED_MOTION || location.hash.startsWith("#pin=")) {
    map.fitBounds(districtBounds, { padding });
    applyMapWalls();
    return;
  }

  // Correctness here deliberately does NOT depend on Leaflet's `moveend`.
  // When the flight can't actually run — a throttled tab, a browser that
  // doesn't advance requestAnimationFrame — Leaflet fires `moveend` straight
  // away without having moved anywhere. Hanging the "we've arrived" logic on
  // that event meant the arrival ran while the map was still on the opening
  // wide shot, and the safety net below was switched off before it could do
  // anything. So a single timer owns the arrival, and the only other way to
  // finish early is the user taking over.
  const DURATION = 2.4;
  let landed = false;
  const land = (rescue) => {
    if (landed) return;
    landed = true;
    // The safety net. An animation can fail to finish for reasons that have
    // nothing to do with this code — a backgrounded tab, a browser that
    // throttles requestAnimationFrame, a device that drops frames. If that
    // happens we must not leave someone parked on the opening wide shot,
    // staring at the edge of the dim mask. So on the timeout path we check
    // where we actually ended up and snap to the district if we're not there.
    //
    // A user who grabbed the map mid-flight is NOT rescued — they went
    // somewhere on purpose, and yanking the view back would be rude.
    //
    // The test is the ZOOM, not the centre. The opening wide shot is centred
    // on the Bay, which already falls inside the district's bounding box — so
    // a centre check quietly passes and rescues nothing. Being zoomed far
    // further out than the fitted view is the thing that actually means
    // "the flight never happened".
    if (rescue) {
      const fitZoom = map.getBoundsZoom(districtBounds, false, L.point(padding[0], padding[1]));
      const stranded = map.getZoom() < fitZoom - 0.6 || !districtBounds.contains(map.getCenter());
      if (stranded) map.fitBounds(districtBounds, { padding });
    }
    applyMapWalls();
  };

  map.once("dragstart", () => land(false)); // interrupted? put the walls up now
  map.flyToBounds(districtBounds, { padding, duration: DURATION, easeLinearity: 0.22 });
  setTimeout(() => land(true), DURATION * 1000 + 400);
}

// ---------------------------------------------------------------------------
// 5. Everything that needs the data
// ---------------------------------------------------------------------------
// "Kind" — the second axis, at right angles to category.
//
// Category answers "what topic is this?" and drives COLOR. Kind answers "how
// big a deal is this?" and drives SIZE:
//
//   funding   — dollars secured for a place. Big pin, gold ring.
//   law       — a bill authored or signed. Normal pin.
//   presence  — he showed up (coffee, seminar, help table, award). Small dot.
//
// The point: $5 million for JobTrain and a community coffee should never look
// like the same thing, even when they share a category.
const WINS = "wins";           // funding + law
const DISTRICT = "district";   // presence

function bucketOf(item) {
  return item.kind === "presence" ? DISTRICT : WINS;
}

// The one-line takeaway that sits above the summary in a popup.
//
// Note what this does NOT do: it never writes a new claim. It only restates
// fields the row already carries — the kind, the amount, the city — in a
// shorter form. Anything that would require judgment about what the
// accomplishment *means* stays in the human-written summary underneath.
function leadLine(item) {
  const place = item.city || "the district";
  if (item.kind === "funding") {
    return item.amount
      ? `${money(item.amount)} secured for ${place}`
      : `State funding secured for ${place}`;
  }
  if (item.kind === "law") return "A state law he authored";
  return `He was there in person — ${place}`;
}

fetch("accomplishments.json?v=" + DATA_V)
  .then((response) => response.json())
  .then((data) => Promise.all([data, districtReady]))
  .then(([data]) => {
    const colors = data.colors || {};
    const series = data.series || {};
    const pins = data.pins || [];
    const statewideItems = data.statewide || [];
    const biggest = Math.max(1, ...pins.map((p) => p.amount || 0));

    // ---- give every pin a stable id we can put in a URL --------------------
    // Two pins can legitimately share a title (the same award in two cities),
    // so a duplicate slug gets a numbered suffix. Sorted-stable, not random.
    const bySlug = new Map();
    pins.forEach((item) => {
      let slug = slugify(item.title);
      if (bySlug.has(slug)) {
        let n = 2;
        while (bySlug.has(slug + "-" + n)) n++;
        slug = slug + "-" + n;
      }
      item._slug = slug;
      bySlug.set(slug, item);
    });

    const years = pins.map(yearOf).filter(Boolean);
    const minYear = years.length ? Math.min(...years) : 0;
    const maxYear = years.length ? Math.max(...years) : 0;

    // =======================================================================
    // FILTER STATE — the single source of truth for what is shown.
    // =======================================================================
    // Every marker lives directly on the map (no layer groups), and one
    // function decides whether it's shown. That keeps the switches — category,
    // the community-events toggle, dollars mode, the year scrubber, the search
    // box and the city filter — from fighting each other.
    const categoryOn = {};       // "wins::housing" -> true/false

    // Community events start VISIBLE (changed 2026-07-30).
    //
    // They used to start hidden, so the first impression was the money and the
    // laws. That made sense when there were 26 of them against 26 wins. It
    // stopped making sense the moment the district research landed: presence
    // pins are now 40 of 68, so the old default hid well over half the map —
    // including almost every newly-researched town — and the map looked
    // emptier than the record actually is. Hiding most of your own work is a
    // worse failure than a busy map. The toggle is still right there.
    let districtOn = true;
    let dollarMode = false;      // dollars view starts OFF
    let yearMax = maxYear;       // the scrubber: show everything up to this year
    let query = "";              // the search box
    let cityFilter = null;       // the city scoreboard

    const key = (item) => bucketOf(item) + "::" + item.category;

    // The text a search looks through. Built once per pin and cached, because
    // rebuilding it on every keystroke for every pin is wasted work.
    function haystack(item) {
      if (!item._hay) {
        item._hay = [
          item.title, item.summary, item.city, item.location_name,
          prettyCat(item.category), item.year, item.series,
        ].filter(Boolean).join(" ").toLowerCase();
      }
      return item._hay;
    }

    function isVisible(item) {
      if (dollarMode) return Boolean(item.amount); // dollars view: money only
      if (yearOf(item) > yearMax) return false;
      if (cityFilter && item.city !== cityFilter) return false;
      if (query) {
        // A search is an explicit request to find something, so it overrides
        // the category switches and the community-events toggle. Hiding a
        // result the person just searched for would be nonsense.
        return haystack(item).includes(query);
      }
      if (categoryOn[key(item)] === false) return false;
      return bucketOf(item) === DISTRICT ? districtOn : true;
    }

    // --- pin size: kind normally, dollars when the dollars view is on ------
    function sizeOf(item) {
      if (dollarMode && item.amount) {
        // Square root, not a straight line: area then tracks the amount, which
        // is how the eye actually reads a circle's size.
        return Math.round(26 + 34 * Math.sqrt(item.amount / biggest));
      }
      if (item.kind === "funding") return 38;
      if (item.kind === "law") return 30;
      return 16; // presence
    }

    function iconFor(item) {
      const color = colors[item.category] || "#555";
      const size = sizeOf(item);
      // A presence pin is a plain dot — no glyph. At 16px an icon is unreadable
      // anyway, and the quieter mark is the whole point.
      const glyph = item.kind === "presence" && !dollarMode ? "" : catSvg(item.category);
      const classes = ["pin-badge"];
      if (item.kind === "presence" && !dollarMode) classes.push("pin-presence");
      if (item.kind === "funding") classes.push("pin-funding");
      return L.divIcon({
        className: "pin-marker",
        html: `<div class="${classes.join(" ")}" style="--c:${color};--s:${size}px">${glyph}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2 - 2],
      });
    }

    // --- the popup ----------------------------------------------------------
    function popupHtml(item) {
      const color = colors[item.category] || "#555";
      const place = [item.location_name, item.city].filter(Boolean).join(", ");

      // A pin in a repeat program says so up front: five separate "community
      // coffee" pins read as filler, but "Community coffees · 5 across the
      // district" reads as a program that happens to have five stops.
      const info = item.series && series[item.series];
      const seriesLine = info
        ? `<div class="pop-series">${escapeHtml(info.label)}
             <span>&middot; ${info.count} across the district</span></div>`
        : "";

      // A photo, when one has been matched to this pin in data/photos.json.
      // alt text is required on the data side, so a screen reader never meets
      // an unexplained image.
      const p = item.photo;
      const caption = p && (p.caption || p.credit)
        ? `<figcaption>${escapeHtml(p.caption || "")}${
             p.credit ? ` <i>${escapeHtml(p.credit)}</i>` : ""
           }</figcaption>`
        : "";
      const photo = p
        ? `<figure class="pop-photo">
             <img src="photos/${encodeURIComponent(p.file)}" alt="${escapeHtml(p.alt || "")}" loading="lazy">
             ${caption}
           </figure>`
        : "";

      const amountChip = item.amount
        ? `<span class="pop-amount">${money(item.amount)}</span>`
        : "";

      return `
        ${photo}
        ${seriesLine}
        <div class="pop-title">${escapeHtml(item.title)}</div>
        <div class="pop-meta">
          ${escapeHtml(item.year)} &middot; ${escapeHtml(place)}
          ${amountChip}
          <span class="badge" style="background:${color}">${catSvg(item.category)}${escapeHtml(prettyCat(item.category))}</span>
        </div>
        <div class="pop-lead">${escapeHtml(leadLine(item))}</div>
        <div class="pop-summary">${escapeHtml(item.summary)}</div>
        <a class="pop-source" href="${encodeURI(item.source_url)}" target="_blank" rel="noopener">
          Read the official announcement &rarr;
        </a>
        <button class="pop-share" type="button" data-slug="${item._slug}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"/></svg>
          Copy link
        </button>`;
    }

    // --- pins landing on the exact same spot -------------------------------
    // Some accomplishments share an address (a city hall, a field office) or
    // fall back to the same city-center coordinate. Stacked pins hide each
    // other completely, so we nudge each one in a group a fixed distance apart
    // in a small ring.
    //
    // The nudge is worked out ONCE, here, from the data alone — not from the
    // zoom level and not from which pins are switched on. That's deliberate: an
    // earlier version recomputed it on every zoom and every filter change,
    // which made pins visibly jump around whenever you zoomed or turned the
    // community events on. A pin now gets one position and keeps it forever.
    //
    // The tradeoff: because the offset is a real distance on the ground rather
    // than a number of pixels, pins in a group still overlap heavily when
    // you're looking at the whole district, and only separate as you zoom in.
    // That's the intended behaviour — overlap is fine, moving pins are not.
    // How far apart to fan a stack of pins that share one coordinate.
    //
    // Raised from 35m to 200m on 2026-07-30, Huck's call. The pins that stack
    // are the ones with no specific address — four Hillsborough events that
    // are genuinely town-wide, all parked on Town Hall. At 35m they sat on top
    // of each other until you were zoomed right in, so the town looked like it
    // had one pin instead of four. A couple of hundred metres is still well
    // inside the town, and it doesn't change any claim: a pin with no venue
    // was never asserting a street corner in the first place. It only makes
    // the count visible at the zoom people actually look at.
    const NUDGE_METRES = 200;

    function spreadIdenticalCoordinates(list) {
      const groups = {};
      list.forEach((pin) => {
        // 5 decimal places is roughly a metre, so this groups pins that are on
        // literally the same point, not merely near each other.
        const spot = pin.lat.toFixed(5) + "," + pin.lon.toFixed(5);
        (groups[spot] = groups[spot] || []).push(pin);
      });

      Object.values(groups).forEach((group) => {
        if (group.length === 1) return;
        group.forEach((pin, i) => {
          const angle = (i / group.length) * 2 * Math.PI - Math.PI / 2;
          // Metres -> degrees. Longitude degrees get narrower toward the poles,
          // hence the cos(latitude).
          const dLat = (NUDGE_METRES * Math.cos(angle)) / 111320;
          const dLon =
            (NUDGE_METRES * Math.sin(angle)) /
            (111320 * Math.cos((pin.lat * Math.PI) / 180));
          pin.lat += dLat;
          pin.lon += dLon;
        });
      });
    }

    spreadIdenticalCoordinates(pins);

    // --- build one marker per pin ------------------------------------------
    const counts = {}; // "bucket::category" -> how many, for the legend pill
    pins.forEach((item) => {
      counts[key(item)] = (counts[key(item)] || 0) + 1;
      const marker = L.marker([item.lat, item.lon], {
        icon: iconFor(item),
        title: item.title,
        keyboard: false,
        riseOnHover: true,
      }).bindPopup(popupHtml(item), { maxWidth: 320, autoPanPadding: [30, 30] });
      marker._item = item;
      item._marker = marker;
      // Opening a popup — however it was opened — updates the address bar, so
      // the link in the URL always points at what you're actually looking at.
      marker.on("popupopen", () => setHash(item._slug));
      marker.on("popupclose", () => setHash(null));
    });

    // =======================================================================
    // REDRAW — one function, called after any switch flips.
    // =======================================================================
    function refresh() {
      pins.forEach((item) => {
        const marker = item._marker;
        const show = isVisible(item);
        if (show && !map.hasLayer(marker)) marker.addTo(map);
        if (!show && map.hasLayer(marker)) map.removeLayer(marker);
        if (show) marker.setIcon(iconFor(item));
      });
      renderList();
      renderCities();
      updateStat();
    }

    // =======================================================================
    // HEADER + HERO
    // =======================================================================
    // Is anything switched on that the person actually chose? Community events
    // being hidden is the page's DEFAULT, not a filter someone applied — so it
    // must not make the header read "26 of 52 pins shown" the moment the page
    // loads, as though something were being withheld.
    function hasUserFilter() {
      return Boolean(
        query || cityFilter || dollarMode ||
        yearMax < maxYear ||
        Object.values(categoryOn).some((on) => on === false)
      );
    }

    function updateStat() {
      const stat = $("stat");
      if (!stat) return;
      if (hasUserFilter()) {
        stat.innerHTML = `<strong>${pins.filter(isVisible).length}</strong> of ${pins.length} pins shown`;
        return;
      }
      // Count what's actually on screen. This used to report only the "wins"
      // because everything else started hidden; now that community events are
      // shown by default, quoting 28 next to 68 visible pins just looks wrong.
      stat.innerHTML =
        `<strong>${pins.length}</strong> places on the map` +
        (statewideItems.length
          ? ` <span class="stat-dot">&middot;</span> <strong>${statewideItems.length}</strong> laws statewide`
          : "");
    }

    // The hero's numbers are all computed here, from the data, so they can
    // never drift out of date the way a hand-typed number does.
    //
    // NO DOLLAR FIGURE HERE, on purpose. The running total is an accurate sum
    // of the amounts on the pins that exist today — but as a headline it reads
    // as "this is what he secured for the district", which is not what it
    // measures and is not something this data can support while the map is
    // still being built. A count of pins is honest about being a count of
    // pins; a dollar total is not honest about being partial, no matter how
    // many qualifiers sit next to it. The running total still lives in the
    // sidebar's "Dollars secured" panel, which is collapsed, labelled, and
    // opened deliberately.
    const cities = [...new Set(pins.map((p) => p.city).filter(Boolean))];
    const fundedCount = [...pins, ...statewideItems].filter((p) => p.amount).length;

    const heroStats = $("hero-stats");
    if (heroStats) {
      const bits = [
        [pins.length, "places pinned"],
        [cities.length, "cities and towns"],
      ];
      if (minYear && maxYear) bits.push([`${minYear}–${maxYear}`, "years of record"]);
      heroStats.innerHTML = bits
        .map(([n, label]) => `<div class="hero-stat"><strong>${n}</strong><span>${label}</span></div>`)
        .join("");
    }
    const caveat = $("hero-caveat");
    if (caveat) {
      caveat.textContent =
        "This map is still being built. These are counts of what has already been " +
        "pinned and sourced — the record is larger than what you see here.";
    }

    const hero = $("hero");
    function dismissHero() {
      if (hero && !hero.classList.contains("gone")) hero.classList.add("gone");
    }
    if (hero) {
      $("hero-explore").addEventListener("click", dismissHero);
      $("hero-tour").addEventListener("click", () => { dismissHero(); startTour(); });
      // Touching the map is also a way of saying "let me look at it".
      map.once("dragstart", dismissHero);
      map.once("click", dismissHero);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") dismissHero();
      });
      // A deep link means someone came here for one specific pin — no landing
      // screen in the way of it.
      if (location.hash.startsWith("#pin=")) dismissHero();
    }

    // =======================================================================
    // LEGEND — two groups: money and laws, then showing-up
    // =======================================================================
    // The split is the whole idea: a coffee chat is a real thing he did — it
    // just isn't the same KIND of thing as $5 million, so it gets its own
    // heading instead of sitting in the same list.
    function buildLegend(containerId, bucket) {
      const container = $(containerId);
      if (!container) return;
      const cats = [
        ...new Set(pins.filter((p) => bucketOf(p) === bucket).map((p) => p.category)),
      ].sort();

      cats.forEach((category) => {
        const rowKey = bucket + "::" + category;
        categoryOn[rowKey] = true;
        const row = document.createElement("button");
        row.className = "legend-row";
        row.type = "button";
        row.setAttribute("aria-pressed", "true");
        row.innerHTML =
          `<span class="legend-badge" style="background:${colors[category] || "#555"}">${catSvg(category)}</span>` +
          `<span class="legend-label">${prettyCat(category)}</span>` +
          `<span class="legend-count">${counts[rowKey] || 0}</span>`;
        row.addEventListener("click", () => {
          categoryOn[rowKey] = !categoryOn[rowKey];
          row.classList.toggle("off", !categoryOn[rowKey]);
          row.setAttribute("aria-pressed", String(categoryOn[rowKey]));
          refresh();
        });
        container.appendChild(row);
      });
    }

    buildLegend("legend-wins", WINS);
    buildLegend("legend-district", DISTRICT);

    // --- the community-events master toggle --------------------------------
    const districtToggle = $("district-toggle");
    const nDistrict = pins.filter((p) => bucketOf(p) === DISTRICT).length;
    function paintDistrictToggle() {
      if (!districtToggle) return;
      districtToggle.textContent = (districtOn ? "Hide" : "Show") + ` community events (${nDistrict})`;
      districtToggle.classList.toggle("on", districtOn);
      districtToggle.setAttribute("aria-pressed", String(districtOn));
      $("district-body").hidden = !districtOn;
    }
    if (districtToggle) {
      paintDistrictToggle();
      districtToggle.addEventListener("click", () => {
        districtOn = !districtOn;
        paintDistrictToggle();
        refresh();
      });
    }

    // --- repeat programs, listed once instead of N times -------------------
    const programs = $("programs");
    const repeated = Object.entries(series).filter(([, info]) => info.count > 1);
    if (programs && repeated.length) {
      repeated
        .sort((a, b) => b[1].count - a[1].count)
        .forEach(([, info]) => {
          const line = document.createElement("div");
          line.className = "program-row";
          line.innerHTML =
            `<span class="program-label">${escapeHtml(info.label)}</span>` +
            `<span class="program-count">${info.count} locations</span>`;
          programs.appendChild(line);
        });
    }

    // --- the dollars view (starts collapsed, and the mode starts off) -------
    const dollarPanel = $("dollars");
    if (dollarPanel && data.dollars) {
      // Count across pins AND statewide items, because the total does too —
      // one funded project (the Ohlone-Portolá Trail) has no single address
      // and so lives in the statewide list rather than on the map.
      $("dollar-total").textContent = money(data.dollars) + "+";
      $("dollar-note").textContent =
        `at least, across ${fundedCount} projects in the district — still being added to`;

      const head = $("dollar-head");
      head.addEventListener("click", () => {
        const body = $("dollar-body");
        body.hidden = !body.hidden;
        head.classList.toggle("open", !body.hidden);
        head.setAttribute("aria-expanded", String(!body.hidden));
      });

      // The switch inside it turns on the map view: only funded pins, each
      // sized by how much money it represents.
      const modeSwitch = $("dollar-mode");
      modeSwitch.addEventListener("change", () => {
        dollarMode = modeSwitch.checked;
        document.body.classList.toggle("dollar-mode", dollarMode);
        refresh();
      });
    }

    // --- statewide list (no-location approved items) ------------------------
    const statewide = $("statewide");
    if (!statewideItems.length) {
      statewide.innerHTML =
        '<div id="statewide-empty">None yet. Bills and statewide wins will appear here as they\'re approved.</div>';
    } else {
      statewideItems.forEach((item) => {
        const el = document.createElement("div");
        el.className = "statewide-item";
        el.innerHTML = `<strong>${escapeHtml(item.title)}</strong> <span class="yr">(${escapeHtml(item.year)})</span><br>
          <a href="${encodeURI(item.source_url)}" target="_blank" rel="noopener">Read the source &rarr;</a>`;
        statewide.appendChild(el);
      });
    }

    // =======================================================================
    // THE YEAR SCRUBBER
    // =======================================================================
    // It's cumulative — "everything up to and including this year" — not a
    // single-year window. Watching pins accumulate 2021 → 2026 is the story of
    // a term; flicking between disconnected single years isn't.
    const timeRange = $("time-range");
    const timeLabel = $("time-label");
    let playTimer = null;

    function paintTimeline() {
      if (!timeLabel) return;
      timeLabel.innerHTML =
        yearMax >= maxYear
          ? `All years <b>${minYear}–${maxYear}</b>`
          : `Through <b>${yearMax}</b>`;
    }

    if (timeRange && minYear && maxYear > minYear) {
      $("timeline").hidden = false;
      timeRange.min = String(minYear);
      timeRange.max = String(maxYear);
      timeRange.step = "1";
      timeRange.value = String(maxYear);
      paintTimeline();

      timeRange.addEventListener("input", () => {
        stopPlay();
        yearMax = parseInt(timeRange.value, 10);
        paintTimeline();
        refresh();
      });

      $("time-reset").addEventListener("click", () => {
        stopPlay();
        yearMax = maxYear;
        timeRange.value = String(maxYear);
        paintTimeline();
        refresh();
      });

      $("time-play").addEventListener("click", () => {
        if (playTimer) { stopPlay(); return; }
        // Start over from the beginning if we're already at the end.
        yearMax = yearMax >= maxYear ? minYear : yearMax;
        $("time-play").classList.add("on");
        timeRange.value = String(yearMax);
        paintTimeline();
        refresh();
        playTimer = setInterval(() => {
          if (yearMax >= maxYear) { stopPlay(); return; }
          yearMax += 1;
          timeRange.value = String(yearMax);
          paintTimeline();
          refresh();
        }, 900);
      });
    }

    function stopPlay() {
      if (!playTimer) return;
      clearInterval(playTimer);
      playTimer = null;
      const btn = $("time-play");
      if (btn) btn.classList.remove("on");
    }

    // =======================================================================
    // SEARCH
    // =======================================================================
    const searchInput = $("search");
    const searchField = $("search-field");
    let searchDebounce = null;

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        searchField.classList.toggle("has-text", searchInput.value.length > 0);
        // Wait a beat after the last keystroke before redrawing — otherwise
        // every letter rebuilds every marker and the typing feels sticky.
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
          query = searchInput.value.trim().toLowerCase();
          if (query) showTab("list");
          refresh();
        }, 160);
      });
      $("search-clear").addEventListener("click", () => {
        searchInput.value = "";
        query = "";
        searchField.classList.remove("has-text");
        searchInput.focus();
        refresh();
      });
    }

    // =======================================================================
    // THE "ALL PINS" LIST
    // =======================================================================
    // The readable spine of the site. Before this existed the only way to read
    // a pin was to spot it on the map and click it — which meant a screen
    // reader, a keyboard, or a search engine got nothing at all.
    const listEl = $("pin-list");
    const listStatus = $("list-status");

    function renderList() {
      if (!listEl) return;
      const shown = pins.filter(isVisible);

      // Same care as the header stat: don't phrase the default state as though
      // something is being filtered out. Say plainly what's hidden instead.
      if (hasUserFilter()) {
        listStatus.textContent = `${shown.length} of ${pins.length} pins`;
      } else if (!districtOn && nDistrict) {
        listStatus.textContent = `${shown.length} wins · ${nDistrict} community events hidden`;
      } else {
        listStatus.textContent = `All ${pins.length} pins`;
      }

      if (!shown.length) {
        listEl.innerHTML =
          '<p class="list-empty">Nothing matches those filters.<br>Try clearing the search or the year.</p>';
        return;
      }

      // Biggest first: funded wins by amount, then laws, then presence — the
      // same hierarchy the pin sizes express on the map.
      const rank = { funding: 0, law: 1, presence: 2 };
      const sorted = shown.slice().sort((a, b) => {
        const r = (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3);
        if (r) return r;
        if ((b.amount || 0) !== (a.amount || 0)) return (b.amount || 0) - (a.amount || 0);
        return yearOf(b) - yearOf(a);
      });

      const frag = document.createDocumentFragment();
      sorted.forEach((item) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "pin-row";
        row.dataset.slug = item._slug;
        row.innerHTML =
          `<span class="pin-row-dot" style="background:${colors[item.category] || "#555"}">${catSvg(item.category)}</span>` +
          `<span class="pin-row-main">` +
            `<span class="pin-row-title">${escapeHtml(item.title)}</span>` +
            `<span class="pin-row-meta">` +
              `<span>${escapeHtml(item.year)}</span>` +
              (item.city ? `<span>&middot; ${escapeHtml(item.city)}</span>` : "") +
              (item.amount ? `<span class="pin-row-amount">${money(item.amount)}</span>` : "") +
            `</span>` +
          `</span>`;
        row.addEventListener("click", () => selectPin(item, { fromList: true }));
        frag.appendChild(row);
      });
      listEl.replaceChildren(frag);
      markActiveRow();
    }

    let activeSlug = null;
    function markActiveRow() {
      if (!listEl) return;
      listEl.querySelectorAll(".pin-row").forEach((row) => {
        row.classList.toggle("active", row.dataset.slug === activeSlug);
      });
    }

    // =======================================================================
    // THE CITY SCOREBOARD
    // =======================================================================
    const cityEl = $("city-list");

    function renderCities() {
      if (!cityEl) return;
      const tally = new Map();
      pins.forEach((item) => {
        if (!item.city) return;
        const row = tally.get(item.city) || { city: item.city, n: 0, dollars: 0 };
        row.n += 1;
        row.dollars += item.amount || 0;
        tally.set(item.city, row);
      });
      const rows = [...tally.values()].sort(
        (a, b) => b.dollars - a.dollars || b.n - a.n || a.city.localeCompare(b.city)
      );
      const most = Math.max(1, ...rows.map((r) => r.n));

      const frag = document.createDocumentFragment();
      rows.forEach((r) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "city-row" + (cityFilter === r.city ? " active" : "");
        btn.setAttribute("aria-pressed", String(cityFilter === r.city));
        btn.innerHTML =
          `<span class="city-name">${escapeHtml(r.city)}</span>` +
          (r.dollars ? `<span class="city-money">${money(r.dollars)}</span>` : "") +
          `<span class="city-count">${r.n}</span>`;
        btn.addEventListener("click", () => toggleCity(r.city));

        const bar = document.createElement("div");
        bar.className = "city-bar";
        bar.innerHTML = `<i style="width:${Math.round((r.n / most) * 100)}%"></i>`;

        frag.appendChild(btn);
        frag.appendChild(bar);
      });
      cityEl.replaceChildren(frag);
    }

    function toggleCity(city) {
      stopTour();
      cityFilter = cityFilter === city ? null : city;
      refresh();
      if (!cityFilter) {
        if (districtBounds) map.flyToBounds(districtBounds, { padding: [20, 20], duration: 0.9 });
        return;
      }
      // Frame just that city's pins. Community events are part of a city's
      // story, so turning a city on turns them on too.
      if (!districtOn) { districtOn = true; paintDistrictToggle(); refresh(); }
      const here = pins.filter((p) => p.city === city);
      if (here.length) {
        const bounds = L.latLngBounds(here.map((p) => [p.lat, p.lon]));
        map.flyToBounds(bounds.pad(0.35), { duration: 1.0, maxZoom: 14.5 });
      }
      collapseSheetOnMobile();
    }

    // =======================================================================
    // SELECTING A PIN — from the list, a deep link, the tour, or "near me"
    // =======================================================================
    // If the pin someone asked for is currently filtered out, we clear whatever
    // is hiding it rather than silently doing nothing. Being asked for a thing
    // and showing nothing is the worst possible answer.
    function ensureVisible(item) {
      if (isVisible(item)) return;
      if (dollarMode && !item.amount) {
        dollarMode = false;
        const sw = $("dollar-mode");
        if (sw) sw.checked = false;
      }
      if (yearOf(item) > yearMax) {
        yearMax = maxYear;
        if (timeRange) timeRange.value = String(maxYear);
        paintTimeline();
      }
      if (cityFilter && item.city !== cityFilter) cityFilter = null;
      if (query && !haystack(item).includes(query)) {
        query = "";
        if (searchInput) searchInput.value = "";
        if (searchField) searchField.classList.remove("has-text");
      }
      categoryOn[key(item)] = true;
      if (bucketOf(item) === DISTRICT && !districtOn) {
        districtOn = true;
        paintDistrictToggle();
      }
      // Repaint the legend rows we may have just switched back on.
      document.querySelectorAll(".legend-row.off").forEach((row) => {
        const label = row.querySelector(".legend-label").textContent;
        if (label === prettyCat(item.category)) {
          row.classList.remove("off");
          row.setAttribute("aria-pressed", "true");
        }
      });
      refresh();
    }

    function selectPin(item, opts = {}) {
      ensureVisible(item);
      activeSlug = item._slug;
      markActiveRow();

      const zoom = Math.max(map.getZoom(), 14.5);
      const seconds = opts.duration || 0.9;

      // Open the popup once the flight lands. Two triggers, one guard: if the
      // map was already sitting on this pin, Leaflet may finish instantly and
      // never fire `moveend`, so a timer covers that case — and the `opened`
      // flag makes sure the popup can't be opened twice.
      let opened = false;
      const land = () => {
        if (opened) return;
        opened = true;
        item._marker.openPopup();
        pulse(item);
      };

      if (REDUCED_MOTION) {
        map.setView([item.lat, item.lon], zoom);
        land();
      } else {
        map.flyTo([item.lat, item.lon], zoom, { duration: seconds });
        map.once("moveend", land);
        setTimeout(land, seconds * 1000 + 250);
      }
      if (opts.fromList) collapseSheetOnMobile();
    }

    // A brief gold ring on the pin we just flew to, so the eye lands on the
    // right one among its neighbours.
    function pulse(item) {
      if (REDUCED_MOTION) return;
      const el = item._marker.getElement();
      const badge = el && el.querySelector(".pin-badge");
      if (!badge) return;
      badge.classList.remove("is-target");
      void badge.offsetWidth; // forces the browser to restart the animation
      badge.classList.add("is-target");
    }

    // =======================================================================
    // DEEP LINKS — #pin=<slug>
    // =======================================================================
    // This is what makes one accomplishment sendable. Paste the link in an
    // email and it opens on that pin, popup already open.
    // replaceState rather than a plain `location.hash =` so that clicking
    // through twenty pins doesn't leave twenty entries in the back button.
    let suppressHashHandler = false;
    function setHash(slug) {
      suppressHashHandler = true;
      const base = location.pathname + location.search;
      history.replaceState(null, "", slug ? base + "#pin=" + slug : base);
      // Give the hashchange event a tick to fire and be ignored.
      setTimeout(() => { suppressHashHandler = false; }, 0);
    }

    function openFromHash() {
      if (suppressHashHandler) return;
      const m = location.hash.match(/^#pin=(.+)$/);
      if (!m) return;
      const item = bySlug.get(decodeURIComponent(m[1]));
      if (item) selectPin(item);
    }

    window.addEventListener("hashchange", openFromHash);

    // The copy-link button lives inside popup HTML, which Leaflet rebuilds on
    // every open — so we listen once on the map container and check what was
    // clicked, instead of trying to attach a handler to a button that keeps
    // being replaced.
    map.getContainer().addEventListener("click", (e) => {
      const btn = e.target.closest(".pop-share");
      if (!btn) return;
      const url = location.origin + location.pathname + "#pin=" + btn.dataset.slug;
      const done = () => {
        const was = btn.innerHTML;
        btn.innerHTML = "Link copied";
        setTimeout(() => { btn.innerHTML = was; }, 1600);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done);
      else done();
    });

    // =======================================================================
    // "WHAT HAS HE DONE NEAR ME?"
    // =======================================================================
    // Two questions, answered locally wherever possible:
    //   1. Are you inside District 13?  — checked in the browser against the
    //      boundary we already loaded, so it needs no server and no API key.
    //   2. What's nearest to you?       — straight-line distance to every pin.
    // Turning an address into coordinates does need a lookup; that goes to
    // Nominatim, the same free OpenStreetMap service the build pipeline uses.
    const nearResult = $("near-result");
    let meMarker = null;

    function showNear(lat, lon, label) {
      const inside = districtRing ? pointInRing(lat, lon, districtRing) : null;

      if (meMarker) map.removeLayer(meMarker);
      meMarker = L.marker([lat, lon], {
        icon: L.divIcon({ className: "pin-marker", html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 1200,
        title: label || "You are here",
      }).addTo(map);

      const nearest = pins
        .map((p) => ({ item: p, miles: milesBetween(lat, lon, p.lat, p.lon) }))
        .sort((a, b) => a.miles - b.miles)
        .slice(0, 5);

      const verdict = inside
        ? `<div class="near-verdict inside">You're inside Senate District 13 — Senator Becker is your state senator.</div>`
        : `<div class="near-verdict outside">That spot is outside Senate District 13, so he isn't your state senator. Here's what's nearest to you anyway.</div>`;

      nearResult.innerHTML = verdict + '<div id="near-list"></div>';

      const listBox = $("near-list");
      nearest.forEach(({ item, miles }) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "pin-row";
        row.innerHTML =
          `<span class="pin-row-dot" style="background:${colors[item.category] || "#555"}">${catSvg(item.category)}</span>` +
          `<span class="pin-row-main">` +
            `<span class="pin-row-title">${escapeHtml(item.title)}</span>` +
            `<span class="pin-row-meta"><span>${escapeHtml(item.city || "")}</span>` +
            `<span class="near-dist">${miles < 0.2 ? "next door" : miles.toFixed(1) + " mi"}</span></span>` +
          `</span>`;
        row.addEventListener("click", () => selectPin(item, { fromList: true }));
        listBox.appendChild(row);
      });

      map.flyTo([lat, lon], 13.5, { duration: 1.1 });
      collapseSheetOnMobile();
    }

    function nearError(message) {
      nearResult.innerHTML = `<div class="near-verdict error">${escapeHtml(message)}</div>`;
    }

    if ($("near-go")) {
      const lookUp = () => {
        const q = $("near-input").value.trim();
        if (!q) return;
        nearResult.innerHTML = '<div class="near-verdict outside">Looking that up&hellip;</div>';
        // viewbox nudges the search toward the Peninsula so "Main Street"
        // doesn't land in another state.
        const url =
          "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us" +
          "&viewbox=-122.65,37.85,-121.90,37.10&q=" + encodeURIComponent(q);
        fetch(url, { headers: { Accept: "application/json" } })
          .then((r) => r.json())
          .then((hits) => {
            if (!hits.length) { nearError("Couldn't find that address. Try adding the city."); return; }
            showNear(parseFloat(hits[0].lat), parseFloat(hits[0].lon), q);
          })
          .catch(() => nearError("The address lookup didn't respond. Check your connection and try again."));
      };
      $("near-go").addEventListener("click", lookUp);
      $("near-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); lookUp(); }
      });
    }

    if ($("near-gps")) {
      $("near-gps").addEventListener("click", () => {
        if (!navigator.geolocation) { nearError("This browser can't share a location."); return; }
        nearResult.innerHTML = '<div class="near-verdict outside">Asking your browser for your location&hellip;</div>';
        navigator.geolocation.getCurrentPosition(
          (pos) => showNear(pos.coords.latitude, pos.coords.longitude, "You are here"),
          () => nearError("Location permission was declined. You can type an address instead."),
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        );
      });
    }

    // =======================================================================
    // THE GUIDED TOUR
    // =======================================================================
    // A hands-off pass through the biggest wins. Good for someone who won't
    // explore on their own, and good on a screen in an office.
    const tourStops = pins
      .filter((p) => p.kind === "funding" || p.kind === "law")
      .sort((a, b) => (b.amount || 0) - (a.amount || 0) || yearOf(b) - yearOf(a))
      .slice(0, 8);

    let tourIndex = -1;
    let tourTimer = null;
    const tourBar = $("tour-bar");

    function startTour() {
      if (!tourStops.length) return;
      // A tour is a "show me the highlights" request, so it starts from a clean
      // slate rather than fighting whatever filters happen to be set.
      stopPlay();
      query = ""; cityFilter = null; yearMax = maxYear; dollarMode = false;
      if (searchInput) { searchInput.value = ""; searchField.classList.remove("has-text"); }
      if ($("dollar-mode")) $("dollar-mode").checked = false;
      if (timeRange) timeRange.value = String(maxYear);
      Object.keys(categoryOn).forEach((k) => { categoryOn[k] = true; });
      document.querySelectorAll(".legend-row.off").forEach((r) => {
        r.classList.remove("off");
        r.setAttribute("aria-pressed", "true");
      });
      paintTimeline();
      refresh();

      tourBar.hidden = false;
      tourIndex = -1;
      tourNext();
    }

    function tourGo(i) {
      tourIndex = (i + tourStops.length) % tourStops.length;
      const item = tourStops[tourIndex];
      $("tour-step").innerHTML =
        `<b>${tourIndex + 1}</b> of ${tourStops.length} &middot; ${escapeHtml(item.city || "District 13")}`;
      selectPin(item, { duration: 1.4 });

      clearTimeout(tourTimer);
      // Long enough to actually read the popup before it moves on.
      tourTimer = setTimeout(tourNext, 6500);
    }

    function tourNext() {
      if (tourIndex >= tourStops.length - 1) { stopTour(); return; }
      tourGo(tourIndex + 1);
    }

    function stopTour() {
      clearTimeout(tourTimer);
      tourTimer = null;
      tourIndex = -1;
      if (tourBar) tourBar.hidden = true;
      map.closePopup();
    }

    if (tourBar) {
      $("tour-next").addEventListener("click", () => tourGo(tourIndex + 1));
      $("tour-prev").addEventListener("click", () => tourGo(tourIndex - 1));
      $("tour-stop").addEventListener("click", stopTour);
    }

    // =======================================================================
    // TABS
    // =======================================================================
    const TABS = ["explore", "list", "cities"];
    function showTab(name) {
      TABS.forEach((t) => {
        const btn = $("tabbtn-" + t);
        const pane = $("tab-" + t);
        const on = t === name;
        btn.setAttribute("aria-selected", String(on));
        pane.hidden = !on;
      });
    }
    TABS.forEach((t) => {
      $("tabbtn-" + t).addEventListener("click", () => { showTab(t); openSheetOnMobile(); });
    });

    // The skip link at the top of the page jumps to the readable list, so it
    // has to switch to that tab first — otherwise it lands on a hidden panel.
    const skip = document.querySelector(".skip-link");
    if (skip) {
      skip.addEventListener("click", () => {
        showTab("list");
        openSheetOnMobile(true);
      });
    }

    // =======================================================================
    // THE MOBILE BOTTOM SHEET
    // =======================================================================
    // On a phone the map goes full-screen and this panel becomes a sheet you
    // drag up over it, with three resting positions: peek, half, open. The
    // position is a CSS transform that JS sets in pixels; releasing the drag
    // snaps to whichever position is closest.
    const panel = $("panel");
    const grip = $("panel-grip");
    const isMobile = () => window.matchMedia("(max-width: 860px)").matches;

    const PEEK = 132; // must match --peek in the stylesheet
    function snapPoints() {
      const h = panel.offsetHeight;
      return { open: 0, half: Math.round(h * 0.45), closed: Math.max(0, h - PEEK) };
    }
    function setSheet(y, animate) {
      panel.classList.toggle("snapping", Boolean(animate));
      panel.style.setProperty("--sheet-y", y + "px");
    }
    function snapTo(where, animate = true) {
      if (!isMobile()) return;
      setSheet(snapPoints()[where], animate);
      panel.dataset.snap = where;
    }
    function collapseSheetOnMobile() { if (isMobile()) snapTo("closed"); }
    function openSheetOnMobile(full) {
      if (!isMobile()) return;
      if (panel.dataset.snap !== "open") snapTo(full ? "open" : "half");
    }

    if (grip) {
      let dragging = false, startY = 0, startOffset = 0, moved = 0;

      const onDown = (e) => {
        if (!isMobile()) return;
        dragging = true; moved = 0;
        startY = e.clientY;
        startOffset = parseFloat(getComputedStyle(panel).getPropertyValue("--sheet-y")) || snapPoints().closed;
        panel.classList.remove("snapping");
        grip.setPointerCapture(e.pointerId);
      };
      const onMove = (e) => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        moved = Math.max(moved, Math.abs(dy));
        const pts = snapPoints();
        setSheet(Math.min(pts.closed, Math.max(0, startOffset + dy)), false);
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        const pts = snapPoints();
        // A tap (no real movement) toggles rather than snapping in place.
        if (moved < 6) {
          snapTo(panel.dataset.snap === "closed" ? "half" : "closed");
          return;
        }
        const y = parseFloat(getComputedStyle(panel).getPropertyValue("--sheet-y")) || 0;
        const nearest = Object.entries(pts).sort(
          (a, b) => Math.abs(a[1] - y) - Math.abs(b[1] - y)
        )[0][0];
        snapTo(nearest);
      };

      grip.addEventListener("pointerdown", onDown);
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
      grip.addEventListener("pointercancel", onUp);
      grip.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          snapTo(panel.dataset.snap === "closed" ? "half" : "closed");
        }
      });

      // Typing in the search box should lift the sheet so you can see results.
      if (searchInput) searchInput.addEventListener("focus", () => openSheetOnMobile());

      // Start closed on a phone, and re-snap after a rotation (the sheet's
      // pixel positions all depend on its height, which rotation changes).
      const syncSheet = () => {
        if (isMobile()) snapTo(panel.dataset.snap || "closed", false);
        else panel.style.removeProperty("--sheet-y");
      };
      syncSheet();
      window.addEventListener("resize", syncSheet);
      window.addEventListener("orientationchange", () => setTimeout(syncSheet, 250));
    }

    // Leaflet needs telling when its container changes size, or the tiles come
    // out misaligned after a rotation.
    window.addEventListener("resize", () => map.invalidateSize());

    // =======================================================================
    // GO
    // =======================================================================
    showTab("explore");
    refresh();
    openFromHash();
  })
  .catch((error) => {
    document.getElementById("map").innerHTML =
      '<p style="padding:20px">Could not load the data file. Make sure you are running the local server (see the how-to).</p>';
    console.error(error);
  });
