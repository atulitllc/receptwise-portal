# ReceptWise server

Node 20 + Express + Postgres. It serves the control panel pages at the repo root and the JSON API under `/api`.

## Run

```bash
npm install
cp .env.example .env   # DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD
node --env-file=.env src/index.js
npm test
```

`npm test` covers the receptionist settings payload (mocked Vapi PATCH), webhook persistence, dashboard metrics, and Trello cards (mocked Trello HTTP). It needs the Postgres URL in `TEST_DATABASE_URL` or `postgres://rw:rwlocal@127.0.0.1:5432/rw_test`.

Migrations in `migrations/` run on boot. The first admin is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` when `users` is empty. Add later teammates with `npm run create-user -- email "Name" team` (it prompts for the password).

Receptwise `admin` and `team` accounts see per-business counts and line health. Call transcripts, recordings, caller names, and booking customer details stay hidden until that business's `owner` turns on support access (`PUT /api/businesses/:slug/support-access`, default 72 hours, at most 168). Each time a Receptwise account then opens those details, the audit log records `support.view` with who, what, and when. `owner` and `staff` accounts belong to one business and see that business's details only.

The process listens on `0.0.0.0:$PORT`.

## API

Session cookie plus `X-RW-Client: portal` on every write. `GET /api/health` does not need a session.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/login`, `/api/auth/logout` | bcrypt, rate limit, httpOnly cookie |
| GET | `/api/me` | current user |
| GET | `/api/health` | database check |
| GET | `/api/export?format=json` or `sql` | admin only. Clients, settings, calls, bookings, activity. No passwords or third-party tokens. Caller and customer details are omitted unless support access is on for that business. |
| GET | `/api/metrics?business=slug` | calls today/7d/30d, answered, missed, duration, bookings. Recent calls and activity hide caller details unless support access is on. |
| GET/PUT | `/api/businesses/:slug/support-access` | owner of that business turns Receptwise detail access on or off. Body `{ "enabled": true, "hours": 72 }`. |
| GET | `/api/appointments?business=slug&from=&to=` | bookings for one business, or every business when `business` is omitted. `from`/`to` are ISO instants. Receptwise staff see `Booked – details hidden` unless support access is on. |
| POST | `/api/appointments` | add a booking in the portal. Does not write to an external calendar. Receptwise staff get 403 while support access is off. |
| PATCH | `/api/appointments/:id` | edit or cancel a booking in the portal. Same support-access rule as create. |
| POST | `/api/calls/sync` | backfill from Vapi for every linked business |
| GET | `/api/businesses/:slug/phone` | live Vapi/Twilio status, or a not-connected state |
| GET/PUT | `/api/businesses/:slug/forwarding` | conditional forwarding or ported ring-first setup |
| POST | `/api/businesses/:slug/forwarding/test` | admin + `confirm: true` calls the business number; otherwise marks a manual test |
| POST | `/api/businesses/:slug/forwarding/port-request` | records a port request only |
| POST | `/webhooks/twilio/voice` | ported-number ring-first TwiML. The receptionist handoff is still a stub |
| GET/PUT | `/api/businesses/:slug/settings` | save and push greeting, hours, booking rules, transfer, FAQ |
| GET/PUT/DELETE | `/api/businesses/:slug/integrations/:provider` | manual handle, or remove it |
| GET | `/api/businesses/:slug/trello` | connection status. The key and token are never included. |
| PUT/DELETE | `/api/businesses/:slug/trello/credentials` | store or remove a pasted key and token (encrypted) |
| POST | `/api/businesses/:slug/trello/test` | `GET /1/members/me` |
| GET | `/api/businesses/:slug/trello/boards` | open boards |
| GET | `/api/businesses/:slug/trello/boards/:boardId/lists` | open lists |
| PUT | `/api/businesses/:slug/trello` | board, list, and per-event card rules |
| GET | `/api/integrations/meta/start?business=slug` | Facebook Login for Business |
| GET | `/api/integrations/meta/callback` | OAuth return. Tokens are encrypted. |
| POST | `/webhooks/vapi` | `X-Vapi-Secret`. Stores end-of-call reports and opens Trello cards when a list is saved. |
| POST | `/api/businesses/:slug/assistant/publish` | full assistant publish (existing path) |
| POST | `/api/businesses/:slug/calls/sync` | backfill one business |
| GET | `/api/businesses/:slug/website/preview?template=` | admin. Rendered Classic or Modern page for the preview frame |
| POST | `/api/businesses/:slug/website/generate` | admin. New public GitHub repo. Body `{ "template": "classic" }` or `"modern"`. `409` with `GITHUB_TOKEN` when the token is missing |
| POST | `/api/businesses/:slug/website/regenerate` | admin. New branch and pull request. Does not overwrite `main` |

Settings pushes `GET` the assistant, store that JSON in `assistant_backups`, then `PATCH` `firstMessage` and `model` with a `<!-- receptwise:managed -->` block replaced in the system prompt. Tool ids already on the assistant are left in place.

A missing `VAPI_API_KEY` saves the settings and returns `pushed: false` with `missing: ["VAPI_API_KEY"]`. It does not invent a successful publish.

Deploy steps and the full env var list are in the [root README](../README.md).
