-- Per-business phone setup. Conditional forwarding keeps the number at the carrier.
-- Ported mode stores ring-first targets. Port requests are records only.

CREATE TABLE IF NOT EXISTS phone_forwarding (
  business_id     BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL DEFAULT 'conditional' CHECK (mode IN ('conditional', 'ported')),
  carrier         TEXT NOT NULL DEFAULT '',
  rings           INTEGER NOT NULL DEFAULT 4 CHECK (rings BETWEEN 1 AND 6),
  business_number TEXT NOT NULL DEFAULT '',
  forward_to      TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'not_set_up' CHECK (status IN ('not_set_up', 'pending_test', 'verified')),
  transfer_number TEXT NOT NULL DEFAULT '',
  hours           JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_hours     TEXT NOT NULL DEFAULT 'ai_immediate' CHECK (after_hours IN ('ai_immediate')),
  ai_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ring_first_numbers (
  id          BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT '',
  e164        TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ring_first_business ON ring_first_numbers (business_id, position);

CREATE TABLE IF NOT EXISTS port_requests (
  id               BIGSERIAL PRIMARY KEY,
  business_id      BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  business_number  TEXT NOT NULL,
  contact_name     TEXT NOT NULL DEFAULT '',
  contact_phone    TEXT NOT NULL DEFAULT '',
  carrier          TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested')),
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
