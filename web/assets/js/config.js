/* MakanOnRent — frontend configuration & constants (single source).
   Route shape follows the public URL contract in docs/13 §4.1.
   Change routing or storage keys here only — never inline. */
(function (root) {
  'use strict';

  root.MOR_CONFIG = {
    routes: {
      /* Listing results page: {base}/{city}[/{area}] */
      listingBase: '/rent',
      /* Slug used when no city is selected (nationwide results). */
      allCitiesSlug: 'pakistan',
      /* Static hosting has no path rewrites yet, so routes resolve to real
         files. Flip to false once the server maps /rent/{city}/{area}. */
      useStaticRoutes: true,
      listingPage: 'rent.html',
      detailsPage: 'property.html',
      submitPage: 'submit.html',
      dashboardPage: 'dashboard.html',
      /* Cloudflare Pages Functions — same-origin, relative paths.
         See functions/api/*.js. No secrets ever live in this file. */
      api: {
        presign: '/api/uploads/presign',
        submitProperty: '/api/properties/submit',
        locations: '/api/locations',
        locationsPublish: '/api/locations/publish',
        locationsSuggest: '/api/locations/suggest'
      },
      locationManagerPage: 'location-manager.html',
      /* Query-parameter names accepted by the listing page. */
      params: {
        budgetMax: 'budget_max',
        category:  'category',
        type:      'type',
        beds:      'beds',
        areaSize:  'area_size',
        areaUnit:  'area_unit',
        sizePref:  'size_pref'
      }
    },

    storage: {
      /* sessionStorage — criteria handed to the results page. */
      lastSearch: 'mor:lastSearch',
      /* localStorage — queued alert requests pending backend. */
      alertQueue: 'mor:alertQueue',
      /* localStorage — favourites held locally until accounts exist. */
      favourites: 'mor:favourites',
      /* localStorage — grid | list preference. */
      viewMode: 'mor:viewMode',
      /* sessionStorage — result set to return to from a details page. */
      lastResultsUrl: 'mor:lastResultsUrl',
      /* localStorage — in-progress submission, so a dropped connection
         never costs the owner their work. Files are never stored. */
      submitDraft: 'mor:submitDraft',
      /* localStorage — submitted references pending backend handover. */
      submissions: 'mor:submissions',
      /* localStorage — owner actions (archive, restore, availability)
         held locally until the owner API exists. */
      ownerOverrides: 'mor:ownerOverrides',
      /* localStorage — last 5 locations picked in any search field. */
      locationRecents: 'mor:locationRecents',
      /* localStorage — the published Location Data Bank (main areas +
         sub areas added via location-manager.html). Hydrated into the
         search engine on every page load; see location-bank.js. */
      locationBank: 'mor:locationBank',
      /* localStorage — admin add/rename/disable/merge action log,
         replayed onto the fixture at load until a backend exists. */
      locationOverrides: 'mor:locationOverrides',
      /* localStorage — notification preferences, read by the future
         email service; nothing is sent from the client. */
      notifyPrefs: 'mor:notifyPrefs'
    },

    search: {
      pageSize: 9,
      /* At or below this many matches the results page offers alerts. */
      lowResultThreshold: 5,
      /* Renders the loading state while the data source is local.
         Set to 0 when a real API supplies the latency. */
      simulatedLatencyMs: 420
    },

    submit: {
      referencePrefix: 'MOR',
      /* Shown to the owner on the confirmation screen. */
      reviewHours: 24,
      maxImages: 20,
      maxVideos: 5,
      imageMaxMB: 15,
      videoMaxMB: 100,
      /* Image optimisation runs server-side once uploads exist. The
         client already declares the variants it expects back, so the
         pipeline can be switched on without touching the wizard. */
      imageOptimization: {
        enabled: true,
        variants: ['thumb', 'card', 'gallery'],
        format: 'webp',
        maxEdgePx: 2000
      }
    },

    owner: {
      /* Availability confirmation. The daily email/cron service is NOT
         built yet — these values define the contract it will drive:
         a listing whose availability was confirmed longer ago than
         `windowDays` is shown as due, and `graceDays` later it is
         treated as stale. The card already renders every state. */
      availability: {
        windowDays: 7,
        graceDays: 3,
        states: ['confirmed', 'due', 'stale', 'not_applicable']
      },
      /* Shown on the review timeline. */
      reviewHours: 24
    },

    location: {
      /* Search result cap and the recent-locations cap (spec: max 5). */
      searchLimit: 8,
      recentLimit: 5,
      /* Token-index bucket width — see location-engine.js §Indexing. */
      bucketChars: 2
    },

    /* PKR today; the selector is currency-ready for expansion. */
    currencies: [
      { code: 'PKR', symbol: 'Rs',  label: 'Pakistani Rupee', default: true },
      { code: 'USD', symbol: '$',   label: 'US Dollar' },
      { code: 'GBP', symbol: '£',   label: 'British Pound' },
      { code: 'EUR', symbol: '€',   label: 'Euro' },
      { code: 'AED', symbol: 'AED', label: 'UAE Dirham' },
      { code: 'SAR', symbol: 'SAR', label: 'Saudi Riyal' }
    ]
  };
})(window);
