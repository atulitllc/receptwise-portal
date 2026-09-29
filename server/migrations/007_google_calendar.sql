-- Extra booking columns written when the per-business calendar tool books a time.
-- The appointments page can read these once that page is deployed. Existing rows stay valid.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
