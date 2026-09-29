// Public voice labels for the wizard and Receptionist tab.
// Provider ids live in server/src/voices.js, which is what publish sends to Vapi.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RW_VOICES = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  return [
    { key: "nora", name: "Nora", gender: "female", description: "Female, American English, calm and natural. Default." },
    { key: "sarah", name: "Sarah", gender: "female", description: "Female, American, mature and soft." },
    { key: "jessica", name: "Jessica", gender: "female", description: "Female, young, bright, American." },
    { key: "laura", name: "Laura", gender: "female", description: "Female, young, upbeat, American." },
    { key: "lily", name: "Lily", gender: "female", description: "Female, young, warm, British." }
  ];
});
