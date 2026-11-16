-- Training data: physiology settings (used for heart-rate zones, effort and power metrics) and a
-- perceived-effort rating per ride. All optional; only the owner ever sees any of it.
ALTER TABLE users ADD COLUMN birth_year INTEGER;
ALTER TABLE users ADD COLUMN max_hr INTEGER;
ALTER TABLE users ADD COLUMN rest_hr INTEGER;
ALTER TABLE users ADD COLUMN ftp_w INTEGER;
ALTER TABLE users ADD COLUMN weight_kg REAL;

-- Rating of perceived exertion, 1-10.
ALTER TABLE rides ADD COLUMN rpe INTEGER;
