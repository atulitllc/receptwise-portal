/* Feature status registry — the only place feature badges are defined.
   Badges in the admin panel and GET /api/feature-status both read this file.
   To ship a feature, change its status here. Nothing else needs a copy of the list.

   status:
     real        — working against the server with real data (green "Real")
     mockup      — placeholder, sample data, or a canned toast (gray "Mockup")
     in_progress — being built (blue "In progress")
*/
(function (root, factory) {
  var registry = factory();
  if (typeof module === "object" && module.exports) module.exports = registry;
  if (root) root.RW_FEATURE_STATUS = registry;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
    phone_number: {
      label: "AI number",
      status: "real",
      note: "Buy and connect purchases a Twilio number and attaches it to the receptionist."
    },
    test_call: {
      label: "Test call",
      status: "real",
      note: "The business page places a real outbound test call through Vapi."
    },
    bookings: {
      label: "Bookings",
      status: "real",
      note: "Appointment rows are bookings stored from calls."
    },
    call_log: {
      label: "Call log",
      status: "real",
      note: "Calls are stored from Vapi and loaded from the server."
    },
    receptionist: {
      label: "Receptionist",
      status: "real",
      note: "Greeting and prompt save in the panel and publish to Vapi."
    },
    business_settings: {
      label: "Settings",
      status: "real",
      note: "Hours, time zone, transfer number, and pause save on the business."
    },
    number_search: {
      label: "Number search",
      status: "real",
      note: "Show numbers searches Twilio for local numbers and does not list 555 samples. A number is purchased only on Buy and connect."
    },
    calendar_connection: {
      label: "Calendar",
      status: "real",
      note: "On the Bookings tab, choose Google Calendar or Cal.com. Google uses OAuth. Cal.com uses an encrypted API key and an event type from GET /v2/event-types. Until one is connected, the assistant uses the shared demo calendar and the page says so. The demo does not connect either provider."
    },
    social: {
      label: "Social",
      status: "mockup",
      note: "Facebook, Instagram, and post drafts on the Social tab are placeholders. A typed handle is not a connection."
    },
    reviews: {
      label: "Reviews",
      status: "mockup",
      note: "Review cards and the review link are sample data."
    },
    website_generator: {
      label: "Website generator",
      status: "in_progress",
      note: "Classic and Modern templates generate a GitHub repository, and Regenerate opens a pull request. The same files are also uploaded to Cloudflare Pages when that account is configured. It needs GITHUB_TOKEN on Render."
    },
    cloudflare_pages: {
      label: "Cloudflare Pages",
      status: "in_progress",
      note: "Generate and Regenerate upload the same site to Cloudflare Pages with Direct Upload. It needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Without them the Website tab says Cloudflare not configured and GitHub still publishes."
    },
    domains_hosting: {
      label: "Domains & Hosting",
      status: "real",
      note: "The business overview Domains card checks the customer panel, attaches a website domain to that business's Cloudflare Pages project, and keeps the Render wildcard DNS-only. It needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID, RENDER_API_KEY, and RENDER_SERVICE_ID. Without them the card says Not configured."
    },
    outreach: {
      label: "Outreach",
      status: "mockup",
      note: "Import customers, New campaign, and the campaign table are sample only."
    },
    voice_dropdown: {
      label: "Voice",
      status: "real",
      note: "The voice picker uses the catalog (Nora, Sarah, Jessica, Laura, and Lily). The choice is stored on the business and used when the receptionist is published."
    },
    email_domain: {
      label: "Email domain",
      status: "mockup",
      note: "SPF and DKIM checks are simulated."
    },
    billing: {
      label: "Billing",
      status: "mockup",
      note: "Plan math is a local estimate. Payment links are sample URLs, not Stripe."
    },
    texting: {
      label: "Texting",
      status: "mockup",
      note: "Registration status is a canned message. Texting stays off until SMS is enabled."
    },
    demo_requests: {
      label: "Demo requests",
      status: "real",
      note: "The marketing site form saves into Leads. Admins can mark each request new, contacted, or closed."
    }
  };
});
