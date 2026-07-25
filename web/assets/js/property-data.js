/* MakanOnRent — property data source (Phase 2, frontend only).
   TEMPORARY local fixture. Record shape mirrors docs/04 §2.3
   (property → unit → listing) so the API can replace this module
   without touching any renderer. Swap MOR_DATA.query() for a fetch()
   when the backend lands — the contract is the return shape. */
(function (root) {
  'use strict';

  var LISTINGS = [
    { id: 'L-LHR-1041', title: '10 Marla Upper Portion, Separate Entrance', category: 'homes', type: 'portion',
      city: 'Lahore', citySlug: 'lahore', area: 'Valencia Housing Society', areaSlug: 'valencia-town',
      rent: 165000, advance: 330000, beds: 5, baths: 6, carPorch: true, size: 10, sizeUnit: 'marla',
      verified: true, updatedAt: '2026-07-24T09:10:00Z', images: [],
      phone: '+923000000001', email: 'listings@makanonrent.pk',
      details: {
        'property-condition': [['Overall condition', 'Excellent'], ['Last renovated', '2024'], ['Flooring', 'Marble & tiles']],
        'kitchen': [['Kitchen type', 'Modern, fitted'], ['Cabinets', 'Wooden'], ['Chimney', 'Installed']],
        'bathrooms': [['Total bathrooms', '6'], ['Attached', '5'], ['Water heater', 'Gas geyser']],
        'electric-meter': [['Meter status', 'Separate meter installed'], ['Backup', 'UPS wiring done']],
        'gas-meter': [['Connection', 'Sui gas, separate meter']],
        'building-age': [['Construction year', '2019'], ['Age', '7 years']],
        'parking': [['Car porch', 'Available — 2 cars'], ['Street parking', 'Yes']],
        'nearby-schools': [['Nearest school', 'Within 1 km']],
        'nearby-mosque': [['Nearest mosque', 'Within 400 m']],
        'corner': [['Corner plot', 'Yes']]
      }
    },
    { id: 'L-LHR-1042', title: '5 Marla House in Johar Town Block J', category: 'homes', type: 'house',
      city: 'Lahore', citySlug: 'lahore', area: 'Johar Town', areaSlug: 'johar-town',
      rent: 95000, advance: 190000, beds: 3, baths: 3, carPorch: true, size: 5, sizeUnit: 'marla',
      verified: true, updatedAt: '2026-07-23T14:30:00Z', images: [],
      phone: '+923000000002', email: 'listings@makanonrent.pk',
      details: {
        'property-condition': [['Overall condition', 'Good'], ['Flooring', 'Tiles']],
        'building-age': [['Age', '10 years']],
        'parking': [['Car porch', 'Available — 1 car']],
        'nearby-market': [['Nearest market', 'Emporium area, 2 km']]
      }
    },
    { id: 'L-LHR-1043', title: '2 Bed Flat, Family Building', category: 'homes', type: 'flat',
      city: 'Lahore', citySlug: 'lahore', area: 'Bahria Town', areaSlug: 'bahria-town',
      rent: 55000, advance: 110000, beds: 2, baths: 2, carPorch: false, size: 1100, sizeUnit: 'sqft',
      verified: false, updatedAt: '2026-07-22T08:00:00Z', images: [],
      phone: '+923000000003', email: 'listings@makanonrent.pk', details: {} },
    { id: 'L-LHR-1044', title: 'Ground Portion for Small Family', category: 'homes', type: 'portion',
      city: 'Lahore', citySlug: 'lahore', area: 'Model Town', areaSlug: 'model-town',
      rent: 72000, advance: 144000, beds: 3, baths: 2, carPorch: true, size: 7, sizeUnit: 'marla',
      verified: true, updatedAt: '2026-07-25T06:20:00Z', images: [],
      phone: '+923000000004', email: 'listings@makanonrent.pk',
      details: { 'property-condition': [['Overall condition', 'Very good']], 'park-facing': [['Park facing', 'Yes']] } },
    { id: 'L-LHR-1045', title: '1 Kanal House, DHA Phase 6', category: 'homes', type: 'house',
      city: 'Lahore', citySlug: 'lahore', area: 'DHA Defence', areaSlug: 'dha-defence',
      rent: 425000, advance: 850000, beds: 6, baths: 7, carPorch: true, size: 20, sizeUnit: 'marla',
      verified: true, updatedAt: '2026-07-21T11:45:00Z', images: [],
      phone: '+923000000005', email: 'listings@makanonrent.pk',
      details: { 'property-condition': [['Overall condition', 'Excellent']], 'rooftop': [['Rooftop', 'Accessible, tiled']] } },
    { id: 'L-LHR-1046', title: 'Studio Room for Bachelors', category: 'homes', type: 'other',
      city: 'Lahore', citySlug: 'lahore', area: 'Garden Town', areaSlug: 'garden-town',
      rent: 28000, advance: 56000, beds: 1, baths: 1, carPorch: false, size: 450, sizeUnit: 'sqft',
      verified: false, updatedAt: '2026-07-20T16:00:00Z', images: [],
      phone: '+923000000006', email: 'listings@makanonrent.pk', details: {} },
    { id: 'L-LHR-2011', title: 'Corner Shop on Main Boulevard', category: 'commercial', type: 'shop',
      city: 'Lahore', citySlug: 'lahore', area: 'Gulberg', areaSlug: 'gulberg',
      rent: 220000, advance: 660000, beds: 0, baths: 1, carPorch: false, size: 400, sizeUnit: 'sqft',
      verified: true, updatedAt: '2026-07-24T13:05:00Z', images: [],
      phone: '+923000000007', email: 'listings@makanonrent.pk',
      details: { 'corner': [['Corner unit', 'Yes']], 'nearby-market': [['Location', 'Main commercial belt']] } },
    { id: 'L-LHR-2012', title: 'Furnished Office Floor, 6 Workstations', category: 'commercial', type: 'office',
      city: 'Lahore', citySlug: 'lahore', area: 'Johar Town', areaSlug: 'johar-town',
      rent: 185000, advance: 370000, beds: 0, baths: 2, carPorch: true, size: 1600, sizeUnit: 'sqft',
      verified: true, updatedAt: '2026-07-23T09:00:00Z', images: [],
      phone: '+923000000008', email: 'listings@makanonrent.pk',
      details: { 'electric-meter': [['Meter status', 'Commercial meter']], 'parking': [['Parking', 'Shared, 4 cars']] } },
    { id: 'L-LHR-2013', title: 'Ground Floor Room for Office Use', category: 'commercial', type: 'room',
      city: 'Lahore', citySlug: 'lahore', area: 'Faisal Town', areaSlug: 'faisal-town',
      rent: 45000, advance: 90000, beds: 0, baths: 1, carPorch: false, size: 250, sizeUnit: 'sqft',
      verified: false, updatedAt: '2026-07-19T10:00:00Z', images: [],
      phone: '+923000000009', email: 'listings@makanonrent.pk', details: {} },
    { id: 'L-KHI-3001', title: '3 Bed Apartment, Sea Facing Block', category: 'homes', type: 'flat',
      city: 'Karachi', citySlug: 'karachi', area: 'Clifton', areaSlug: 'clifton',
      rent: 210000, advance: 420000, beds: 3, baths: 3, carPorch: true, size: 1800, sizeUnit: 'sqft',
      verified: true, updatedAt: '2026-07-24T07:40:00Z', images: [],
      phone: '+923000000010', email: 'listings@makanonrent.pk',
      details: { 'property-condition': [['Overall condition', 'Excellent']], 'building-age': [['Age', '4 years']] } },
    { id: 'L-KHI-3002', title: '240 Sq Yd House, Quiet Lane', category: 'homes', type: 'house',
      city: 'Karachi', citySlug: 'karachi', area: 'Gulshan-e-Iqbal', areaSlug: 'gulshan-e-iqbal',
      rent: 130000, advance: 260000, beds: 4, baths: 4, carPorch: true, size: 2160, sizeUnit: 'sqft',
      verified: false, updatedAt: '2026-07-18T12:00:00Z', images: [],
      phone: '+923000000011', email: 'listings@makanonrent.pk', details: {} },
    { id: 'L-KHI-3003', title: 'Retail Shop, Main Tariq Road', category: 'commercial', type: 'shop',
      city: 'Karachi', citySlug: 'karachi', area: 'Tariq Road', areaSlug: 'tariq-road',
      rent: 340000, advance: 1020000, beds: 0, baths: 1, carPorch: false, size: 600, sizeUnit: 'sqft',
      verified: true, updatedAt: '2026-07-22T15:20:00Z', images: [],
      phone: '+923000000012', email: 'listings@makanonrent.pk', details: {} },
    { id: 'L-ISB-4001', title: '2 Bed Apartment in F-11 Markaz', category: 'homes', type: 'flat',
      city: 'Islamabad', citySlug: 'islamabad', area: 'F-11', areaSlug: 'f-11',
      rent: 150000, advance: 300000, beds: 2, baths: 2, carPorch: true, size: 1250, sizeUnit: 'sqft',
      verified: true, updatedAt: '2026-07-25T05:10:00Z', images: [],
      phone: '+923000000013', email: 'listings@makanonrent.pk',
      details: { 'property-condition': [['Overall condition', 'Excellent']], 'parking': [['Parking', 'Basement, allotted']] } },
    { id: 'L-ISB-4002', title: 'Upper Portion in G-11/3', category: 'homes', type: 'portion',
      city: 'Islamabad', citySlug: 'islamabad', area: 'G-11', areaSlug: 'g-11',
      rent: 90000, advance: 180000, beds: 3, baths: 3, carPorch: true, size: 7, sizeUnit: 'marla',
      verified: false, updatedAt: '2026-07-17T09:30:00Z', images: [],
      phone: '+923000000014', email: 'listings@makanonrent.pk', details: {} },
    { id: 'L-RWP-5001', title: '5 Marla House, Bahria Phase 8', category: 'homes', type: 'house',
      city: 'Rawalpindi', citySlug: 'rawalpindi', area: 'Bahria Town', areaSlug: 'bahria-town',
      rent: 85000, advance: 170000, beds: 3, baths: 3, carPorch: true, size: 5, sizeUnit: 'marla',
      verified: true, updatedAt: '2026-07-23T18:00:00Z', images: [],
      phone: '+923000000015', email: 'listings@makanonrent.pk', details: {} }
  ];

  /* Normalised size in sq ft — 1 marla ≈ 225 sq ft (Punjab standard). */
  function toSqft(rec) { return rec.sizeUnit === 'marla' ? rec.size * 225 : rec.size; }

  /* Filters a criteria object into a result set. Same signature the
     API client will expose, so renderers stay untouched. */
  function query(c) {
    c = c || {};
    var out = LISTINGS.filter(function (r) {
      if (c.city && r.citySlug !== c.city) return false;
      if (c.area && r.areaSlug !== c.area) return false;
      if (c.category && r.category !== c.category) return false;
      if (c.type && r.type !== c.type) return false;
      if (c.beds && r.beds < Number(c.beds)) return false;
      if (c.budgetMax && r.rent > Number(c.budgetMax)) return false;
      if (c.areaSize) {
        var want = c.areaUnit === 'sqft' ? Number(c.areaSize) : Number(c.areaSize) * 225;
        var have = toSqft(r);
        if (have < want * 0.75 || have > want * 1.35) return false;
      }
      if (c.sizePref) {
        var sq = toSqft(r);
        if (c.sizePref === 'small'  && sq > 700) return false;
        if (c.sizePref === 'medium' && (sq <= 700 || sq > 2000)) return false;
        if (c.sizePref === 'large'  && sq <= 2000) return false;
      }
      return true;
    });

    var sort = c.sort || 'recent';
    out.sort(function (a, b) {
      if (sort === 'low')  return a.rent - b.rent;
      if (sort === 'high') return b.rent - a.rent;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
    return out;
  }

  function byId(id) {
    return LISTINGS.filter(function (r) { return r.id === id; })[0] || null;
  }

  root.MOR_DATA = { query: query, byId: byId, toSqft: toSqft };
})(window);
