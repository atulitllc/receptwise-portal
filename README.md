# ReceptWise control panel

Internal admin portal for an AI receptionist and marketing service. The repo root is still a clickable static demo (sample data, any password). The same pages run against Postgres when the Node server in [`server/`](server/README.md) serves them.

**Static demo:** https://atulitllc.github.io/receptwise-portal/

Sign-in on the static demo accepts any email and password. Sample data includes ReceptWise as pilot client 1, plus six fictional local businesses.

## Pages

| Page | File | What it shows |
| --- | --- | --- |
| Sign in | `index.html` | Team sign-in |
| Overview | `dashboard.html` | Calls, bookings, businesses, activity |
| Phone | `phone.html` | Number attached to the receptionist |
| Receptionist | `settings.html` | Greeting, hours, booking rules, FAQ |
| Integrations | `integrations.html` | Instagram, Facebook, Google, and later networks |
| Businesses | `clients.html` | Filter by type, size tier, and status |
| Add business | `add.html` | New business wizard |
| Business | `client.html?id=receptwise` | Setup checklist and the older tabs |
| Billing and plans | `billing.html` | Solo / Small / Growing tiers |
| Team and settings | `team.html` | Teammates and the legal entity |

On the live server, `assets/data.js` is generated per request. When `window.RW_LIVE` is present, the pages call the API. On GitHub Pages nothing calls a server.

The company that owns the product is **[Placeholder]** in the footer and on the team page.

## What works once keys are set

| With these env vars | What the panel does |
| --- | --- |
| `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Sign-in, businesses, settings saved in Postgres, empty metrics |
| `VAPI_API_KEY` | Phone page reads live numbers. Saving receptionist settings backs up the assistant, then PATCHes `firstMessage` and the managed section of the system prompt. Sync from Vapi backfills calls. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Phone page adds Twilio status for each number. Admins can still buy a number from the business page. |
| `VAPI_WEBHOOK_SECRET` plus the Vapi server URL | End-of-call reports are stored (summary, caller, outcome, recording, bookings from `structuredData`). |
| `META_APP_ID`, `META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY`, and a public `APP_BASE_URL` | Facebook Login for Business stores the Page and Instagram tokens encrypted. The page shows the account name. |
| `TRELLO_API_KEY`, `TRELLO_TOKEN`, or a key pasted on Integrations, plus `TOKEN_ENCRYPTION_KEY` for a pasted key | Test connection, choose a board and list, and open a card for each new booking and missed call. A booking card is updated when the booking changes. |
| `GITHUB_TOKEN` (and optional `GITHUB_ORG` or `GITHUB_OWNER`, default `atulitllc`) | On the Website tab, an admin generates a public one-page site in a new GitHub repository. The account can be a user or an organization. Regenerate opens a pull request. The panel does not host the site. |

Without those keys the panel stays honest: phone says **Not connected**, settings save locally and are not pushed, integrations say **Needs Meta app setup**, and Trello says **Not connected**. Without `GITHUB_TOKEN`, the Website tab says **Needs GITHUB_TOKEN on Render** and does not create a repository. Recording a handle does not mark the account connected. A pasted Trello key is stored encrypted and is not sent back to the browser. LinkedIn, X, TikTok, and YouTube stay **Coming soon**. Texting stays off (`SMS_ENABLED=false`).

## What still needs setup

- **Meta app.** Create a Meta app, add Facebook Login for Business, and set the redirect URI to `https://<your-host>/api/integrations/meta/callback`. Then set `META_APP_ID`, `META_APP_SECRET`, and `TOKEN_ENCRYPTION_KEY`. Optional: `META_LOGIN_CONFIG_ID` if the login uses a saved configuration instead of the default scopes. Google Business Profile has no OAuth flow yet; you can only record the listing URL.
- **Vapi server URL.** In the Vapi assistant, set the server URL to `https://<your-host>/webhooks/vapi` and send header `X-Vapi-Secret` with the same value as `VAPI_WEBHOOK_SECRET`. The free web service sleeps, so use **Sync from Vapi** after it wakes up.
- **Calendar tools.** The pilot assistant already has `check_availability` and `book_demo`. `VAPI_CALENDAR_TOOL_IDS` is that pair. A later client needs its own tools; the settings push keeps whatever tool ids are already on that assistant.
- **Voice.** The live assistant already uses ElevenLabs. `VAPI_VOICE_ID` is only required when publishing a brand-new assistant from the business page.
- **Trello.** Create a Power-Up API key and token (steps below), paste them on Integrations, or set `TRELLO_API_KEY` and `TRELLO_TOKEN`. Choose a board and a list. Cards are not created until that list is saved. Set `APP_BASE_URL` so each card links back to the call.

Pilot client 1 is seeded as ReceptWise (Malden, MA) and linked to assistant `c3c8899c-e42d-494b-bf47-3af37f942341` and number `+1 781-705-7179` (`60a44606-c827-4f01-b381-852e247a8003`). Override those with `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, and `PILOT_PHONE_E164` if they change.

## Deploy on Render

`render.yaml` is a Blueprint for the pilot: one **free** web service and one **free** Postgres database. The service serves the API and these HTML pages. It listens on `0.0.0.0:$PORT`.

1. Push this repo and in the Render dashboard choose **New → Blueprint**.
2. Apply `render.yaml`. Render generates `VAPI_WEBHOOK_SECRET` and `TOKEN_ENCRYPTION_KEY`.
3. Fill every `sync: false` secret (at least `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first boot, or there is no user to sign in with).
4. Open the service URL, sign in, and confirm `/api/health` returns `{"ok":true}`.
5. Point Vapi’s server URL at `https://<service>/webhooks/vapi` with header `X-Vapi-Secret`.

The free web service sleeps after about 15 minutes without traffic. Webhooks that arrive while it is asleep are recovered with **Sync from Vapi** after it wakes. Free Postgres expires 30 days after creation (then a grace period, then deletion) and has no backups.

### Upgrade for production

Stay on the free tier for the pilot. When the panel should stay awake and the database should outlive 30 days, change the plans in `render.yaml` (or in the Render dashboard) and apply the Blueprint again:

- Web service `plan`: `free` → `starter` (stays awake)
- Database `plan`: `free` → `basic` (does not expire after 30 days)

Download an export or a `pg_dump` before changing databases so the new instance can be restored.

### Export and backup

An admin can download the working data from **Team and settings → Export data** (JSON) or **Export SQL**. The file includes clients, receptionist settings, calls, bookings, and activity. It leaves out passwords, session tokens, and third-party tokens (Meta, Trello). `GET /api/export?format=json` and `GET /api/export?format=sql` are admin-only.

That download is the copy to grab before the free database expires. A full backup, including password hashes and encrypted tokens, is `pg_dump` from your machine using the external database URL on the Render Postgres page.

```bash
# Custom format. --no-owner avoids restore errors when the local role differs.
pg_dump "$DATABASE_URL" --no-owner --no-acl -F c -f receptwise.dump

# Plain SQL, if you would rather read or edit the file.
pg_dump "$DATABASE_URL" --no-owner --no-acl -f receptwise.sql
```

Restore into a new database after the schema exists. Boot the app once against the empty database so migrations run, then load the dump.

```bash
# Custom format into the new database URL.
pg_restore --no-owner --no-acl --clean --if-exists -d "$NEW_DATABASE_URL" receptwise.dump

# Plain SQL.
psql "$NEW_DATABASE_URL" -f receptwise.sql
```

To load an in-app SQL export instead, boot once so the tables exist, clear the seeded rows, then apply the file:

```bash
psql "$DATABASE_URL" -c "TRUNCATE trello_cards, assistant_backups, oauth_states, bookings, calls, integrations, audit_log, phone_numbers, assistants, business_setup, businesses RESTART IDENTITY CASCADE;"
psql "$DATABASE_URL" -f receptwise-export.sql
```

The in-app SQL file does not restore sign-in. The admin created from `ADMIN_EMAIL` on first boot is still the account that can sign in, unless you restored a `pg_dump` that includes `users`.

### Environment variables

| Variable | Secret | Purpose |
| --- | --- | --- |
| `NODE_ENV` | no | `production` on Render |
| `DATABASE_URL` | yes | Postgres connection string (wired from the Blueprint database) |
| `PORT` | no | Set by Render. The server binds `0.0.0.0:$PORT`. |
| `RENDER_EXTERNAL_URL` | no | Set by Render. Used as the public base URL when `APP_BASE_URL` is empty. |
| `APP_BASE_URL` | no | Optional custom origin, no trailing slash. Used for the Vapi webhook URL and the Meta redirect. |
| `SESSION_DAYS` | no | Session lifetime. Default 14. |
| `ADMIN_EMAIL` | yes | First admin, created only when the users table is empty |
| `ADMIN_PASSWORD` | yes | First admin password, 10+ characters |
| `ADMIN_NAME` | no | Optional display name for that admin |
| `SMS_ENABLED` | no | Keep `false` until texting registration exists |
| `TWILIO_ACCOUNT_SID` | yes | Twilio REST |
| `TWILIO_AUTH_TOKEN` | yes | Twilio REST |
| `TWILIO_AREA_CODES` | no | Default search area codes |
| `VAPI_API_KEY` | yes | Vapi REST (`Authorization: Bearer`) |
| `VAPI_BASE_URL` | no | Default `https://api.vapi.ai` |
| `VAPI_WEBHOOK_SECRET` | yes | Must match the `X-Vapi-Secret` header. Required in production. |
| `VAPI_VOICE_ID` | yes | ElevenLabs voice, only for newly published assistants |
| `VAPI_VOICE_PROVIDER` | no | Default `11labs` |
| `VAPI_VOICE_MODEL` | no | Default `eleven_flash_v2_5` |
| `VAPI_MODEL` | no | Default `gpt-4.1` |
| `VAPI_TRANSCRIBER_MODEL` | no | Default `nova-3` |
| `VAPI_CALENDAR_TOOL_IDS` | no | Comma-separated Vapi tool ids |
| `VAPI_MAX_CALL_SECONDS` | no | Default 600 |
| `VAPI_ASSISTANT_ID` | no | Pilot assistant id |
| `VAPI_PHONE_NUMBER_ID` | no | Pilot Vapi phone number id |
| `PILOT_PHONE_E164` | no | Pilot number, E.164 |
| `TRANSFER_TO_NUMBER` | yes | Fallback transfer number when a business has none |
| `TOKEN_ENCRYPTION_KEY` | yes | AES-256-GCM key for stored OAuth tokens |
| `META_APP_ID` | yes | Meta app id |
| `META_APP_SECRET` | yes | Meta app secret |
| `META_GRAPH_VERSION` | no | Default `v21.0` |
| `META_LOGIN_CONFIG_ID` | yes | Optional Facebook Login for Business configuration id |
| `META_REDIRECT_URI` | no | Optional override of the OAuth redirect |
| `META_OAUTH_SCOPES` | no | Used when `META_LOGIN_CONFIG_ID` is empty |
| `TRELLO_API_KEY` | yes | Trello Power-Up API key. Optional if a key is pasted per business. |
| `TRELLO_TOKEN` | yes | Trello token from the key's authorize link. Optional if a token is pasted per business. |
| `GITHUB_TOKEN` | yes | Creates public repos, commits the site, and opens pull requests. Classic `repo` scope, or a fine-grained token with Contents, Pull requests, and Administration on the org. Pages permission is optional. |
| `GITHUB_ORG` | no | GitHub user or organization that owns new site repos. Default `atulitllc`. If that login is the token's own user, repos are created with `POST /user/repos`. |
| `GITHUB_OWNER` | no | Optional override of `GITHUB_ORG`. Same meaning: the repo owner, user or organization. |

## How to get your Trello key and token

1. Sign in to Trello and open [Power-Up admin](https://trello.com/power-ups/admin).
2. Create a Power-Up, or open one you already use for this panel. Copy its API key.
3. Open the key's authorize link in the same browser. Put your key in place of `YOUR_KEY`:

   `https://trello.com/1/authorize?expiration=never&name=ReceptWise&scope=read,write&response_type=token&key=YOUR_KEY`

   Allow access. Trello shows a token. Copy it. Treat the token like a password.
4. Paste the API key and the token on the Integrations page and save them. Or set `TRELLO_API_KEY` and `TRELLO_TOKEN` on the server instead of pasting. A pasted key is encrypted on the server and is not shown again.
5. Click **Test connection**. Choose the board and the list where cards should go. Turn on cards for new bookings, missed calls, or both, and save.

A new booking opens a card with the caller's name, phone, business, time, call summary, and a link to that call in the panel. The same card is updated when the booking changes. A missed call opens one card and is not duplicated. Each create and update is written to the activity feed.

Server-side Vapi and Twilio requests send `User-Agent: ReceptWise-Control-Panel/1.0` because Vapi rejects some default clients with HTTP 403.

## Run locally

```bash
# Postgres, then:
cd server
npm install
cp .env.example .env   # set DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD
node --env-file=.env src/index.js
# open http://localhost:3000
npm test
```

Migrations run on boot. Sessions are httpOnly cookies (`SameSite=Lax`, `Secure` in production) plus an `X-RW-Client: portal` header on writes. Passwords are bcrypt. Login is limited to 10 failures per email and IP per 15 minutes.

See [server/README.md](server/README.md) for the API.
