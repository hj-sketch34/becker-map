// map.js — draws the map from site/accomplishments.json
//
// In plain English: load the data file, drop a colored pin for each located
// accomplishment, fill the popup with its story + source link, build the
// category legend, and list any "statewide" (no-location) items in the sidebar.

// Start centered on the Peninsula (District 13), zoomed to show the whole area.
const map = L.map("map").setView([37.47, -122.20], 11);

// Viscosity is how "sticky" the pan boundary feels. 1.0 = a hard wall: when the
// user drags the map to the edge of the allowed area, it stops dead instead of
// stretching and springing back. We set the allowed area (maxBounds) below once
// the district shape has loaded — this just decides how firm that edge will be.
map.options.maxBoundsViscosity = 1.0;

// Free OpenStreetMap tiles (no API key needed).
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

// --- District spotlight: gray out everything that isn't SD13 ---
// The trick: draw ONE big gray rectangle over the whole world, then punch a
// hole in it shaped exactly like District 13. Inside the hole you see the normal
// map; everything outside is dimmed. (Sunnyvale is OUTSIDE the current lines, so
// it correctly ends up grayed — the boundary below is the official 2025–2030 map.)
//
// The boundary lives in its own "mask" layer that sits ABOVE the map tiles but
// BELOW the accomplishment pins, so pins stay bright and clickable.
map.createPane("maskPane");
map.getPane("maskPane").style.zIndex = 350; // tiles=200, this=350, pins=400

fetch("sd13.geojson")
  .then((response) => response.json())
  .then((geo) => {
    // GeoJSON stores points as [longitude, latitude]; Leaflet wants [lat, lng].
    const district = geo.features[0].geometry.coordinates[0].map(
      ([lng, lat]) => [lat, lng]
    );

    // A ring that wraps the entire globe, with the district as a hole in it.
    const world = [[-90, -360], [-90, 360], [90, 360], [90, -360]];
    L.polygon([world, district], {
      pane: "maskPane",
      stroke: false,
      fillColor: "#3a3a3a",
      fillOpacity: 0.6,
      interactive: false, // clicks pass through to the map underneath
    }).addTo(map);

    // A clean blue line tracing the district edge so it reads as a boundary.
    const outline = L.polygon(district, {
      pane: "maskPane",
      color: "#1565c0",
      weight: 2.5,
      fill: false,
      interactive: false,
    }).addTo(map);

    // Frame the map on the whole district (this is the point of the view now).
    map.fitBounds(outline.getBounds(), { padding: [20, 20] });

    // Keep the user anchored on the district — no wandering off to another
    // continent. maxBounds is the rectangle the map is allowed to show. We take
    // the district's bounding box and pad it by 35% so the district isn't jammed
    // against the window edge, but you still can't pan far away. .pad(0.35) grows
    // that box outward by roughly a third on every side.
    map.setMaxBounds(outline.getBounds().pad(0.35));

    // Stop the user from zooming out past the whole-district view. After
    // fitBounds, map.getZoom() is the zoom level that frames the district, so we
    // set the minimum one step below that (a little breathing room) — zoom out
    // any further and there'd just be empty gray. maxZoom is left alone so people
    // can still zoom all the way in to street level.
    map.setMinZoom(map.getZoom() - 1);

    // Small caption so a first-time visitor knows what the gray means.
    const note = L.control({ position: "bottomleft" });
    note.onAdd = function () {
      const box = L.DomUtil.create("div", "mask-note");
      box.innerHTML =
        '<span class="mask-swatch"></span>Grayed out = outside Senate District 13';
      return box;
    };
    note.addTo(map);
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
      &nbsp;<span class="badge" style="background:${color}">${escapeHtml(item.category)}</span>
    </div>
    <div class="pop-summary">${escapeHtml(item.summary)}</div>
    <a class="pop-source" href="${encodeURI(item.source_url)}" target="_blank" rel="noopener">
      Read the official announcement &rarr;
    </a>`;
}

fetch("accomplishments.json")
  .then((response) => response.json())
  .then((data) => {
    const colors = data.colors || {};
    const usedCategories = new Set();
    const bounds = [];

    // --- pins ---
    data.pins.forEach((item) => {
      const color = colors[item.category] || "#555";
      usedCategories.add(item.category);
      bounds.push([item.lat, item.lon]);

      L.circleMarker([item.lat, item.lon], {
        radius: 9,
        color: "#fff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
      })
        .addTo(map)
        .bindPopup(popupHtml(item, color), { maxWidth: 300 });
    });

    // (The view is framed on the whole district by the boundary loader above,
    // so we no longer zoom to fit just the pins — the district is the point.)

    // --- legend (only categories actually on the map) ---
    const legend = document.getElementById("legend");
    [...usedCategories].sort().forEach((category) => {
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `<span class="dot" style="background:${colors[category] || "#555"}"></span>${category}`;
      legend.appendChild(row);
    });

    // --- statewide list (no-location approved items) ---
    const statewide = document.getElementById("statewide");
    if (!data.statewide.length) {
      statewide.innerHTML = '<div id="statewide-empty">None yet. Bills and statewide wins will appear here as they\'re approved.</div>';
    } else {
      data.statewide.forEach((item) => {
        const el = document.createElement("div");
        el.className = "statewide-item";
        el.innerHTML = `<strong>${escapeHtml(item.title)}</strong> (${item.year})<br>
          <a href="${encodeURI(item.source_url)}" target="_blank" rel="noopener">source &rarr;</a>`;
        statewide.appendChild(el);
      });
    }
  })
  .catch((error) => {
    document.getElementById("map").innerHTML =
      '<p style="padding:20px">Could not load the data file. Make sure you are running the local server (see the how-to).</p>';
    console.error(error);
  });

