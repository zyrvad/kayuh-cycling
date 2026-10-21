import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "data"))
from fetch import parse_datamall  # noqa: E402


def test_parse_datamall_rows():
    rows = parse_datamall([
        {"Description": "Blk 123 Bedok North", "Latitude": 1.33, "Longitude": 103.93,
         "RackType": "Yellow Box", "RackCount": 20, "ShelterIndicator": "N"},
        {"Description": "Tampines MRT", "Latitude": "1.3534", "Longitude": "103.9452",
         "RackType": "Racks", "RackCount": "40", "ShelterIndicator": "Y"},
        {"Description": "broken", "Latitude": None, "Longitude": 103.9},
    ])
    assert len(rows) == 2
    assert rows[0]["type"] == "Yellow Box" and not rows[0]["sheltered"] and rows[0]["count"] == 20
    assert rows[1]["sheltered"] and rows[1]["lat"] == 1.3534 and rows[1]["count"] == 40
