-- Routes shared with a crew ("here's a nice route"), separate from planned group rides.
-- Deleting the route or leaving the crew removes the share.
CREATE TABLE crew_routes (
  crew_id   TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  route_id  TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  shared_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note      TEXT,
  shared_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (crew_id, route_id)
);
CREATE INDEX crew_routes_route ON crew_routes (route_id);
