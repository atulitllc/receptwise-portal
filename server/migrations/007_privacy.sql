-- Business owners and their staff belong to one business.
-- Receptwise admin and team accounts stay unscoped and see aggregates unless support access is on.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'team', 'owner', 'staff'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS business_id BIGINT REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_business_role;
ALTER TABLE users ADD CONSTRAINT users_business_role CHECK (
  (role IN ('owner', 'staff') AND business_id IS NOT NULL)
  OR role IN ('admin', 'team')
);

-- The business owner turns this on. It expires on its own (the portal defaults to 72 hours).
CREATE TABLE IF NOT EXISTS support_access (
  business_id BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at  TIMESTAMPTZ,
  granted_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
