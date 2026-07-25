/* MakanOnRent — owner property data (frontend only).
   TEMPORARY fixture + a local override layer so archive / restore /
   availability actions survive a reload without a backend. Record
   shape follows docs/04 (listing) plus the owner-side fields the
   dashboard needs. Replace list()/update() with API calls later —
   the renderers read nothing else. */
(function (root) {
  'use strict';

  var CFG = root.MOR_CONFIG;

  function daysAgo(n) {
    return new Date(Date.now() - n * 86400000).toISOString();
  }

  /* status: pending_review | live | rejected | archived */
  var BASE = [
    {
      id: 'MOR-LHR-260722-4180', title: '10 Marla Upper Portion, Separate Entrance',
      city: 'Lahore', area: 'Valencia Housing Society', rent: 165000, type: 'portion',
      status: 'live', images: [], updatedAt: daysAgo(1), submittedAt: daysAgo(12),
      listingId: 'L-LHR-1041',
      availability: { state: 'confirmed', confirmedAt: daysAgo(2) },
      stats: { views: null, whatsapp: null, calls: null }
    },
    {
      id: 'MOR-LHR-260714-2287', title: '5 Marla House in Johar Town Block J',
      city: 'Lahore', area: 'Johar Town', rent: 95000, type: 'house',
      status: 'live', images: [], updatedAt: daysAgo(9), submittedAt: daysAgo(20),
      listingId: 'L-LHR-1042',
      availability: { state: 'due', confirmedAt: daysAgo(9) },
      stats: { views: null, whatsapp: null, calls: null }
    },
    {
      id: 'MOR-LHR-260724-6631', title: '2 Bed Flat, Family Building',
      city: 'Lahore', area: 'Bahria Town', rent: 55000, type: 'flat',
      status: 'pending_review', images: [], updatedAt: daysAgo(0), submittedAt: daysAgo(0),
      review: { stage: 'under_review' },
      availability: { state: 'not_applicable' },
      stats: { views: null, whatsapp: null, calls: null }
    },
    {
      id: 'MOR-ISB-260723-9014', title: 'Upper Portion in G-11/3',
      city: 'Islamabad', area: 'G-11', rent: 90000, type: 'portion',
      status: 'pending_review', images: [], updatedAt: daysAgo(1), submittedAt: daysAgo(1),
      review: { stage: 'submitted' },
      availability: { state: 'not_applicable' },
      stats: { views: null, whatsapp: null, calls: null }
    },
    {
      id: 'MOR-KHI-260718-3345', title: '240 Sq Yd House, Quiet Lane',
      city: 'Karachi', area: 'Gulshan-e-Iqbal', rent: 130000, type: 'house',
      status: 'rejected', images: [], updatedAt: daysAgo(4), submittedAt: daysAgo(6),
      review: {
        stage: 'rejected', reviewedAt: daysAgo(4),
        reasonCode: 'photos_unclear',
        reason: 'The photos were too dark to confirm the rooms. Please add daytime photos of every room, the kitchen and the entrance.'
      },
      availability: { state: 'not_applicable' },
      stats: { views: null, whatsapp: null, calls: null }
    },
    {
      id: 'MOR-LHR-260705-1120', title: 'Ground Floor Room for Office Use',
      city: 'Lahore', area: 'Faisal Town', rent: 45000, type: 'room',
      status: 'rejected', images: [], updatedAt: daysAgo(17), submittedAt: daysAgo(19),
      review: {
        stage: 'rejected', reviewedAt: daysAgo(17),
        reasonCode: 'owner_unreachable',
        reason: 'Our team called three times over two days and could not reach you. Please confirm a number where we can call between 10am and 6pm.'
      },
      availability: { state: 'not_applicable' },
      stats: { views: null, whatsapp: null, calls: null }
    },
    {
      id: 'MOR-LHR-260610-7702', title: 'Studio Room for Bachelors',
      city: 'Lahore', area: 'Garden Town', rent: 28000, type: 'other',
      status: 'archived', images: [], updatedAt: daysAgo(41), submittedAt: daysAgo(55),
      previousStatus: 'live',
      availability: { state: 'not_applicable' },
      stats: { views: null, whatsapp: null, calls: null }
    }
  ];

  /* ── local override layer ───────────────────────────────── */
  function readOverrides() {
    try { return JSON.parse(localStorage.getItem(CFG.storage.ownerOverrides) || '{}'); }
    catch (e) { return {}; }
  }
  function writeOverrides(o) {
    try { localStorage.setItem(CFG.storage.ownerOverrides, JSON.stringify(o)); } catch (e) {}
  }

  function merge(rec, patch) {
    var out = {};
    Object.keys(rec).forEach(function (k) { out[k] = rec[k]; });
    Object.keys(patch || {}).forEach(function (k) {
      out[k] = (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]))
        ? merge(rec[k] || {}, patch[k])
        : patch[k];
    });
    return out;
  }

  /* Availability is derived from the confirmation date so the future
     email service and this UI can never disagree about what is due. */
  function deriveAvailability(rec) {
    var a = rec.availability || {};
    if (rec.status !== 'live') return { state: 'not_applicable', confirmedAt: a.confirmedAt || null };
    if (!a.confirmedAt) return { state: 'due', confirmedAt: null };

    var cfg = CFG.owner.availability;
    var days = (Date.now() - new Date(a.confirmedAt).getTime()) / 86400000;
    var state = days <= cfg.windowDays ? 'confirmed'
              : days <= cfg.windowDays + cfg.graceDays ? 'due'
              : 'stale';
    return { state: state, confirmedAt: a.confirmedAt };
  }

  function list() {
    var ov = readOverrides();
    return BASE.map(function (r) {
      var rec = merge(r, ov[r.id]);
      rec.availability = deriveAvailability(rec);
      return rec;
    });
  }

  function byId(id) {
    return list().filter(function (r) { return r.id === id; })[0] || null;
  }

  function update(id, patch) {
    var ov = readOverrides();
    ov[id] = merge(ov[id] || {}, patch);
    ov[id].updatedAt = new Date().toISOString();
    writeOverrides(ov);
    return byId(id);
  }

  root.MOR_OWNER = { list: list, byId: byId, update: update };
})(window);
