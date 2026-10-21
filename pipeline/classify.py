"""OSM tags -> Kayuh path tier.

Tiers (lower is nicer). The router's cost multipliers live in packages/router, not here:
this module only decides *what* a way is, plus a human-readable reason.
"""
from dataclasses import dataclass

PCN, CYCLEWAY, SHARED, FOOTPATH, QUIET_ROAD, ROAD = range(6)
TIER_NAMES = ["pcn", "cycleway", "shared", "footpath", "quiet_road", "road"]

# Edge flags (bit field, shared with packages/router/src/graph.ts)
F_FWD = 1           # rideable in way direction
F_BWD = 2           # rideable against way direction
F_LIT = 4
F_SHELTER = 8
F_UNPAVED = 16
F_DISMOUNT = 32     # bicycle=dismount / ramp beside steps: walk the bike
F_BRIDGE = 64
F_SIDEWALK = 128    # riding on a road's tagged sidewalk

EXCLUDED_HIGHWAYS = {
    "motorway", "motorway_link",  # expressways: bicycles banned in SG
    "construction", "proposed", "abandoned", "disused", "raceway", "bus_guideway",
    "platform", "elevator", "corridor", "via_ferrata", "rest_area", "services", "escape",
    "bus_stop", "busway",
}
QUIET = {"residential", "service", "living_street", "unclassified", "road", "track"}
MAJOR = {"tertiary", "secondary", "primary", "trunk",
         "tertiary_link", "secondary_link", "primary_link", "trunk_link"}
PEDESTRIAN = {"footway", "pedestrian", "path", "bridleway"}
UNPAVED = {"unpaved", "gravel", "fine_gravel", "dirt", "ground", "grass", "sand", "earth",
           "mud", "compacted", "pebblestone", "woodchips"}
YES = {"yes", "designated", "permissive", "official"}


@dataclass
class Classified:
    tier: int
    reason: str
    flags: int


def _oneway_flags(tags) -> int:
    """Direction flags for road tiers. Paths are always two-way for bikes."""
    if tags.get("oneway:bicycle") == "no" or tags.get("cycleway") in ("opposite", "opposite_lane", "opposite_track"):
        return F_FWD | F_BWD
    oneway = tags.get("oneway")
    if oneway in ("yes", "1", "true") or (tags.get("junction") == "roundabout" and oneway != "no"):
        return F_FWD
    if oneway == "-1":
        return F_BWD
    return F_FWD | F_BWD


def _common_flags(tags) -> int:
    f = 0
    if tags.get("lit") in ("yes", "24/7", "automatic"):
        f |= F_LIT
    if tags.get("covered") == "yes" or tags.get("tunnel") in ("building_passage", "covered"):
        f |= F_SHELTER
    if tags.get("surface") in UNPAVED or tags.get("highway") == "track":
        f |= F_UNPAVED
    if tags.get("bridge") not in (None, "no"):
        f |= F_BRIDGE
    return f


def classify(tags) -> "Classified | None":
    """Return the tier for a way, or None when bikes can't use it at all."""
    hw = tags.get("highway")
    if hw is None or hw in EXCLUDED_HIGHWAYS or tags.get("area") == "yes":
        return None
    bicycle = tags.get("bicycle")
    access = tags.get("access")
    if bicycle in ("no", "use_sidepath"):
        return None
    if access in ("no", "private") and bicycle not in YES:
        return None

    flags = _common_flags(tags)
    two_way = F_FWD | F_BWD

    if hw == "steps":
        if tags.get("ramp:bicycle") == "yes" or tags.get("ramp") == "yes":
            return Classified(FOOTPATH, "steps with bike ramp", flags | two_way | F_DISMOUNT)
        return None
    if bicycle == "dismount":
        return Classified(FOOTPATH, "bicycle=dismount", flags | two_way | F_DISMOUNT)

    if tags.get("leisure") == "park_connector":
        return Classified(PCN, "leisure=park_connector", flags | two_way)
    if hw == "cycleway":
        return Classified(CYCLEWAY, "highway=cycleway", flags | two_way)

    if hw in PEDESTRIAN:
        if bicycle == "designated":
            return Classified(SHARED, f"{hw} with bicycle=designated", flags | two_way)
        if hw == "path":
            return Classified(SHARED, "highway=path", flags | two_way)
        return Classified(FOOTPATH, f"highway={hw}", flags | two_way)

    if hw in QUIET:
        return Classified(QUIET_ROAD, f"highway={hw}", flags | _oneway_flags(tags))

    if hw in MAJOR:
        track_tags = (tags.get("cycleway"), tags.get("cycleway:both"),
                      tags.get("cycleway:left"), tags.get("cycleway:right"))
        if "track" in track_tags:
            return Classified(CYCLEWAY, f"{hw} with cycle track", flags | two_way)
        sidewalk = tags.get("sidewalk") or tags.get("sidewalk:both")
        if sidewalk in ("both", "left", "right", "yes") or tags.get("sidewalk:left") == "yes" \
                or tags.get("sidewalk:right") == "yes":
            # Riding on the pavement is legal in SG (10 km/h), and both directions are allowed.
            return Classified(FOOTPATH, f"sidewalk along {hw}", flags | two_way | F_SIDEWALK)
        return Classified(ROAD, f"highway={hw}", flags | _oneway_flags(tags))

    return None


def upgrade(c: Classified, pcn_match: bool, cycle_match: bool) -> Classified:
    """Promote a path that lies on top of official government geometry.

    Roads are never promoted: a PCN drawn beside a road matches the pavement, not the carriageway.
    """
    if c.tier in (QUIET_ROAD, ROAD) or c.flags & F_SIDEWALK:
        return c
    if pcn_match and c.tier > PCN:
        return Classified(PCN, f"{c.reason}; matches NParks/URA park connector", c.flags)
    if cycle_match and c.tier > CYCLEWAY:
        return Classified(CYCLEWAY, f"{c.reason}; matches LTA/URA cycling path", c.flags)
    return c
