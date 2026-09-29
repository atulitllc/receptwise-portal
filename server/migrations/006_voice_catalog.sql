-- Mockup voice names are not Vapi voices. Store the Nora catalog key instead.
-- Idempotent: a second run matches no rows.

UPDATE businesses
SET profile = jsonb_set(profile, '{voice}', '"nora"', true)
WHERE lower(profile->>'voice') IN (
  'juniper (warm)', 'harbor (clear)', 'north (calm)', 'sol (bright)',
  'juniper', 'harbor', 'north', 'sol'
);

UPDATE businesses
SET profile = jsonb_set(profile, '{wizard,voice}', '"nora"', true)
WHERE profile ? 'wizard'
  AND jsonb_typeof(profile->'wizard') = 'object'
  AND lower(profile->'wizard'->>'voice') IN (
    'juniper (warm)', 'harbor (clear)', 'north (calm)', 'sol (bright)',
    'juniper', 'harbor', 'north', 'sol'
  );
