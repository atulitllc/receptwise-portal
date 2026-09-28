-- Production control panel: receptionist settings, assistant backups, call analysis, OAuth.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS receptionist JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE calls ADD COLUMN IF NOT EXISTS caller_name TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS caller_email TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS caller_business TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_type TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS booking_confirmed BOOLEAN;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS booked_start TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS answered BOOLEAN;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS structured JSONB;

CREATE TABLE IF NOT EXISTS assistant_backups (
  id                BIGSERIAL PRIMARY KEY,
  business_id       BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vapi_assistant_id TEXT,
  config            JSONB NOT NULL,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_backups_business ON assistant_backups (business_id, created_at DESC);

ALTER TABLE integrations ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS handle TEXT;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS profile_url TEXT;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  provider    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
