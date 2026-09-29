-- Cloudflare Pages status for the same generated site. GitHub columns stay the source for the repository.
ALTER TABLE business_websites
  ADD COLUMN IF NOT EXISTS cloudflare_project TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cloudflare_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cloudflare_domain TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cloudflare_domain_status TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cloudflare_dns TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cloudflare_error TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cloudflare_status TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cloudflare_deployed_at TIMESTAMPTZ;
