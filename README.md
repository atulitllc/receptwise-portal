# ReceptWise control panel

Internal admin portal. The repo root is a clickable static demo (GitHub Pages, sample data). The same pages run against real data when served by the Node server in [`server/`](server/README.md).

**Live:** https://atulitllc.github.io/receptwise-portal/

Sign-in accepts any email and password. Sample data includes ReceptWise as pilot client 1, plus six fictional local businesses.

## Pages

| Page | File | What it shows |
| --- | --- | --- |
| Sign in | `index.html` | Team sign-in |
| Overview | `dashboard.html` | All businesses, calls today, bookings, setup progress, alerts |
| Businesses | `clients.html` | Filter by type, size tier, and status |
| Add business | `add.html` | Wizard: details, plan, phone and forwarding codes, test call, calendar, receptionist, social, website, texting, review |
| Business | `client.html?id=harbor-rye` | Overview checklist plus Receptionist, Bookings, Reviews, Social, Website, Outreach, Billing, and Settings |
| Billing and plans | `billing.html` | Solo / Small / Growing tiers, minute usage, estimated cost |
| Team and settings | `team.html` | Teammates, legal entity, notification toggles |

Links are relative so the site works on GitHub Pages under `/receptwise-portal/`.

## Live version (server/)

`server/` is a Node + Express + Postgres backend. It serves these same pages with real team sign-in, real businesses and setup state, and Twilio + Vapi integration code. That code stays inert until keys are set, and texting stays off. When `window.RW_LIVE` is present (injected by the server), `assets/app.js` calls the API instead of using sample data. On GitHub Pages nothing changes. See [server/README.md](server/README.md) and `render.yaml`.
