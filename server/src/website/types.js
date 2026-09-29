'use strict';
// One preset per business type. Add a type by appending an object to PRESETS.
// Unknown or empty categories use DEFAULT_PRESET.
// Presets choose palette, icon, section order, headings, and button labels.
// They never supply reviews, prices, licences, or other facts about a business.

const DEFAULT_PRESET = {
  category: '',
  template: 'classic',
  accent: '#0e7c72',
  icon: 'neutral',
  emergency: false,
  bookEmphasis: false,
  emphasis: '',
  order: ['services', 'about', 'hours', 'reviews', 'visit', 'contact'],
  palette: {
    paper: '#f7f6f3',
    cream: '#efece6',
    ink: '#1e2a28',
    navy: '#1e2a28',
    night: '#16191c',
    muted: '#5c6562',
    line: '#e0ddd6',
    orange: '#99d5cc',
    white: '#ffffff'
  },
  copy: {
    servicesKicker: 'Services',
    servicesTitle: 'Services',
    servicesNote: 'These lines are samples to edit. Replace them with services you offer.',
    aboutKicker: 'About',
    hoursKicker: 'Hours',
    hoursTitle: 'Hours',
    reviewsKicker: 'Reviews',
    reviewsTitle: 'What customers say',
    visitKicker: 'Location',
    visitTitle: 'Visit',
    contactTitle: 'Get in touch',
    callButton: 'Call',
    bookLabel: 'Book now',
    nav: {
      services: 'Services',
      about: 'About',
      hours: 'Hours',
      reviews: 'Reviews',
      visit: 'Visit',
      contact: 'Contact'
    },
    ctaBoth: 'Call {name}{place}, or book a time.',
    ctaPhone: 'Call {name}{place}.',
    ctaBook: 'Book a time with {name}{place}.'
  },
  highlights: [
    { name: 'Service (edit this)', detail: 'Replace this with a service you offer.' }
  ]
};

const PRESETS = [
  {
    category: 'Dental',
    template: 'classic',
    accent: '#1d6fbf',
    icon: 'dental',
    emergency: false,
    bookEmphasis: false,
    emphasis: 'services',
    order: ['services', 'about', 'hours', 'contact', 'reviews', 'visit'],
    palette: {
      paper: '#f7fbff',
      cream: '#e7f2fb',
      ink: '#16324a',
      navy: '#16324a',
      night: '#0e2438',
      muted: '#4d6478',
      line: '#d5e4f2',
      orange: '#9fd0f5',
      white: '#ffffff'
    },
    copy: {
      servicesKicker: 'Care',
      servicesTitle: 'Care',
      servicesNote: 'These lines are samples to edit. They are not a list of treatments, prices, or reviews.',
      aboutKicker: 'About',
      hoursKicker: 'Hours',
      hoursTitle: 'Hours',
      reviewsKicker: 'Reviews',
      reviewsTitle: 'What patients say',
      visitKicker: 'Visit',
      visitTitle: 'Find the office',
      contactTitle: 'Book a visit',
      callButton: 'Call',
      bookLabel: 'Book a visit',
      nav: {
        services: 'Care',
        about: 'About',
        hours: 'Hours',
        reviews: 'Reviews',
        visit: 'Visit',
        contact: 'Book'
      },
      ctaBoth: 'Call {name}{place}, or book a visit.',
      ctaPhone: 'Call {name}{place}.',
      ctaBook: 'Book a visit with {name}{place}.'
    },
    highlights: [
      { name: 'Cleanings (edit this)', detail: 'Replace this with what a cleaning includes, only if you offer it.' },
      { name: 'Whitening (edit this)', detail: 'Replace this with how whitening works here, only if you offer it.' },
      { name: 'Cosmetic (edit this)', detail: 'Replace this with the cosmetic care you offer.' },
      { name: 'Emergency (edit this)', detail: 'Replace this with how to reach you for urgent care, only if you offer it.' }
    ]
  },
  {
    category: 'Clinic',
    template: 'classic',
    accent: '#0369a1',
    icon: 'clinic',
    emergency: false,
    bookEmphasis: false,
    emphasis: 'services',
    order: ['services', 'hours', 'contact', 'about', 'reviews', 'visit'],
    palette: {
      paper: '#f3f8f8',
      cream: '#e5f2f1',
      ink: '#1a3340',
      navy: '#1a3340',
      night: '#102830',
      muted: '#4a6268',
      line: '#d3e4e2',
      orange: '#7ec8c0',
      white: '#ffffff'
    },
    copy: {
      servicesKicker: 'Appointments',
      servicesTitle: 'Appointments',
      servicesNote: 'These lines are samples to edit. Mention insurance only if you actually accept it. Do not list health details here.',
      aboutKicker: 'About',
      hoursKicker: 'Hours',
      hoursTitle: 'Hours',
      reviewsKicker: 'Reviews',
      reviewsTitle: 'What patients say',
      visitKicker: 'Visit',
      visitTitle: 'Find the clinic',
      contactTitle: 'Book an appointment',
      callButton: 'Call',
      bookLabel: 'Book an appointment',
      nav: {
        services: 'Appointments',
        about: 'About',
        hours: 'Hours',
        reviews: 'Reviews',
        visit: 'Visit',
        contact: 'Book'
      },
      ctaBoth: 'Call {name}{place}, or book an appointment.',
      ctaPhone: 'Call {name}{place}.',
      ctaBook: 'Book an appointment with {name}{place}.'
    },
    highlights: [
      { name: 'Appointment (edit this)', detail: 'Replace this with a visit you offer.' },
      { name: 'Follow-up (edit this)', detail: 'Replace this if you want a second line. Add insurance only if you accept it.' }
    ]
  },
  {
    category: 'HVAC',
    template: 'modern',
    accent: '#e85d04',
    icon: 'hvac',
    emergency: true,
    bookEmphasis: false,
    emphasis: 'contact',
    order: ['contact', 'services', 'hours', 'about', 'reviews', 'visit'],
    palette: {
      paper: '#f4f1ec',
      cream: '#ebe4da',
      ink: '#1c1917',
      navy: '#1c1917',
      night: '#1a1d21',
      muted: '#5c574f',
      line: '#ddd4c8',
      orange: '#f59e0b',
      white: '#f7f6f4'
    },
    copy: {
      servicesKicker: 'Service',
      servicesTitle: 'Repair and installation',
      servicesNote: 'These lines are samples to edit. They are not a promise of hours, coverage, or a price.',
      aboutKicker: 'About',
      hoursKicker: 'Hours',
      hoursTitle: 'Hours',
      reviewsKicker: 'Reviews',
      reviewsTitle: 'What customers say',
      visitKicker: 'Service area',
      visitTitle: 'Find us',
      contactTitle: 'Need repair',
      callButton: 'Emergency call',
      bookLabel: 'Request service',
      nav: {
        services: 'Service',
        about: 'About',
        hours: 'Hours',
        reviews: 'Reviews',
        visit: 'Visit',
        contact: 'Emergency'
      },
      ctaBoth: 'Call {name}{place}, or request service.',
      ctaPhone: 'Call {name}{place}.',
      ctaBook: 'Request service from {name}{place}.'
    },
    highlights: [
      { name: '24/7 repair (edit this)', detail: 'Replace this if you do not offer round-the-clock repair.' },
      { name: 'Installation (edit this)', detail: 'Replace this with the systems you install.' },
      { name: 'Maintenance plans (edit this)', detail: 'Replace this with a plan you actually sell. No price until you add one.' }
    ]
  },
  {
    category: 'Home services',
    template: 'modern',
    accent: '#166534',
    icon: 'home',
    emergency: false,
    bookEmphasis: false,
    emphasis: 'services',
    order: ['services', 'contact', 'hours', 'about', 'reviews', 'visit'],
    palette: {
      paper: '#f4f7f2',
      cream: '#e7f0e4',
      ink: '#1c2e1f',
      navy: '#1c2e1f',
      night: '#142218',
      muted: '#4e6252',
      line: '#d5e3d4',
      orange: '#86b37a',
      white: '#ffffff'
    },
    copy: {
      servicesKicker: 'Work',
      servicesTitle: 'Work we do',
      servicesNote: 'These lines are samples to edit. Add licensing, insurance, or how estimates work only when that is true for you.',
      aboutKicker: 'About',
      hoursKicker: 'Hours',
      hoursTitle: 'Hours',
      reviewsKicker: 'Reviews',
      reviewsTitle: 'What customers say',
      visitKicker: 'Service area',
      visitTitle: 'Find us',
      contactTitle: 'Ask about an estimate',
      callButton: 'Call',
      bookLabel: 'Ask about an estimate',
      nav: {
        services: 'Work',
        about: 'About',
        hours: 'Hours',
        reviews: 'Reviews',
        visit: 'Visit',
        contact: 'Estimate'
      },
      ctaBoth: 'Call {name}{place}, or ask about an estimate.',
      ctaPhone: 'Call {name}{place}.',
      ctaBook: 'Ask {name}{place} about an estimate.'
    },
    highlights: [
      { name: 'Plumbing (edit this)', detail: 'Replace this with the work you do.' },
      { name: 'Electrical (edit this)', detail: 'Replace this with the work you do.' },
      { name: 'Cleaning (edit this)', detail: 'Replace this with the work you do.' }
    ]
  },
  {
    category: 'Salon',
    template: 'modern',
    accent: '#9d174d',
    icon: 'salon',
    emergency: false,
    bookEmphasis: true,
    emphasis: 'services',
    order: ['services', 'contact', 'about', 'hours', 'reviews', 'visit'],
    palette: {
      paper: '#fbf6f4',
      cream: '#f8ebe6',
      ink: '#3a2430',
      navy: '#3a2430',
      night: '#2a1822',
      muted: '#6d5560',
      line: '#eadfd8',
      orange: '#e8b4a2',
      white: '#fffaf8'
    },
    copy: {
      servicesKicker: 'Services',
      servicesTitle: 'Services',
      servicesNote: 'These lines are samples to edit. Add prices and stylist names only for services and people you want listed.',
      aboutKicker: 'About',
      hoursKicker: 'Hours',
      hoursTitle: 'Hours',
      reviewsKicker: 'Reviews',
      reviewsTitle: 'What guests say',
      visitKicker: 'Visit',
      visitTitle: 'Find the salon',
      contactTitle: 'Book now',
      callButton: 'Call',
      bookLabel: 'Book now',
      nav: {
        services: 'Services',
        about: 'About',
        hours: 'Hours',
        reviews: 'Reviews',
        visit: 'Visit',
        contact: 'Book'
      },
      ctaBoth: 'Call {name}{place}, or book now.',
      ctaPhone: 'Call {name}{place}.',
      ctaBook: 'Book now with {name}{place}.'
    },
    highlights: [
      { name: 'Cut (edit this)', detail: 'Replace this. Add a price only if you want it listed.' },
      { name: 'Color (edit this)', detail: 'Replace this. Add a price only if you want it listed.' },
      { name: 'Treatment (edit this)', detail: 'Replace this. Add a stylist name only if you want that person listed.' }
    ]
  },
  {
    category: 'Restaurant',
    template: 'classic',
    accent: '#c2410c',
    icon: 'restaurant',
    emergency: false,
    bookEmphasis: false,
    emphasis: 'hours',
    order: ['services', 'hours', 'visit', 'contact', 'about', 'reviews'],
    palette: {
      paper: '#fff8f1',
      cream: '#ffedd6',
      ink: '#2c2118',
      navy: '#2c2118',
      night: '#241910',
      muted: '#6b5748',
      line: '#eadccb',
      orange: '#ff9f43',
      white: '#fffdf9'
    },
    copy: {
      servicesKicker: 'Menu',
      servicesTitle: 'Menu highlights',
      servicesNote: 'These lines are samples to edit. They are not a menu and they are not prices.',
      aboutKicker: 'About',
      hoursKicker: 'Hours',
      hoursTitle: 'Hours',
      reviewsKicker: 'Reviews',
      reviewsTitle: 'What guests say',
      visitKicker: 'Visit',
      visitTitle: 'Find us',
      contactTitle: 'Reserve or order',
      callButton: 'Call',
      bookLabel: 'Reserve or order',
      nav: {
        services: 'Menu',
        about: 'About',
        hours: 'Hours',
        reviews: 'Reviews',
        visit: 'Visit',
        contact: 'Reserve'
      },
      ctaBoth: 'Call {name}{place}, or ask about a reservation or an order.',
      ctaPhone: 'Call {name}{place}.',
      ctaBook: 'Ask {name}{place} about a reservation or an order.'
    },
    highlights: [
      { name: 'Starter (edit this)', detail: 'Replace this with a dish you serve. Add a price only if you want it listed.' },
      { name: 'Main (edit this)', detail: 'Replace this with a dish you serve. Add a price only if you want it listed.' },
      { name: 'Sweet (edit this)', detail: 'Replace this with a dish you serve. Add a price only if you want it listed.' }
    ]
  },
  {
    category: 'Auto shop',
    template: 'modern',
    accent: '#1d4ed8',
    icon: 'auto',
    emergency: false,
    bookEmphasis: false,
    emphasis: 'services',
    order: ['services', 'contact', 'hours', 'about', 'reviews', 'visit'],
    palette: {
      paper: '#f4f6f8',
      cream: '#e8eef5',
      ink: '#1b2430',
      navy: '#1b2430',
      night: '#121820',
      muted: '#546170',
      line: '#d5dee8',
      orange: '#93c5fd',
      white: '#ffffff'
    },
    copy: {
      servicesKicker: 'Shop',
      servicesTitle: 'Repairs and inspections',
      servicesNote: 'These lines are samples to edit. No prices are filled in.',
      aboutKicker: 'About',
      hoursKicker: 'Hours',
      hoursTitle: 'Hours',
      reviewsKicker: 'Reviews',
      reviewsTitle: 'What customers say',
      visitKicker: 'Visit',
      visitTitle: 'Find the shop',
      contactTitle: 'Ask for a quote',
      callButton: 'Call',
      bookLabel: 'Ask for a quote',
      nav: {
        services: 'Repairs',
        about: 'About',
        hours: 'Hours',
        reviews: 'Reviews',
        visit: 'Visit',
        contact: 'Quote'
      },
      ctaBoth: 'Call {name}{place}, or ask for a quote.',
      ctaPhone: 'Call {name}{place}.',
      ctaBook: 'Ask {name}{place} for a quote.'
    },
    highlights: [
      { name: 'Repairs (edit this)', detail: 'Replace this with work you do. Do not invent a price.' },
      { name: 'Inspections (edit this)', detail: 'Replace this with inspections you offer.' },
      { name: 'Quotes (edit this)', detail: 'Replace this with how someone asks for a quote. A quote is not a price.' }
    ]
  },
  {
    category: 'Retail',
    template: 'classic',
    accent: '#6d28d9',
    icon: 'retail',
    emergency: false,
    bookEmphasis: false,
    emphasis: 'visit',
    order: ['services', 'visit', 'hours', 'about', 'reviews', 'contact'],
    palette: {
      paper: '#faf7ff',
      cream: '#f3eaff',
      ink: '#2a2140',
      navy: '#2a2140',
      night: '#1c1630',
      muted: '#645a78',
      line: '#e4dcf2',
      orange: '#d8b4fe',
      white: '#ffffff'
    },
    copy: {
      servicesKicker: 'Featured',
      servicesTitle: 'Featured',
      servicesNote: 'These lines are samples to edit. They are not products on your shelf.',
      aboutKicker: 'About',
      hoursKicker: 'Hours',
      hoursTitle: 'Hours',
      reviewsKicker: 'Reviews',
      reviewsTitle: 'What customers say',
      visitKicker: 'Visit',
      visitTitle: 'Visit us',
      contactTitle: 'Visit us',
      callButton: 'Call',
      bookLabel: 'Plan a visit',
      nav: {
        services: 'Featured',
        about: 'About',
        hours: 'Hours',
        reviews: 'Reviews',
        visit: 'Visit us',
        contact: 'Contact'
      },
      ctaBoth: 'Call {name}{place}, or plan a visit.',
      ctaPhone: 'Call {name}{place}.',
      ctaBook: 'Plan a visit to {name}{place}.'
    },
    highlights: [
      { name: 'Featured item (edit this)', detail: 'Replace this with a product you sell. Add a price only if you want it listed.' },
      { name: 'Another item (edit this)', detail: 'Replace this, or remove it in the panel.' }
    ]
  },
  {
    category: 'Professional services',
    template: 'classic',
    accent: '#0f766e',
    icon: 'professional',
    emergency: false,
    bookEmphasis: false,
    emphasis: 'services',
    order: ['about', 'services', 'contact', 'hours', 'reviews', 'visit'],
    palette: {
      paper: '#f6f8f7',
      cream: '#e7f3f1',
      ink: '#1c2c2a',
      navy: '#1c2c2a',
      night: '#12211f',
      muted: '#4e6360',
      line: '#d5e4e1',
      orange: '#7dcec4',
      white: '#ffffff'
    },
    copy: {
      servicesKicker: 'Consultations',
      servicesTitle: 'Consultations',
      servicesNote: 'These lines are samples to edit. Add credentials only when you want them listed. Nothing here is a licence or a review.',
      aboutKicker: 'About',
      hoursKicker: 'Hours',
      hoursTitle: 'Hours',
      reviewsKicker: 'Reviews',
      reviewsTitle: 'What clients say',
      visitKicker: 'Visit',
      visitTitle: 'Find the office',
      contactTitle: 'Book a consultation',
      callButton: 'Call',
      bookLabel: 'Book a consultation',
      nav: {
        services: 'Consultations',
        about: 'About',
        hours: 'Hours',
        reviews: 'Reviews',
        visit: 'Visit',
        contact: 'Book'
      },
      ctaBoth: 'Call {name}{place}, or book a consultation.',
      ctaPhone: 'Call {name}{place}.',
      ctaBook: 'Book a consultation with {name}{place}.'
    },
    highlights: [
      { name: 'Consultation (edit this)', detail: 'Replace this with the conversation you offer.' },
      { name: 'Follow-up (edit this)', detail: 'Replace this if you want a second line. Add a credential only if you want it listed.' }
    ]
  },
  {
    category: 'Studio',
    template: 'modern',
    accent: '#4338ca',
    icon: 'studio',
    emergency: false,
    bookEmphasis: false,
    emphasis: 'services',
    order: ['services', 'hours', 'contact', 'about', 'reviews', 'visit'],
    palette: {
      paper: '#f7f6ff',
      cream: '#ece9ff',
      ink: '#1e1b4b',
      navy: '#1e1b4b',
      night: '#16143a',
      muted: '#5b5780',
      line: '#ddd8f5',
      orange: '#a5b4fc',
      white: '#ffffff'
    },
    copy: {
      servicesKicker: 'Classes',
      servicesTitle: 'Classes',
      servicesNote: 'These lines are samples to edit. Add the real schedule in Hours. No prices are filled in.',
      aboutKicker: 'About',
      hoursKicker: 'Schedule',
      hoursTitle: 'Schedule',
      reviewsKicker: 'Reviews',
      reviewsTitle: 'What students say',
      visitKicker: 'Visit',
      visitTitle: 'Find the studio',
      contactTitle: 'Book a class',
      callButton: 'Call',
      bookLabel: 'Book a class',
      nav: {
        services: 'Classes',
        about: 'About',
        hours: 'Schedule',
        reviews: 'Reviews',
        visit: 'Visit',
        contact: 'Book'
      },
      ctaBoth: 'Call {name}{place}, or book a class.',
      ctaPhone: 'Call {name}{place}.',
      ctaBook: 'Book a class with {name}{place}.'
    },
    highlights: [
      { name: 'Group class (edit this)', detail: 'Replace this with a class you teach and when it meets.' },
      { name: 'Private session (edit this)', detail: 'Replace this if you offer one-to-one time.' }
    ]
  }
];

// Clear synonyms only. Anything else, including a blank category, stays on the neutral preset.
const ALIASES = {
  medical: 'Clinic',
  spa: 'Salon',
  yoga: 'Studio',
  fitness: 'Studio'
};

function svg(inner) {
  return '<svg class="motif" viewBox="0 0 64 64" aria-hidden="true">' + inner + '</svg>';
}

const ICONS = {
  dental: svg('<path fill="currentColor" d="M32 6c7.2 0 13 5.2 14.2 12.4.8 4.6.2 9.2-1.2 15.2-1.6 7.2-2.4 13.2-4.2 18.2-1 2.6-2.8 3.4-4.2 1.6-1.2-1.6-1.8-5.2-2.2-8.4-.2-2.2-.8-3-2.4-3s-2.2.8-2.4 3c-.4 3.2-1 6.8-2.2 8.4-1.4 1.8-3.2 1-4.2-1.6-1.8-5-2.6-11-4.2-18.2-1.4-6-2-10.6-1.2-15.2C19 11.2 24.8 6 32 6z"/>'),
  clinic: svg('<path fill="currentColor" d="M26 4h12v22h22v12H38v22H26V38H4V26h22V4z"/>'),
  hvac: svg('<path fill="currentColor" d="M30 2h4v16h-4zm0 44h4v16h-4zM2 30h16v4H2zm44 0h16v4H46z"/><path fill="currentColor" d="M12 10l12 12-3 3L9 13zm32 32 12 12-3 3-12-12zM52 10 40 22l-3-3 12-12zM24 40 12 52l-3-3 12-12z"/><path fill="currentColor" fill-rule="evenodd" d="M32 22a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 6a4 4 0 1 0 .01 0z"/>'),
  home: svg('<path fill="currentColor" fill-rule="evenodd" d="M32 6 58 30h-8v28H14V30H6L32 6zm-4 52V40h8v18h-8z"/>'),
  salon: svg('<path fill="currentColor" d="M32 6c8 10 18 18 18 30a18 18 0 1 1-36 0C14 24 24 16 32 6z"/>'),
  restaurant: svg('<path fill="currentColor" fill-rule="evenodd" d="M32 6c14.4 0 26 11.6 26 26S46.4 58 32 58 6 46.4 6 32 17.6 6 32 6zm0 10c8.8 0 16 7.2 16 16s-7.2 16-16 16-16-7.2-16-16 7.2-16 16-16z"/>'),
  auto: svg('<path fill="currentColor" d="M10 34l8-14h28l8 14v6H10v-6z"/><path fill="currentColor" d="M8 40h48v8H8z"/><circle cx="18" cy="50" r="6" fill="currentColor"/><circle cx="46" cy="50" r="6" fill="currentColor"/>'),
  retail: svg('<path fill="currentColor" d="M18 22h28l4 34H14l4-34z"/><path fill="currentColor" d="M24 22v-4a8 8 0 0 1 16 0v4h-4v-4a4 4 0 0 0-8 0v4h-4z"/>'),
  professional: svg('<path fill="currentColor" fill-rule="evenodd" d="M16 8h32v48H16V8zm6 12h20v4H22v-4zm0 10h20v4H22v-4zm0 10h14v4H22v-4z"/>'),
  studio: svg('<circle cx="32" cy="12" r="6" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" d="M32 20v16M32 28 18 22M32 28l14-6M32 36 20 56M32 36l12 20"/>'),
  neutral: svg('<path fill="currentColor" fill-rule="evenodd" d="M32 6c14.4 0 26 11.6 26 26S46.4 58 32 58 6 46.4 6 32 17.6 6 32 6zm0 12c7.7 0 14 6.3 14 14s-6.3 14-14 14-14-6.3-14-14 6.3-14 14-14z"/>')
};

const BY_CATEGORY = {};
PRESETS.forEach((preset) => {
  BY_CATEGORY[preset.category] = preset;
});

function presetFor(category) {
  const name = String(category || '').replace(/\s+/g, ' ').trim();
  if (!name) return DEFAULT_PRESET;
  if (BY_CATEGORY[name]) return BY_CATEGORY[name];
  const lower = name.toLowerCase();
  const exact = PRESETS.find((preset) => preset.category.toLowerCase() === lower);
  if (exact) return exact;
  const alias = ALIASES[lower];
  if (alias && BY_CATEGORY[alias]) return BY_CATEGORY[alias];
  return DEFAULT_PRESET;
}

function iconSvg(icon) {
  return ICONS[icon] || ICONS.neutral;
}

module.exports = {
  DEFAULT_PRESET,
  PRESETS,
  ALIASES,
  presetFor,
  iconSvg
};
