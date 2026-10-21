from classify import (CYCLEWAY, F_BWD, F_DISMOUNT, F_FWD, F_SIDEWALK, FOOTPATH, PCN, QUIET_ROAD,
                      ROAD, SHARED, classify, upgrade)


def tier(tags):
    c = classify(tags)
    return None if c is None else c.tier


def test_expressways_and_private_ways_are_excluded():
    assert tier({"highway": "motorway"}) is None
    assert tier({"highway": "motorway_link"}) is None
    assert tier({"highway": "service", "access": "private"}) is None
    assert tier({"highway": "footway", "bicycle": "no"}) is None


def test_private_access_with_bicycle_yes_is_allowed():
    assert tier({"highway": "service", "access": "private", "bicycle": "yes"}) == QUIET_ROAD


def test_park_connector_and_cycleway():
    assert tier({"highway": "footway", "leisure": "park_connector"}) == PCN
    assert tier({"highway": "cycleway"}) == CYCLEWAY
    assert tier({"highway": "primary", "cycleway:left": "track"}) == CYCLEWAY


def test_paths_and_footways():
    assert tier({"highway": "path"}) == SHARED
    assert tier({"highway": "footway", "bicycle": "designated"}) == SHARED
    assert tier({"highway": "footway"}) == FOOTPATH
    assert tier({"highway": "pedestrian"}) == FOOTPATH


def test_steps_need_a_ramp():
    assert tier({"highway": "steps"}) is None
    c = classify({"highway": "steps", "ramp:bicycle": "yes"})
    assert c.tier == FOOTPATH and c.flags & F_DISMOUNT


def test_main_road_with_sidewalk_is_ridden_as_footpath_both_ways():
    c = classify({"highway": "secondary", "sidewalk": "both", "oneway": "yes"})
    assert c.tier == FOOTPATH and c.flags & F_SIDEWALK
    assert c.flags & F_FWD and c.flags & F_BWD


def test_oneway_roads():
    c = classify({"highway": "primary", "oneway": "yes"})
    assert c.tier == ROAD and c.flags & F_FWD and not c.flags & F_BWD
    c = classify({"highway": "residential", "oneway": "-1"})
    assert c.flags & F_BWD and not c.flags & F_FWD
    c = classify({"highway": "residential", "oneway": "yes", "oneway:bicycle": "no"})
    assert c.flags & F_FWD and c.flags & F_BWD


def test_upgrade_promotes_paths_not_roads():
    foot = classify({"highway": "footway"})
    assert upgrade(foot, pcn_match=True, cycle_match=False).tier == PCN
    assert upgrade(foot, pcn_match=False, cycle_match=True).tier == CYCLEWAY
    road = classify({"highway": "primary"})
    assert upgrade(road, pcn_match=True, cycle_match=True).tier == ROAD
    pcn = classify({"highway": "footway", "leisure": "park_connector"})
    assert upgrade(pcn, pcn_match=False, cycle_match=True).tier == PCN
