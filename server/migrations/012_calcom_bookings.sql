-- Cal.com booking uid, so the appointments list can follow bookings made on Cal.com.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS calcom_uid TEXT;
CREATE INDEX IF NOT EXISTS bookings_calcom_uid ON bookings (business_id, calcom_uid);
