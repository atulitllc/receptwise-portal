-- ReceptWise control panel schema v1

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'team' CHECK (role IN ('admin', 'team')),
  password_hash TEXT NOT NULL,
  disabled      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));

-- Session tokens are stored hashed (sha256); the raw token only lives in the cookie.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS businesses (
  id               BIGSERIAL PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT '',
  city             TEXT NOT NULL DEFAULT '',
  timezone         TEXT NOT NULL DEFAULT 'America/New_York',
  status           TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'live', 'paused', 'archived')),
  pilot            BOOLEAN NOT NULL DEFAULT FALSE,
  -- Everything the portal UI renders (owner, hours, greeting, services, FAQs, plan, ...).
  profile          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per setup checklist item (number, test, forwarding, calendar, texting, email, reviews, gbp, social, website, billing).
CREATE TABLE IF NOT EXISTS business_setup (
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  step_key    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'action', 'connected')),
  detail      TEXT NOT NULL DEFAULT '',
  owner       TEXT NOT NULL DEFAULT 'Team',
  is_next     BOOLEAN NOT NULL DEFAULT FALSE,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, step_key)
);

CREATE TABLE IF NOT EXISTS phone_numbers (
  id                   BIGSERIAL PRIMARY KEY,
  business_id          BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  e164                 TEXT NOT NULL UNIQUE,
  provider             TEXT NOT NULL DEFAULT 'twilio',
  twilio_sid           TEXT,
  vapi_phone_number_id TEXT,
  sms_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  status               TEXT NOT NULL DEFAULT 'active',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assistants (
  business_id       BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  vapi_assistant_id TEXT,
  config            JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calls (
  id             BIGSERIAL PRIMARY KEY,
  business_id    BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  vapi_call_id   TEXT NOT NULL UNIQUE,
  direction      TEXT NOT NULL DEFAULT 'inbound',
  from_number    TEXT,
  to_number      TEXT,
  status         TEXT,
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  duration_sec   INTEGER,
  cost_usd       NUMERIC(10, 4),
  ended_reason   TEXT,
  outcome        TEXT,
  summary        TEXT,
  transcript     TEXT,
  messages       JSONB NOT NULL DEFAULT '[]'::jsonb,
  recording_url  TEXT,
  raw            JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calls_business_started ON calls (business_id, started_at DESC);

CREATE TABLE IF NOT EXISTS bookings (
  id              BIGSERIAL PRIMARY KEY,
  business_id     BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_id         BIGINT REFERENCES calls(id) ON DELETE SET NULL,
  starts_at       TIMESTAMPTZ,
  customer        TEXT,
  service         TEXT,
  source          TEXT NOT NULL DEFAULT 'Phone',
  status          TEXT NOT NULL DEFAULT 'Confirmed',
  google_event_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OAuth tokens (Google, Meta) - encrypted with TOKEN_ENCRYPTION_KEY before insert. Later phase.
CREATE TABLE IF NOT EXISTS integrations (
  id             BIGSERIAL PRIMARY KEY,
  business_id    BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  account_label  TEXT,
  token_enc      TEXT,
  scopes         TEXT,
  status         TEXT NOT NULL DEFAULT 'connected',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, provider)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
