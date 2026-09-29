-- Per-business customer panel address: https://<subdomain>.receptwise.com
-- panel, www, and api are reserved and are not stored here.
-- The pilot business ReceptWise uses subdomain receptwise.
-- SPHERE, when that business already exists, uses subdomain sphere.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS subdomain TEXT;

UPDATE businesses
SET subdomain = 'receptwise'
WHERE (subdomain IS NULL OR subdomain = '')
  AND (slug = 'receptwise' OR lower(btrim(name)) = 'receptwise');

UPDATE businesses
SET subdomain = 'sphere'
WHERE (subdomain IS NULL OR subdomain = '')
  AND (slug = 'sphere' OR lower(btrim(name)) = 'sphere');

CREATE UNIQUE INDEX IF NOT EXISTS businesses_subdomain_lower ON businesses (lower(subdomain));
