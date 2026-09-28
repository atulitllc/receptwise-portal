# ReceptWise server

Node 20 + Express + Postgres backend for the live control panel. It serves the same portal pages as the GitHub Pages demo, with real team sign-in and real data.

## What it does

- **Team login:** bcrypt passwords and an httpOnly `rw_sid` session cookie. Sessions are stored hashed in Postgres. Failed logins are rate-limited, and every write needs the `X-RW-Client` header (CSRF guard).
- **Businesses and setup state:** a `businesses` row (profile JSON) plus one `business_setup` row per checklist step. The ReceptWise pilot is seeded on first boot with Malden, MA and blank owner and number fields.
- **Portal:** `/assets/data.js` is generated per request. It is the static plan catalog plus live businesses, team, calls, and `window.RW_LIVE`. `assets/app.js` switches to API calls when `RW_LIVE` is present, and stays a pure demo on GitHub Pages.
- **Twilio + Vapi:**
  - Publish the receptionist (create or update the Vapi assistant: GPT-4.1, ElevenLabs voice, Deepgram Nova-3, transfer tool, optional Google Calendar tools).
  - Buy a local number (admins only) and import it to Vapi.
  - Place a test call and sync calls.
  - Each of these returns HTTP 409 with the missing env var names until keys are set.
- **Webhooks:** `POST /webhooks/vapi` stores `end-of-call-report` and `status-update` events. It is checked against `VAPI_WEBHOOK_SECRET`, and a missing secret is refused in production. Calendar tool calls in the transcript become rows in `bookings`. "Refresh calls" backfills anything missed while the free instance was asleep.
- **Texting:** off by design (`SMS_ENABLED=false`). Imported numbers get `smsEnabled=false`, and the texting step can't be marked done.

## Run locally

```bash
cd server
npm install
cp .env.example .env   # set DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD
node --env-file=.env src/index.js
# open http://localhost:3000
npm test               # unit tests, no DB or network
```

Migrations run automatically on boot (`migrations/*.sql`). Add teammates with `npm run create-user -- email "Name" team`, which prompts for the password.

## API (all JSON, session cookie, `X-RW-Client: portal`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | /api/auth/login, /api/auth/logout | |
| GET | /api/me · POST /api/me/password | |
| GET/POST | /api/users | admin |
| GET | /api/integrations/status | which keys are present |
| GET/POST | /api/businesses | |
| GET/PUT | /api/businesses/:slug | |
| PUT | /api/businesses/:slug/setup/:step | not `number`/`test` (server-owned) |
| POST | /api/businesses/:slug/assistant/publish | Vapi |
| GET | /api/businesses/:slug/numbers/search?areaCode=781 | Twilio |
| POST | /api/businesses/:slug/numbers/provision | admin, **spends $1.15/mo** |
| POST | /api/businesses/:slug/test-call | `{ "to": "(617) ..." }` |
| POST | /api/businesses/:slug/calls/sync | pulls from Vapi |
| POST | /webhooks/vapi | Vapi server URL |

## Deploy (later, not done yet)

`render.yaml` at the repo root describes one free web service (`rootDir: server`) and one free Postgres. Free Postgres expires after 30 days, so export it with `pg_dump` weekly or upgrade before then.
