-- Hostname scheme.
-- Public site:  https://<subdomain>.receptwise.com
-- Customer panel: https://<subdomain>-admin.receptwise.com
-- Platform panel stays https://panel.receptwise.com
--
-- Migration: <subdomain>.receptwise.com used to be the customer panel.
-- It is now the public website. Panel bookmarks move to <subdomain>-admin.receptwise.com.
-- Stored subdomain values are the site slug and do not gain an -admin suffix.
-- sphere stays sphere: site sphere.receptwise.com, panel sphere-admin.receptwise.com.
--
-- A subdomain that was saved as the panel host label (ending in -admin) is moved
-- back to the stem when that stem is free and not reserved.

UPDATE businesses AS biz
SET subdomain = regexp_replace(biz.subdomain, '-admin$', '')
WHERE biz.subdomain ~* '-admin$'
  AND regexp_replace(lower(biz.subdomain), '-admin$', '') ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  AND regexp_replace(lower(biz.subdomain), '-admin$', '') NOT IN ('panel', 'www', 'api')
  AND NOT EXISTS (
    SELECT 1 FROM businesses AS other
    WHERE other.id <> biz.id
      AND lower(other.subdomain) = regexp_replace(lower(biz.subdomain), '-admin$', '')
  );
