-- SPHERE keeps the customer panel https://sphere.receptwise.com.
-- Applied again for databases that already ran 007 before this address was pinned.
-- Does not overwrite a subdomain an admin has already set.

UPDATE businesses
SET subdomain = 'sphere'
WHERE (subdomain IS NULL OR subdomain = '')
  AND (slug = 'sphere' OR lower(btrim(name)) = 'sphere');
