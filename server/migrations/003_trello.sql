-- One Trello card per call per event, so retries do not open a second card.
CREATE TABLE IF NOT EXISTS trello_cards (
  id             BIGSERIAL PRIMARY KEY,
  business_id    BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_id        BIGINT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  event_kind     TEXT NOT NULL CHECK (event_kind IN ('booking', 'missed_call')),
  trello_card_id TEXT NOT NULL,
  fingerprint    TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, call_id, event_kind)
);
