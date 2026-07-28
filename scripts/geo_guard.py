"""
geo_guard.py  —  is this pin actually inside Senate District 13?

What this does, in plain English:
  Every pin on the map is supposed to land inside Senate District 13 (SD13).
  A recent bug geocoded "South San Francisco" to actual San Francisco and
  dropped a pin ~15km OUTSIDE the district. This script is the guardrail that
  catches that: give it a latitude and longitude, and it tells you whether that
  point falls inside the real SD13 boundary. Callers can use it to reject bad
  pins before they ever reach the map.

  The district boundary is stored as a GeoJSON polygon in site/sd13.geojson
  (GeoJSON is just a JSON file that describes shapes on a map). That polygon is
  a long list of corner points that trace the district's outline.

  How we test "is the point inside?" — a classic trick called RAY-CASTING:
  imagine standing at your point and shooting a straight line off to the east.
  Count how many times that line crosses the edge of the district's outline.
  An ODD number of crossings means you started INSIDE; an EVEN number means you
  started OUTSIDE. That's the whole idea.

Run it with:
  python3 scripts/geo_guard.py                 (runs a built-in self-test)
  python3 scripts/geo_guard.py <lat> <lon>     (checks one point)
"""

import json
import sys
from pathlib import Path

# Find the boundary file relative to THIS script, not the current working
# directory. That way the guardrail works no matter where it's called from
# (from scripts/, from the project root, or imported by another script).
GEOJSON_FILE = Path(__file__).resolve().parent.parent / "site" / "sd13.geojson"

# We parse the GeoJSON once and remember the result here, so calling the check
# a thousand times (once per pin) doesn't re-read the big file a thousand times.
_rings_cache = None


def district_rings():
    """
    Return the district outline as a list of rings.

    Each ring is a list of (lat, lon) tuples — one point per corner of the
    boundary. Most districts are a single ring, but some map shapes come in
    several pieces (a "MultiPolygon"), so we always return a LIST of rings and
    let the caller test against all of them.

    Note the flip: GeoJSON stores points as [longitude, latitude], but the rest
    of the world (and our CSV) says "lat, lon". We convert to (lat, lon) here so
    everything downstream speaks the same language.
    """
    global _rings_cache
    if _rings_cache is not None:
        return _rings_cache

    geo = json.loads(GEOJSON_FILE.read_text())
    geometry = geo["features"][0]["geometry"]
    geo_type = geometry["type"]
    coordinates = geometry["coordinates"]

    rings = []
    if geo_type == "Polygon":
        # coordinates = [ring, maybe more rings (holes)] ; each ring = [[lon, lat], ...]
        for ring in coordinates:
            rings.append([(lat, lon) for lon, lat in ring])
    elif geo_type == "MultiPolygon":
        # coordinates = [polygon, polygon, ...] ; each polygon = [ring, ring, ...]
        for polygon in coordinates:
            for ring in polygon:
                rings.append([(lat, lon) for lon, lat in ring])
    else:
        raise ValueError(f"Unexpected geometry type in sd13.geojson: {geo_type}")

    _rings_cache = rings
    return rings


def _point_in_ring(lat, lon, ring):
    """
    Ray-casting test for ONE ring. Returns True if (lat, lon) is inside it.

    We walk around the ring one edge at a time. For each edge we ask: if I shoot
    a ray straight east from my point, does this edge cross it? We count the
    crossings — odd means inside, even means outside.
    """
    inside = False
    n = len(ring)
    # j trails one step behind i, so (ring[j], ring[i]) is the current edge.
    j = n - 1
    for i in range(n):
        lat_i, lon_i = ring[i]
        lat_j, lon_j = ring[j]

        # Does this edge straddle our point's latitude (one end above, one below)?
        # If so, find where the edge crosses that latitude and check whether that
        # crossing is to the EAST (greater lon) of our point. If it is, our
        # eastward ray hits this edge, so flip the inside/outside flag.
        straddles = (lat_i > lat) != (lat_j > lat)
        if straddles:
            crossing_lon = (lon_j - lon_i) * (lat - lat_i) / (lat_j - lat_i) + lon_i
            if lon < crossing_lon:
                inside = not inside
        j = i
    return inside


def is_in_district(lat, lon):
    """
    True if the point is inside Senate District 13.

    lat and lon are floats. We also accept strings (e.g. straight from the CSV)
    and cast them, so callers don't have to convert first.

    For a MultiPolygon or a shape with several rings, a point counts as "inside"
    if it's inside ANY of the rings.
    """
    lat = float(lat)
    lon = float(lon)
    return any(_point_in_ring(lat, lon, ring) for ring in district_rings())


def check(lat, lon):
    """
    The convenience the callers use. Returns (ok, message):
      ok       — True if the point is inside the district, else False
      message  — a friendly, plain-English explanation to show or log
    """
    if is_in_district(lat, lon):
        return True, "OK — inside Senate District 13"
    return (
        False,
        "OUTSIDE Senate District 13 — this pin would land in the wrong place; "
        "do not add it.",
    )


def _self_test():
    """
    Run when the script is called with no arguments. Checks a few known points
    so we can trust the guardrail is working. Redwood City and Half Moon Bay are
    real SD13 places (should be INSIDE); the central-San-Francisco point is the
    exact spot the geocoding bug produced (should be OUTSIDE).
    """
    cases = [
        ("Redwood City", 37.4863, -122.2325, True),
        ("Central San Francisco (the bug)", 37.7887, -122.4214, False),
        ("Half Moon Bay", 37.4645, -122.4384, True),
    ]

    all_passed = True
    for name, lat, lon, expected_inside in cases:
        actual_inside = is_in_district(lat, lon)
        passed = actual_inside == expected_inside
        all_passed = all_passed and passed
        where = "INSIDE" if actual_inside else "OUTSIDE"
        print(f"  {'PASS' if passed else 'FAIL'}  {name:34s} -> {where}")

    print()
    if all_passed:
        print("All self-tests passed.")
        return 0
    print("Some self-tests FAILED — the guardrail is not trustworthy yet.")
    return 1


def main():
    # No arguments -> run the self-test.
    if len(sys.argv) == 1:
        sys.exit(_self_test())

    # Two arguments -> check that one point.
    if len(sys.argv) == 3:
        lat, lon = sys.argv[1], sys.argv[2]
        ok, message = check(lat, lon)
        print(message)
        sys.exit(0 if ok else 1)

    print("Usage:")
    print("  python3 scripts/geo_guard.py                 (self-test)")
    print("  python3 scripts/geo_guard.py <lat> <lon>     (check one point)")
    sys.exit(2)


if __name__ == "__main__":
    main()
