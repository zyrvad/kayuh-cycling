-- What actually happened on a recorded ride, for the ride detail page:
-- track: the GPS samples (position, time, altitude, speed, path type, leg starts) as compact JSON.
-- stats: a small summary computed by the app (moving time, top speed, best efforts) so lists and PRs stay light.
-- The track is never shared with crews; only the trimmed polyline and the stats are.
ALTER TABLE rides ADD COLUMN track TEXT;
ALTER TABLE rides ADD COLUMN stats TEXT;
