# ReceptWise control panel

Clickable static prototype of the internal admin portal. No build step and no backend. Open `index.html` or use the live site.

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
