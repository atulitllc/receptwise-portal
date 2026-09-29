/* Sample data for the ReceptWise control panel prototype. */
(function () {
  function item(status, detail, owner, extra) {
    return Object.assign({ status: status, detail: detail, owner: owner }, extra || {});
  }

  function checklist(rows) {
    var defs = [
      ["number", "AI number"],
      ["test", "Receptionist test call"],
      ["forwarding", "Forwarding"],
      ["calendar", "Calendar"],
      ["texting", "Texting registration"],
      ["email", "Email domain"],
      ["reviews", "Google review link"],
      ["gbp", "Google Business Profile"],
      ["social", "Facebook and Instagram"],
      ["website", "Website"],
      ["billing", "Billing"]
    ];
    return defs.map(function (def) {
      var row = rows[def[0]] || item("pending", "Not started", "Team");
      row.key = def[0];
      row.label = def[1];
      return row;
    });
  }

  var textingHold = "Texting stays off until the final company tax ID is on file. Calls still work. Email is used instead.";

  window.RW_DATA = {
    plans: [
      {
        id: "starter",
        tier: "Solo",
        staff: "1–3 staff",
        name: "Starter",
        price: 199,
        minutes: 250,
        recommended: false,
        features: [
          "AI receptionist, 24/7",
          "250 call minutes a month",
          "Texts callers a booking link once texting is approved",
          "Website chat",
          "Google review link"
        ]
      },
      {
        id: "growth",
        tier: "Small",
        staff: "4–15 staff",
        name: "Growth",
        price: 399,
        minutes: 1000,
        recommended: true,
        features: [
          "Everything in Starter",
          "Books during the call and transfers to staff",
          "1,000 call minutes a month",
          "AI replies on Instagram, Facebook, and the website"
        ]
      },
      {
        id: "pro",
        tier: "Growing",
        staff: "16+ staff or multiple locations",
        name: "Pro",
        price: 599,
        minutes: 1000,
        recommended: false,
        features: [
          "Everything in Growth",
          "1,000 call minutes, with support for more than one location",
          "Automatic review requests by text and email",
          "Customer outreach campaigns",
          "Website texting, once registration is approved"
        ]
      }
    ],
    team: [
      { name: "Maya Chen", email: "maya.chen@receptwise.example", role: "Admin", scope: "All businesses, billing, and costs" },
      { name: "Jordan Hale", email: "jordan.hale@receptwise.example", role: "Team", scope: "Harbor & Rye, Maple Street Auto, Lumen Salon" },
      { name: "Alex Rivera", email: "alex.rivera@receptwise.example", role: "Team", scope: "Northline Family Clinic, BrightNest, Oak & Thread" }
    ],
    feed: [
      { time: "9:41 AM", businessId: "harbor-rye", text: "Booked a table for two, Friday at 7:00 PM." },
      { time: "9:16 AM", businessId: "northline", text: "Booked a new-patient visit for Wednesday at 2:20 PM." },
      { time: "8:52 AM", businessId: "lumen", text: "Booked a cut and color for Thursday at 11:00 AM." },
      { time: "8:27 AM", businessId: "oak-thread", text: "Answered an hours question. No booking." },
      { time: "8:05 AM", businessId: "receptwise", text: "Booked a 20-minute demo for Tuesday at 10:00 AM." },
      { time: "7:48 AM", businessId: "maple-auto", text: "Forwarding test did not reach the receptionist." }
    ],
    businesses: [
      {
        id: "receptwise",
        name: "ReceptWise",
        category: "Professional services",
        city: "San Francisco, CA",
        address: "100 Pilot Street, Suite 200, San Francisco, CA 94104",
        website: "receptwise.example",
        hours: "Mon–Fri 9:00 AM – 6:00 PM",
        timezone: "Pacific Time",
        staff: 4,
        locations: 1,
        tier: "Small",
        plan: "Growth",
        price: 399,
        minutesCap: 1000,
        minutesUsed: 86,
        texts: 0,
        callsToday: 2,
        bookingsToday: 1,
        status: "setup",
        pilot: true,
        setupFee: 0,
        card: "Pilot · no card charged",
        nextInvoice: "Pilot ends Oct 22, 2026",
        trial: "Day 6 of 30 · $0",
        owner: { name: "Maya Chen", mobile: "(415) 555-0142", email: "maya.chen@receptwise.example" },
        phone: {
          mode: "forward",
          carrier: "verizon",
          forwardType: "missed",
          businessNumber: "(415) 555-0142",
          aiNumber: "(415) 555-0148",
          tests: [
            { when: "Sep 22, 2026 · 11:05 AM", result: "Confirmed", note: "Test call to the AI number. Greeting matched." }
          ]
        },
        greeting: "Thanks for calling ReceptWise. I'm the virtual assistant, and this call may be recorded. I can explain what we do, book a free 20-minute demo, or connect you with the team.",
        voice: "nora",
        languages: ["English"],
        transfer: "(415) 555-0142",
        capabilities: { book: true, reschedule: true, cancel: true, transfer: true, textLink: false },
        services: [
          { name: "Intro demo", length: "20 min", price: "$0" }
        ],
        faqs: [
          { q: "What does ReceptWise do?", a: "We answer the phone, book appointments, follow up for Google reviews, post on social, and host a simple website for local businesses." },
          { q: "How much does it cost?", a: "Solo businesses start at $199 a month. Setup is $299, and the first 30 days are free for pilot businesses." },
          { q: "Can I keep my current number?", a: "Yes. We forward it to the receptionist, or we can move it later if you want that." }
        ],
        blurb: "An AI front desk and marketing service for local businesses.",
        template: "Professional services",
        domainStatus: "Draft only. Domain not connected yet.",
        reviewLink: "",
        socialAccounts: { facebook: "", instagram: "", gbp: "" },
        bookings: [
          { when: "Tue, Sep 30 · 10:00 AM", customer: "Riley Cho", service: "Intro demo", source: "Phone", status: "Confirmed" }
        ],
        calls: [
          {
            time: "8:05 AM",
            from: "(628) 555-0174",
            duration: "2:11",
            outcome: "Booked",
            flag: "",
            summary: "Asked what ReceptWise does and booked a demo for Tuesday.",
            lines: [
              ["Receptionist", "Thanks for calling ReceptWise. I'm the virtual assistant, and this call may be recorded. How can I help?"],
              ["Caller", "What do you actually do, and can I see it on a short call?"],
              ["Receptionist", "We answer the phone, book appointments, and handle reviews, social posts, and a simple website. Tuesday at 10:00 AM is open for a 20-minute demo. Should I book it?"],
              ["Caller", "Yes, under Riley Cho."]
            ]
          },
          {
            time: "Yesterday",
            from: "(415) 555-0199",
            duration: "1:04",
            outcome: "Message",
            flag: "Caller asked for a person",
            summary: "Wanted a person. Transferred to the owner mobile.",
            lines: [
              ["Receptionist", "Thanks for calling ReceptWise. I'm the virtual assistant, and this call may be recorded."],
              ["Caller", "Can I talk to a person?"],
              ["Receptionist", "Yes. I'll transfer you now."]
            ]
          }
        ],
        reviews: [],
        posts: [],
        campaigns: [],
        contacts: 18,
        suppressed: 0,
        activity: [
          { time: "8:05 AM", text: "Demo booked for Tuesday at 10:00 AM." },
          { time: "Sep 22", text: "AI number test call confirmed." }
        ],
        checklist: checklist({
          number: item("connected", " (415) 555-0148 is active.", "Team", { detail: "(415) 555-0148 is active on the voice provider." }),
          test: item("connected", "Greeting matched on Sep 22.", "Team"),
          forwarding: item("pending", "Missed-call forwarding is not turned on yet. Dial *71 from the owner mobile, then run the test.", "Team", { next: true }),
          calendar: item("connected", "Google Calendar connected. A test booking was created and removed.", "Team"),
          texting: item("action", textingHold, "Team"),
          email: item("pending", "SPF and DKIM are not published on receptwise.example yet.", "Team"),
          reviews: item("pending", "Google review link is not ready. The Business Profile is not verified yet.", "Team"),
          gbp: item("pending", "Profile drafted. Verification is in progress. The 60-day clock for Google's connection starts after it is verified.", "Team"),
          social: item("pending", "Facebook Page and Instagram are not connected yet.", "Team"),
          website: item("pending", "Draft is ready. The domain is not attached, so the padlock check has not passed.", "Team"),
          billing: item("connected", "$0 pilot subscription exists. Setup fee waived.", "Team")
        })
      },
      {
        id: "harbor-rye",
        name: "Harbor & Rye",
        category: "Restaurant",
        city: "Portland, OR",
        address: "418 Lantern Street, Portland, OR 97209",
        website: "harborandrye.example",
        hours: "Tue–Sun 4:00 PM – 10:00 PM",
        timezone: "Pacific Time",
        staff: 12,
        locations: 1,
        tier: "Small",
        plan: "Growth",
        price: 399,
        minutesCap: 1000,
        minutesUsed: 640,
        texts: 0,
        callsToday: 11,
        bookingsToday: 4,
        status: "live",
        pilot: false,
        setupFee: 299,
        card: "Visa ···· 4242",
        nextInvoice: "Oct 1, 2026 · $399",
        trial: "None",
        owner: { name: "Elena Vasquez", mobile: "(503) 555-0172", email: "elena@harborandrye.example" },
        phone: {
          mode: "forward",
          carrier: "verizon",
          forwardType: "all",
          businessNumber: "(503) 555-0172",
          aiNumber: "(503) 555-0194",
          tests: [
            { when: "Sep 12, 2026 · 10:42 AM", result: "Confirmed", note: "Called the restaurant number. The receptionist answered with the Harbor & Rye greeting." },
            { when: "Sep 19, 2026 · 9:00 AM", result: "Confirmed", note: "Weekly check. Forwarding still reaches the receptionist." }
          ]
        },
        greeting: "Thanks for calling Harbor & Rye. I'm the virtual assistant, and this call may be recorded. I can book a table, answer questions, or reach the host stand.",
        voice: "nora",
        languages: ["English", "Spanish"],
        transfer: "(503) 555-0172",
        capabilities: { book: true, reschedule: true, cancel: true, transfer: true, textLink: false },
        services: [
          { name: "Dinner reservation", length: "90 min", price: "No fee" },
          { name: "Private dining inquiry", length: "15 min", price: "No fee" }
        ],
        faqs: [
          { q: "Do you take walk-ins?", a: "Yes, when a table is open. Reservations are recommended after 6 PM." },
          { q: "Is there parking?", a: "A small lot is behind the restaurant, and street parking is on Lantern Street." },
          { q: "Can you take a large party?", a: "Parties over 8 are booked as a private dining inquiry. I can take the request and have the host stand call back." }
        ],
        blurb: "Seasonal dinner in a small room off Lantern Street.",
        template: "Restaurant",
        domainStatus: "harborandrye.example loads with a padlock.",
        reviewLink: "https://search.google.com/local/writereview?placeid=sample-harbor",
        socialAccounts: { facebook: "Harbor & Rye", instagram: "@harborandrye", gbp: "Harbor & Rye" },
        bookings: [
          { when: "Fri, Oct 2 · 7:00 PM", customer: "Marco Diaz", service: "Dinner for 2", source: "Phone", status: "Confirmed" },
          { when: "Sat, Oct 3 · 5:30 PM", customer: "Priya Shah", service: "Dinner for 4", source: "Phone", status: "Confirmed" },
          { when: "Sun, Oct 4 · 6:00 PM", customer: "Noah Bennett", service: "Dinner for 2", source: "Website", status: "Confirmed" }
        ],
        calls: [
          {
            time: "9:41 AM",
            from: "(503) 555-2201",
            duration: "1:48",
            outcome: "Booked",
            flag: "",
            summary: "Table for two, Friday at 7:00 PM, under Marco Diaz.",
            lines: [
              ["Receptionist", "Thanks for calling Harbor & Rye. I'm the virtual assistant, and this call may be recorded. How can I help?"],
              ["Caller", "Table for two this Friday at 7."],
              ["Receptionist", "Friday at 7:00 PM is open for two. What name should I use?"],
              ["Caller", "Marco Diaz."],
              ["Receptionist", "You're booked. A confirmation email is on its way. Text confirmations start after texting is approved."]
            ]
          },
          {
            time: "8:12 AM",
            from: "(971) 555-0144",
            duration: "0:54",
            outcome: "Transferred",
            flag: "Caller asked for a person",
            summary: "Asked for the chef's table. Transferred to the host stand.",
            lines: [
              ["Receptionist", "Thanks for calling Harbor & Rye. I'm the virtual assistant, and this call may be recorded."],
              ["Caller", "I need to talk to a person about a chef's table."],
              ["Receptionist", "I'll transfer you to the host stand."]
            ]
          },
          {
            time: "Yesterday",
            from: "(503) 555-0180",
            duration: "1:12",
            outcome: "Answered",
            flag: "",
            summary: "Confirmed the kitchen is closed on Mondays.",
            lines: [
              ["Caller", "Are you open Monday?"],
              ["Receptionist", "We're closed Mondays. Tuesday through Sunday we serve from 4 to 10 PM."]
            ]
          }
        ],
        reviews: [
          { author: "Dana Whitfield", stars: 5, when: "Sep 26", text: "Easy to get a table and the staff was kind.", draft: "Thank you, Dana. We're glad the evening felt easy. — Harbor & Rye", posted: false },
          { author: "Chris Parnell", stars: 4, when: "Sep 20", text: "Great food. A little loud near the bar.", draft: "Thanks, Chris. We'll pass the note about the bar noise to the floor team. Glad the food landed.", posted: true }
        ],
        posts: [
          { when: "Wed · 4:00 PM", channel: "Instagram", text: "Trout, rye, and a window table. Dinner starts at 4.", status: "Scheduled" },
          { when: "Sep 25", channel: "Facebook", text: "Sunday supper is booked through 7:30. Later tables are still open.", status: "Published" }
        ],
        campaigns: [
          { name: "We saved you a Tuesday", channel: "Email", when: "Sep 16", sent: 420, clicked: 61, bookings: 9, status: "Sent" }
        ],
        contacts: 860,
        suppressed: 14,
        activity: [
          { time: "9:41 AM", text: "Booked Marco Diaz for Friday at 7:00 PM." },
          { time: "Sep 26", text: "New 5-star review from Dana Whitfield. Reply is waiting for approval." }
        ],
        checklist: checklist({
          number: item("connected", "(503) 555-0194 is active and attached to the receptionist.", "Team"),
          test: item("connected", "Greeting matched on the last test call.", "Team"),
          forwarding: item("connected", "All calls forward from Verizon. Last weekly check Sep 19.", "Team"),
          calendar: item("connected", "Google Calendar connected. Test booking created and removed.", "Team"),
          texting: item("pending", textingHold, "Team", { next: true }),
          email: item("connected", "SPF and DKIM found for harborandrye.example.", "Team"),
          reviews: item("connected", "Review link opens the Harbor & Rye review form. Requests go by email until texting is approved.", "Team"),
          gbp: item("connected", "Team shows as a manager on the Business Profile.", "Team"),
          social: item("connected", "Read back Facebook Page “Harbor & Rye” and Instagram @harborandrye.", "Team"),
          website: item("connected", "https://harborandrye.example loads with a padlock.", "Team"),
          billing: item("connected", "First payment succeeded. Card on file.", "Team")
        })
      },
      {
        id: "northline",
        name: "Northline Family Clinic",
        category: "Clinic",
        city: "Boston, MA",
        address: "25 Harborview Avenue, Boston, MA 02114",
        website: "northlineclinic.example",
        hours: "Mon–Fri 8:00 AM – 5:00 PM",
        timezone: "Eastern Time",
        staff: 22,
        locations: 2,
        tier: "Growing",
        plan: "Pro",
        price: 599,
        minutesCap: 1000,
        minutesUsed: 840,
        texts: 0,
        callsToday: 8,
        bookingsToday: 5,
        status: "live",
        pilot: false,
        setupFee: 299,
        card: "Mastercard ···· 1881",
        nextInvoice: "Oct 4, 2026 · $599",
        trial: "None",
        owner: { name: "Dr. Amira Hassan", mobile: "(617) 555-0133", email: "amira@northlineclinic.example" },
        phone: {
          mode: "forward",
          carrier: "att-mobile",
          forwardType: "missed",
          businessNumber: "(617) 555-0133",
          aiNumber: "(617) 555-0160",
          tests: [
            { when: "Sep 8, 2026 · 2:14 PM", result: "Confirmed", note: "Let the front desk ring. The receptionist picked up with the clinic greeting." }
          ]
        },
        greeting: "Thanks for calling Northline Family Clinic. I'm the virtual assistant, and this call may be recorded. I can book a visit or transfer you to the front desk. I can't take medical details on this line.",
        voice: "nora",
        languages: ["English"],
        transfer: "(617) 555-0133",
        capabilities: { book: true, reschedule: true, cancel: true, transfer: true, textLink: false },
        services: [
          { name: "New patient visit", length: "40 min", price: "$180" },
          { name: "Follow-up visit", length: "20 min", price: "$95" },
          { name: "Physical", length: "40 min", price: "$200" }
        ],
        faqs: [
          { q: "Where are you?", a: "The main office is 25 Harborview Avenue. The second office is 80 River Road, Cambridge." },
          { q: "Do you take my insurance?", a: "Please call the front desk for insurance questions. I can book the visit and transfer you." },
          { q: "Can I get medical advice here?", a: "No. This line only books and takes messages. For medical questions I transfer you to the desk." }
        ],
        blurb: "Primary care at two offices in Boston and Cambridge.",
        template: "Clinic",
        domainStatus: "northlineclinic.example loads with a padlock.",
        reviewLink: "https://search.google.com/local/writereview?placeid=sample-northline",
        socialAccounts: { facebook: "", instagram: "", gbp: "Northline Family Clinic" },
        bookings: [
          { when: "Wed, Oct 1 · 2:20 PM", customer: "Helen Cho", service: "New patient visit", source: "Phone", status: "Confirmed" },
          { when: "Thu, Oct 2 · 9:00 AM", customer: "Samir Adeyemi", service: "Follow-up visit", source: "Phone", status: "Confirmed" },
          { when: "Thu, Oct 2 · 11:40 AM", customer: "Greta Holm", service: "Physical", source: "Website", status: "Confirmed" }
        ],
        calls: [
          {
            time: "9:16 AM",
            from: "(617) 555-2290",
            duration: "2:02",
            outcome: "Booked",
            flag: "",
            summary: "New-patient visit Wednesday at 2:20 PM. No health details collected.",
            lines: [
              ["Receptionist", "Thanks for calling Northline Family Clinic. I'm the virtual assistant, and this call may be recorded. I can book a visit or transfer you. I can't take medical details."],
              ["Caller", "I'd like a checkup next week. I'm a new patient."],
              ["Receptionist", "Wednesday at 2:20 PM is open for a new-patient visit at Harborview Avenue. Should I book it under Helen Cho?"],
              ["Caller", "Yes."]
            ]
          },
          {
            time: "Yesterday",
            from: "(857) 555-0118",
            duration: "0:41",
            outcome: "Transferred",
            flag: "Caller asked for a person",
            summary: "Insurance question. Transferred to the front desk.",
            lines: [
              ["Caller", "Does the doctor take my plan?"],
              ["Receptionist", "I can't check plans on this line. I'll transfer you to the front desk."]
            ]
          }
        ],
        reviews: [
          { author: "Joan Keller", stars: 5, when: "Sep 24", text: "Front desk got me in the same week.", draft: "Thank you, Joan. We're glad we could see you quickly.", posted: false }
        ],
        posts: [
          { when: "Fri · 9:00 AM", channel: "Google Business Profile", text: "Flu-shot clinics run Fridays in October. Call to book a time.", status: "Draft" }
        ],
        campaigns: [
          { name: "Time for a physical", channel: "Email", when: "Sep 10", sent: 1100, clicked: 140, bookings: 46, status: "Sent" }
        ],
        contacts: 2400,
        suppressed: 33,
        activity: [
          { time: "9:16 AM", text: "New-patient visit booked for Wednesday." },
          { time: "Sep 24", text: "Review from Joan Keller is waiting for approval." }
        ],
        checklist: checklist({
          number: item("connected", "(617) 555-0160 is active.", "Team"),
          test: item("connected", "Clinic greeting matched. Disclosure includes recording and virtual assistant.", "Team"),
          forwarding: item("connected", "AT&T mobile, missed calls only. Confirmed Sep 8.", "Team"),
          calendar: item("connected", "Microsoft calendar connected for both offices.", "Team"),
          texting: item("pending", textingHold, "Team", { next: true }),
          email: item("connected", "SPF and DKIM found for northlineclinic.example.", "Team"),
          reviews: item("connected", "Review link opens the clinic form. Requests are email-only for now.", "Team"),
          gbp: item("connected", "Manager access confirmed on the Boston profile.", "Team"),
          social: item("pending", "Facebook sign-in link sent Sep 18. Instagram is a personal account and needs to be switched to a professional account first.", "Client"),
          website: item("connected", "https://northlineclinic.example loads with a padlock.", "Team"),
          billing: item("connected", "Pro subscription active. Card on file.", "Team")
        })
      },
      {
        id: "maple-auto",
        name: "Maple Street Auto",
        category: "Auto shop",
        city: "Chicago, IL",
        address: "880 Workshop Avenue, Chicago, IL 60622",
        website: "maplestreetauto.example",
        hours: "Mon–Fri 7:30 AM – 6:00 PM, Sat 8:00 AM – 1:00 PM",
        timezone: "Central Time",
        staff: 8,
        locations: 1,
        tier: "Small",
        plan: "Growth",
        price: 399,
        minutesCap: 1000,
        minutesUsed: 120,
        texts: 0,
        callsToday: 3,
        bookingsToday: 1,
        status: "attention",
        pilot: false,
        setupFee: 299,
        card: "Visa ···· 4242",
        nextInvoice: "Oct 6, 2026 · $399",
        trial: "None",
        owner: { name: "Luis Ortega", mobile: "(312) 555-0188", email: "luis@maplestreetauto.example" },
        phone: {
          mode: "forward",
          carrier: "tmobile",
          forwardType: "missed",
          businessNumber: "(312) 555-0188",
          aiNumber: "(312) 555-0114",
          tests: [
            { when: "Sep 27, 2026 · 4:18 PM", result: "Not working", note: "The receptionist did not pick up within 45 seconds. The code may have been dialed from a different line." }
          ]
        },
        greeting: "Thanks for calling Maple Street Auto. I'm the virtual assistant, and this call may be recorded. I can book a visit or transfer you to the shop.",
        voice: "nora",
        languages: ["English", "Spanish"],
        transfer: "(312) 555-0188",
        capabilities: { book: true, reschedule: true, cancel: false, transfer: true, textLink: false },
        services: [
          { name: "Diagnostic", length: "60 min", price: "$129" },
          { name: "Oil service", length: "45 min", price: "$79" },
          { name: "Brake inspection", length: "45 min", price: "$49" }
        ],
        faqs: [
          { q: "Do I need an appointment?", a: "Appointments are seen first. I can hold a time for a diagnostic, oil service, or inspection." },
          { q: "Do you offer loaner cars?", a: "No loaner cars. There's a rideshare bench out front and street parking on Workshop Avenue." },
          { q: "Where do I drop the car after hours?", a: "The key drop is the mail slot by the office door. Tell me the name on the work order and I'll leave a note." }
        ],
        blurb: "Diagnostics, maintenance, and brakes on Workshop Avenue.",
        template: "Auto shop",
        domainStatus: "maplestreetauto.example loads with a padlock.",
        reviewLink: "https://search.google.com/local/writereview?placeid=sample-maple",
        socialAccounts: { facebook: "Maple Street Auto", instagram: "", gbp: "" },
        bookings: [
          { when: "Mon, Sep 29 · 8:30 AM", customer: "Andre Wallace", service: "Oil service", source: "Phone", status: "Confirmed" }
        ],
        calls: [
          {
            time: "7:58 AM",
            from: "(773) 555-0166",
            duration: "1:36",
            outcome: "Booked",
            flag: "",
            summary: "Oil service Monday at 8:30 AM for Andre Wallace.",
            lines: [
              ["Receptionist", "Thanks for calling Maple Street Auto. I'm the virtual assistant, and this call may be recorded."],
              ["Caller", "I need an oil change early next week."],
              ["Receptionist", "Monday at 8:30 AM is open. I can put it under Andre Wallace."],
              ["Caller", "That works."]
            ]
          },
          {
            time: "Yesterday",
            from: "(312) 555-0102",
            duration: "0:33",
            outcome: "Message",
            flag: "Booking failed",
            summary: "Asked for Saturday afternoon. The shop closes at 1:00 PM, and no later slot was booked.",
            lines: [
              ["Caller", "Can you take me Saturday at 3?"],
              ["Receptionist", "Saturday hours end at 1:00 PM. The next open diagnostic is Monday at 10:15 AM. I wasn't able to book 3 PM."]
            ]
          }
        ],
        reviews: [
          { author: "Mike Ellison", stars: 5, when: "Sep 18", text: "Honest about what the car did and did not need.", draft: "Thank you, Mike. We'll pass that along to the techs.", posted: true }
        ],
        posts: [
          { when: "Thu · 12:00 PM", channel: "Facebook", text: "Saturday hours are 8 to 1. Book an oil service before the weekend fills up.", status: "Scheduled" }
        ],
        campaigns: [],
        contacts: 540,
        suppressed: 4,
        activity: [
          { time: "Sep 27", text: "Forwarding test failed. Waiting on a new code dial from the shop line." },
          { time: "7:58 AM", text: "Oil service booked for Monday at 8:30 AM." }
        ],
        checklist: checklist({
          number: item("connected", "(312) 555-0114 is active.", "Team"),
          test: item("connected", "The AI number itself answers with the shop greeting.", "Team"),
          forwarding: item("action", "Test on Sep 27 did not reach the receptionist within 45 seconds. Dial the T-Mobile no-answer code from the shop phone, not a personal line.", "Client", { next: true }),
          calendar: item("connected", "Google Calendar connected. Test booking created and removed.", "Team"),
          texting: item("action", "Legal name on the phone bill is still missing, so registration cannot be queued. " + textingHold, "Client"),
          email: item("connected", "SPF and DKIM found for maplestreetauto.example.", "Team"),
          reviews: item("connected", "Review link opens the shop form.", "Team"),
          gbp: item("pending", "Owner has not added the team as a manager yet.", "Client"),
          social: item("pending", "Facebook Page is known. Instagram was not provided.", "Client"),
          website: item("connected", "https://maplestreetauto.example loads with a padlock.", "Team"),
          billing: item("connected", "Growth subscription active.", "Team")
        })
      },
      {
        id: "lumen",
        name: "Lumen Salon",
        category: "Salon",
        city: "Seattle, WA",
        address: "70 Cedar Lane, Seattle, WA 98101",
        website: "lumensalon.example",
        hours: "Tue–Sat 9:00 AM – 7:00 PM",
        timezone: "Pacific Time",
        staff: 3,
        locations: 1,
        tier: "Solo",
        plan: "Starter",
        price: 199,
        minutesCap: 250,
        minutesUsed: 190,
        texts: 0,
        callsToday: 6,
        bookingsToday: 3,
        status: "live",
        pilot: false,
        setupFee: 299,
        card: "Visa ···· 5510",
        nextInvoice: "Oct 2, 2026 · $199",
        trial: "None",
        owner: { name: "Sofia Nguyen", mobile: "(206) 555-0120", email: "sofia@lumensalon.example" },
        phone: {
          mode: "new",
          carrier: "",
          forwardType: "",
          businessNumber: "",
          aiNumber: "(206) 555-0106",
          tests: [
            { when: "Sep 4, 2026 · 1:20 PM", result: "Confirmed", note: "Called the new number. Greeting matched." }
          ]
        },
        greeting: "Thanks for calling Lumen Salon. I'm the virtual assistant, and this call may be recorded. I can book a cut or color, or reach Sofia.",
        voice: "nora",
        languages: ["English"],
        transfer: "(206) 555-0120",
        capabilities: { book: true, reschedule: true, cancel: true, transfer: true, textLink: false },
        services: [
          { name: "Cut", length: "45 min", price: "$68" },
          { name: "Color", length: "120 min", price: "$140" },
          { name: "Blowout", length: "30 min", price: "$48" }
        ],
        faqs: [
          { q: "Do you take walk-ins?", a: "Walk-ins are welcome for blowouts when a chair is open. Cuts and color need a time." },
          { q: "What products do you use?", a: "Color is booked as a 2-hour appointment. Product questions can go to Sofia after the visit." },
          { q: "Where are you?", a: "70 Cedar Lane, Seattle. The door is under the green awning." }
        ],
        blurb: "Cuts and color on Cedar Lane. Three stylists.",
        template: "Salon",
        domainStatus: "lumensalon.example loads with a padlock.",
        reviewLink: "https://search.google.com/local/writereview?placeid=sample-lumen",
        socialAccounts: { facebook: "Lumen Salon", instagram: "@lumensalon", gbp: "Lumen Salon" },
        bookings: [
          { when: "Thu, Oct 2 · 11:00 AM", customer: "June Park", service: "Cut and color", source: "Phone", status: "Confirmed" },
          { when: "Thu, Oct 2 · 1:30 PM", customer: "Alicia Grant", service: "Cut", source: "Phone", status: "Confirmed" },
          { when: "Sat, Oct 4 · 10:00 AM", customer: "Ren Ito", service: "Blowout", source: "Website", status: "Confirmed" }
        ],
        calls: [
          {
            time: "8:52 AM",
            from: "(206) 555-0177",
            duration: "1:55",
            outcome: "Booked",
            flag: "",
            summary: "Cut and color Thursday at 11:00 AM for June Park.",
            lines: [
              ["Receptionist", "Thanks for calling Lumen Salon. I'm the virtual assistant, and this call may be recorded."],
              ["Caller", "I need a cut and color this week."],
              ["Receptionist", "Thursday at 11:00 AM is open for about two hours. I can book it under June Park."],
              ["Caller", "Perfect."]
            ]
          },
          {
            time: "Yesterday",
            from: "(425) 555-0193",
            duration: "0:40",
            outcome: "Answered",
            flag: "",
            summary: "Confirmed Saturday hours.",
            lines: [
              ["Caller", "Are you open Sunday?"],
              ["Receptionist", "We're closed Sunday and Monday. Saturday we're open 9 to 7."]
            ]
          }
        ],
        reviews: [
          { author: "June Park", stars: 5, when: "Sep 22", text: "Loved the color and the reminder before my visit.", draft: "Thank you, June. Can't wait to see you Thursday.", posted: false }
        ],
        posts: [
          { when: "Tue · 10:00 AM", channel: "Instagram", text: "Two chairs opened Thursday afternoon. Call or book online.", status: "Scheduled" }
        ],
        campaigns: [
          { name: "Color refresh", channel: "Email", when: "Sep 12", sent: 180, clicked: 24, bookings: 7, status: "Sent" }
        ],
        contacts: 310,
        suppressed: 6,
        activity: [
          { time: "8:52 AM", text: "Cut and color booked for Thursday." },
          { time: "Sep 22", text: "Review draft is waiting for Sofia." }
        ],
        checklist: checklist({
          number: item("connected", "New number (206) 555-0106 is the published salon line.", "Team"),
          test: item("connected", "Greeting matched on Sep 4.", "Team"),
          forwarding: item("connected", "Not used. Callers reach the new ReceptWise number directly.", "Team"),
          calendar: item("connected", "Square Appointments Plus is connected. Test booking created and removed.", "Team"),
          texting: item("pending", textingHold, "Team", { next: true }),
          email: item("connected", "SPF and DKIM found for lumensalon.example.", "Team"),
          reviews: item("connected", "Review link opens the salon form. Requests go by email.", "Team"),
          gbp: item("connected", "Team is a manager on the profile.", "Team"),
          social: item("connected", "Read back Facebook “Lumen Salon” and Instagram @lumensalon.", "Team"),
          website: item("connected", "https://lumensalon.example loads with a padlock.", "Team"),
          billing: item("connected", "Starter subscription active. Setup fee paid.", "Team")
        })
      },
      {
        id: "brightnest",
        name: "BrightNest Home Services",
        category: "Home services",
        city: "Denver, CO",
        address: "1500 Foothill Road, Denver, CO 80205",
        website: "brightnest.example",
        hours: "Mon–Sat 7:00 AM – 6:00 PM",
        timezone: "Mountain Time",
        staff: 18,
        locations: 2,
        tier: "Growing",
        plan: "Pro",
        price: 599,
        minutesCap: 1000,
        minutesUsed: 40,
        texts: 0,
        callsToday: 1,
        bookingsToday: 0,
        status: "setup",
        pilot: true,
        setupFee: 0,
        card: "Payment link sent · not completed",
        nextInvoice: "Pilot · $0 until Oct 20, 2026",
        trial: "Day 8 of 30 · $0",
        owner: { name: "Chris Daley", mobile: "(720) 555-0199", email: "chris@brightnest.example" },
        phone: {
          mode: "forward",
          carrier: "att-landline",
          forwardType: "all",
          businessNumber: "(720) 555-0199",
          aiNumber: "(720) 555-0127",
          tests: []
        },
        greeting: "Thanks for calling BrightNest. I'm the virtual assistant, and this call may be recorded. I can book a furnace or plumbing visit, or reach the dispatcher.",
        voice: "nora",
        languages: ["English", "Spanish"],
        transfer: "(720) 555-0199",
        capabilities: { book: true, reschedule: true, cancel: true, transfer: true, textLink: false },
        services: [
          { name: "Furnace tune-up", length: "90 min", price: "$149" },
          { name: "Plumbing visit", length: "60 min", price: "$99" },
          { name: "Electrical visit", length: "60 min", price: "$119" }
        ],
        faqs: [
          { q: "Do you serve Boulder?", a: "Yes. Denver and Boulder are both on the schedule. The Boulder crew is based on Pearl Parkway." },
          { q: "Is there a trip fee?", a: "The visit prices already include the trip inside Denver and Boulder." },
          { q: "Can you come today?", a: "Same-day visits depend on the board. I can offer the next open window or transfer you to the dispatcher." }
        ],
        blurb: "Heating, plumbing, and electrical in Denver and Boulder.",
        template: "Home services",
        domainStatus: "The domain still points at the old host. The padlock check failed.",
        reviewLink: "",
        socialAccounts: { facebook: "", instagram: "", gbp: "BrightNest Home Services" },
        bookings: [],
        calls: [
          {
            time: "Yesterday",
            from: "(720) 555-0140",
            duration: "1:21",
            outcome: "Booked",
            flag: "",
            summary: "Furnace tune-up held for Friday morning, then the owner asked to confirm the window by email.",
            lines: [
              ["Receptionist", "Thanks for calling BrightNest. I'm the virtual assistant, and this call may be recorded."],
              ["Caller", "We need a furnace tune-up before it gets cold."],
              ["Receptionist", "Friday between 8 and 10 AM is open in Denver. I can hold that for Chris to confirm."]
            ]
          }
        ],
        reviews: [],
        posts: [
          { when: "Not scheduled", channel: "Google Business Profile", text: "Fall furnace tune-ups are open in Denver and Boulder.", status: "Draft" }
        ],
        campaigns: [],
        contacts: 0,
        suppressed: 0,
        activity: [
          { time: "Sep 26", text: "Domain check failed for brightnest.example." },
          { time: "Sep 25", text: "Forwarding instructions sent to Chris. Client has not pressed Done." }
        ],
        checklist: checklist({
          number: item("connected", "(720) 555-0127 is active.", "Team"),
          test: item("connected", "AI number answers with the BrightNest greeting.", "Team"),
          forwarding: item("pending", "Instructions sent Sep 25. Waiting on Chris to dial *72 from the office line and press Done.", "Client"),
          calendar: item("connected", "A new booking calendar was created and linked. Test booking created and removed.", "Team"),
          texting: item("pending", textingHold, "Team"),
          email: item("pending", "SPF and DKIM not found yet. Records are ready to paste.", "Client"),
          reviews: item("pending", "Google review link is not on file.", "Team"),
          gbp: item("pending", "Profile exists. Manager invite not accepted.", "Client"),
          social: item("pending", "No Facebook or Instagram sign-in yet.", "Client"),
          website: item("action", "brightnest.example does not point at the new site. Update the domain record, then run Check domain.", "Client", { next: true }),
          billing: item("pending", "Pilot. Setup fee waived. Payment link sent, card not entered.", "Client")
        })
      },
      {
        id: "oak-thread",
        name: "Oak & Thread",
        category: "Retail",
        city: "Austin, TX",
        address: "33 Market Row, Austin, TX 78702",
        website: "oakandthread.example",
        hours: "Mon–Sat 11:00 AM – 6:00 PM",
        timezone: "Central Time",
        staff: 2,
        locations: 1,
        tier: "Solo",
        plan: "Starter",
        price: 199,
        minutesCap: 250,
        minutesUsed: 210,
        texts: 0,
        callsToday: 4,
        bookingsToday: 1,
        status: "waiting",
        pilot: false,
        setupFee: 299,
        card: "Visa ···· 4242",
        nextInvoice: "Oct 9, 2026 · $199",
        trial: "None",
        owner: { name: "Naomi Brooks", mobile: "(512) 555-0155", email: "naomi@oakandthread.example" },
        phone: {
          mode: "new",
          carrier: "",
          forwardType: "",
          businessNumber: "",
          aiNumber: "(512) 555-0177",
          tests: [
            { when: "Sep 15, 2026 · 3:02 PM", result: "Confirmed", note: "Greeting matched." }
          ]
        },
        greeting: "Thanks for calling Oak & Thread. I'm the virtual assistant, and this call may be recorded. I can share hours, book a styling visit, or reach the shop.",
        voice: "nora",
        languages: ["English"],
        transfer: "(512) 555-0155",
        capabilities: { book: true, reschedule: true, cancel: true, transfer: true, textLink: false },
        services: [
          { name: "Styling visit", length: "30 min", price: "No fee" },
          { name: "Alterations drop-off", length: "15 min", price: "Quote in shop" }
        ],
        faqs: [
          { q: "What do you sell?", a: "Everyday clothes and mending. Styling visits are 30 minutes and free." },
          { q: "Can I return something?", a: "Unworn items with the tag can be returned within 14 days. I can transfer you if you need a person to look up an order." },
          { q: "Are you open Sunday?", a: "Closed Sunday. Monday through Saturday, 11 to 6." }
        ],
        blurb: "Clothes and mending on Market Row.",
        template: "Retail",
        domainStatus: "oakandthread.example loads with a padlock.",
        reviewLink: "https://search.google.com/local/writereview?placeid=sample-oak",
        socialAccounts: { facebook: "", instagram: "@oakandthread", gbp: "Oak & Thread" },
        bookings: [
          { when: "Sat, Oct 4 · 1:00 PM", customer: "Lila Nguyen", service: "Styling visit", source: "Phone", status: "Confirmed" }
        ],
        calls: [
          {
            time: "8:27 AM",
            from: "(512) 555-0182",
            duration: "0:47",
            outcome: "Answered",
            flag: "",
            summary: "Confirmed Saturday hours. No booking.",
            lines: [
              ["Receptionist", "Thanks for calling Oak & Thread. I'm the virtual assistant, and this call may be recorded."],
              ["Caller", "Are you open today?"],
              ["Receptionist", "Yes. Today we're open from 11 to 6 on Market Row."]
            ]
          },
          {
            time: "Yesterday",
            from: "(737) 555-0111",
            duration: "1:10",
            outcome: "Booked",
            flag: "",
            summary: "Styling visit Saturday at 1:00 PM.",
            lines: [
              ["Caller", "Can someone help me pull a few outfits Saturday?"],
              ["Receptionist", "Saturday at 1:00 PM is open for a styling visit. I can book it under Lila Nguyen."]
            ]
          }
        ],
        reviews: [
          { author: "Evan Brooks", stars: 3, when: "Sep 21", text: "Cute shop. Took a while to get someone on the phone.", draft: "Thanks for the note, Evan. The line is answered for us now, and we'd love to help in person.", posted: false }
        ],
        posts: [
          { when: "Mon · 11:00 AM", channel: "Instagram", text: "New linen shirts are on the front table this week.", status: "Scheduled" }
        ],
        campaigns: [],
        contacts: 120,
        suppressed: 2,
        activity: [
          { time: "Sep 24", text: "Calendar sign-in link sent to Naomi. No approval yet." },
          { time: "8:27 AM", text: "Answered an hours call." }
        ],
        checklist: checklist({
          number: item("connected", "New number (512) 555-0177 is on the window and the website.", "Team"),
          test: item("connected", "Greeting matched on Sep 15.", "Team"),
          forwarding: item("connected", "Not used. The shop publishes the new number.", "Team"),
          calendar: item("action", "Waiting on client. Google sign-in link sent Sep 24 and reminded Sep 26. Naomi has not approved calendar access.", "Client", { next: true }),
          texting: item("pending", textingHold, "Team"),
          email: item("connected", "SPF and DKIM found for oakandthread.example.", "Team"),
          reviews: item("connected", "Review link opens the shop form.", "Team"),
          gbp: item("connected", "Team is a manager.", "Team"),
          social: item("pending", "Instagram @oakandthread is known. Facebook sign-in is not done.", "Client"),
          website: item("connected", "https://oakandthread.example loads with a padlock.", "Team"),
          billing: item("connected", "Starter subscription active.", "Team")
        })
      }
    ]
  };
})();
