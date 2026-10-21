-- What Kayuh predicted for the part of the route actually ridden (base model, before any personal
-- pace factor). Comparing it with time_s lets the app learn each rider's real pace.
ALTER TABLE rides ADD COLUMN predicted_s REAL;
