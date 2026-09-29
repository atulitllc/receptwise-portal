-- One generated GitHub repository per business. Regeneration updates this row; it does not create a second repo.
CREATE TABLE IF NOT EXISTS business_websites (
  business_id       BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  repo_full_name    TEXT NOT NULL,
  repo_url          TEXT NOT NULL,
  pages_url         TEXT NOT NULL DEFAULT '',
  template          TEXT NOT NULL,
  last_generated_at TIMESTAMPTZ,
  last_pr_url       TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
