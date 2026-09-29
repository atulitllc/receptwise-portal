-- Marketing-site demo requests ("Book a free 20-minute chat").
-- ip_hash is the sha256 of the client IP. The raw address is not stored.

CREATE TABLE IF NOT EXISTS demo_requests (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  business_name  TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  business_type  TEXT NOT NULL DEFAULT '',
  preferred_time TEXT NOT NULL DEFAULT '',
  message        TEXT NOT NULL DEFAULT '',
  plan           TEXT NOT NULL DEFAULT '',
  extra          JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_page    TEXT NOT NULL DEFAULT '',
  user_agent     TEXT NOT NULL DEFAULT '',
  ip_hash        TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_requests_created_at ON demo_requests (created_at DESC);
