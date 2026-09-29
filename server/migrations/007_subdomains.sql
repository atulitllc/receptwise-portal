-- Per-business customer panel address: https://<subdomain>.receptwise.com
-- panel, www, api, and sphere are reserved and are not stored here.
-- The pilot business ReceptWise uses subdomain receptwise.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS subdomain TEXT;

UPDATE businesses
SET subdomain = 'receptwise'
WHERE (subdomain IS NULL OR subdomain = '')
  AND (slug = 'receptwise' OR lower(name) = 'receptwise');

CREATE UNIQUE INDEX IF NOT EXISTS businesses_subdomain_lower ON businesses (lower(subdomain));
