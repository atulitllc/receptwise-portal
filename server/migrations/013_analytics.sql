-- First-party site analytics. One row per event, kept small for the free database.
-- day is the America/New_York calendar date. The exact time is not stored.
-- visitor_hash is a daily sha256 of salt + site + day + IP + user agent. The raw IP is not stored.
-- Rows older than 180 days are deleted by the ingest path.

CREATE TABLE IF NOT EXISTS analytics_events (
  id            BIGSERIAL PRIMARY KEY,
  site_key      TEXT NOT NULL,
  business_id   BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
  event         TEXT NOT NULL CHECK (event IN ('pageview', 'call_click', 'form_submit', 'demo_request', 'browser_call')),
  day           DATE NOT NULL,
  path          TEXT NOT NULL DEFAULT '/',
  referrer_host TEXT NOT NULL DEFAULT '',
  utm_source    TEXT NOT NULL DEFAULT '',
  utm_medium    TEXT NOT NULL DEFAULT '',
  utm_campaign  TEXT NOT NULL DEFAULT '',
  visitor_hash  TEXT NOT NULL DEFAULT '',
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS analytics_events_site_day ON analytics_events (site_key, day);
