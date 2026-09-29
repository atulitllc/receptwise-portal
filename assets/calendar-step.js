// Calendar step copy for the add-business wizard. No network calls.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RWCalendarStep = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  var CHOICES = [
    { id: "google", provider: "google", title: "Google Calendar", detail: "Owner approves with one sign-in link." },
    { id: "microsoft", provider: "microsoft", title: "Microsoft Outlook", detail: "Some work accounts need an IT admin." },
    { id: "cal", provider: "calcom", title: "Cal.com", detail: "Bookings use an event type and an API key." },
    { id: "square", provider: "square", title: "Square Appointments", detail: "Works when they pay for Plus or Premium." },
    { id: "vagaro", provider: "vagaro", title: "Vagaro", detail: "Needs their paid plan and a short review." },
    { id: "fresha", provider: "fresha", title: "Fresha", detail: "No public connection. Text their booking link." },
    { id: "booksy", provider: "booksy", title: "Booksy", detail: "No public connection. Text their booking link." },
    { id: "none", provider: "none", title: "None / take messages", detail: "The receptionist does not book a time." }
  ];

  function byId(choice) {
    for (var i = 0; i < CHOICES.length; i++) if (CHOICES[i].id === choice) return CHOICES[i];
    return null;
  }

  function providerId(choice) {
    if (choice === "calcom" || choice === "cal") return "calcom";
    var row = byId(choice);
    return row ? row.provider : "";
  }

  function choiceValue(provider) {
    if (!provider || provider === "google") return "google";
    if (provider === "calcom" || provider === "cal") return "cal";
    return byId(provider) ? provider : "google";
  }

  // Stored on businesses.profile.calendar. The API key is never part of this object.
  function profile(choice, eventTypeId) {
    var provider = providerId(choice);
    if (!provider) return null;
    var out = { provider: provider };
    if (provider === "calcom") out.calcomEventTypeId = String(eventTypeId || "").trim();
    return out;
  }

  function describe(choice) {
    var provider = providerId(choice) || "google";
    if (provider === "google") {
      return {
        provider: provider,
        signIn: true,
        title: "Google Calendar",
        button: "Send the calendar sign-in link",
        note: "After they approve, the panel reads free times, creates a test booking, and deletes it.",
        steps: [],
        keyField: false,
        eventTypeField: false,
        checklist: "Sign-in link is ready to send."
      };
    }
    if (provider === "microsoft") {
      return {
        provider: provider,
        signIn: true,
        title: "Microsoft Outlook",
        button: "Send the calendar sign-in link",
        note: "Send the owner a calendar sign-in link. Some work accounts need an IT admin to allow the connection.",
        steps: [],
        keyField: false,
        eventTypeField: false,
        checklist: "Sign-in link is ready to send. Some work accounts need an IT admin."
      };
    }
    if (provider === "calcom") {
      return {
        provider: provider,
        signIn: false,
        title: "Cal.com",
        button: "",
        note: "The receptionist books the Cal.com event type you enter below.",
        steps: [
          "In Cal.com, create an event type for bookings (for example, 20-minute demo).",
          "In Cal.com, open Settings > Developer > API keys and create an API key.",
          "Paste the API key here. On the live control panel it is stored encrypted and is not shown again.",
          "On the Bookings tab, Show event types loads them from Cal.com so you can pick one, for example 20 min demo."
        ],
        keyField: true,
        eventTypeField: true,
        checklist: "Cal.com API key and event type. The receptionist books that event type."
      };
    }
    if (provider === "square") {
      return {
        provider: provider,
        signIn: false,
        title: "Square Appointments",
        button: "",
        note: "Square Appointments takes bookings when the business pays for Plus or Premium. Ask them to confirm that plan.",
        steps: [],
        keyField: false,
        eventTypeField: false,
        checklist: "Square Appointments needs Plus or Premium."
      };
    }
    if (provider === "vagaro") {
      return {
        provider: provider,
        signIn: false,
        title: "Vagaro",
        button: "",
        note: "Vagaro needs their paid plan, and a connection needs a short review. Until then, the receptionist takes a message.",
        steps: [],
        keyField: false,
        eventTypeField: false,
        checklist: "Vagaro needs their paid plan. Until a connection is reviewed, the receptionist takes a message."
      };
    }
    if (provider === "fresha" || provider === "booksy") {
      var name = provider === "fresha" ? "Fresha" : "Booksy";
      return {
        provider: provider,
        signIn: false,
        title: name,
        button: "",
        note: name + " has no public connection. The receptionist texts the business’s booking link instead of booking on the call.",
        steps: [],
        keyField: false,
        eventTypeField: false,
        checklist: name + " has no public connection. Text their booking link."
      };
    }
    return {
      provider: "none",
      signIn: false,
      title: "None / take messages",
      button: "",
      note: "No calendar is connected. The receptionist takes a message and the team calls back. It does not book a time.",
      steps: [],
      keyField: false,
      eventTypeField: false,
      checklist: "No calendar. The receptionist takes a message."
    };
  }

  return {
    choices: function () { return CHOICES.map(function (row) { return { id: row.id, title: row.title, detail: row.detail }; }); },
    providerId: providerId,
    choiceValue: choiceValue,
    profile: profile,
    describe: describe
  };
});
