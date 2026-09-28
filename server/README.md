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

The process listens on `0.0.0.0:$PORT`.

## API

Session cookie plus `X-RW-Client: portal` on every write. `GET /api/health` does not need a session.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/login`, `/api/auth/logout` | bcrypt, rate limit, httpOnly cookie |
| GET | `/api/me` | current user |
| GET | `/api/health` | database check |
| GET | `/api/export?format=json` or `sql` | admin only. Clients, settings, calls, bookings, activity. No passwords or third-party tokens. |
| GET | `/api/metrics?business=slug` | calls today/7d/30d, answered, missed, duration, bookings, recent calls, activity |
| POST | `/api/calls/sync` | backfill from Vapi for every linked business |
| GET | `/api/businesses/:slug/phone` | live Vapi/Twilio status, or a not-connected state |
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

Settings pushes `GET` the assistant, store that JSON in `assistant_backups`, then `PATCH` `firstMessage` and `model` with a `<!-- receptwise:managed -->` block replaced in the system prompt. Tool ids already on the assistant are left in place.

A missing `VAPI_API_KEY` saves the settings and returns `pushed: false` with `missing: ["VAPI_API_KEY"]`. It does not invent a successful publish.

Deploy steps and the full env var list are in the [root README](../README.md).
