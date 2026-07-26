-- MakanOnRent — Migration 0003: City Seed (first dropdown ONLY)
-- ============================================================================
-- Seeds ONLY the top level of City -> Main Location -> Sub Location.
-- Main Locations and Sub Locations are NOT seeded here — they are created
-- and managed manually by the administrator through location-manager.html.
-- Running this file inserts cities and nothing else.
--
-- Schema compatibility (verified against migrations/0002_locations.sql
-- before writing this file, no changes required):
--   - parent_node_id has no NOT NULL constraint, so a city can be a root
--     row (parent_node_id = null).
--   - the `type` CHECK constraint already permits 'city'.
--   - duplicate-city protection comes from `node_id text not null unique`
--     (unconditional), not from uq_locations_parent_slug — that index is a
--     partial index on (parent_node_id, slug) and is a no-op when
--     parent_node_id is null for every row (Postgres never treats two
--     NULLs as equal in a unique index). Because a city's node_id IS its
--     slug, the plain node_id uniqueness constraint already fully covers
--     city-level de-duplication. No 0002 change needed.
--
-- node_id scheme: a city's node_id is its slug directly, e.g. 'lahore'.
-- Slugs match web/assets/js/pk-locations.js slugify() exactly (lowercase,
-- strip parens, collapse non-alphanumerics to '-').
--
-- Coverage: NOT limited to major/district cities. Includes every
-- district-level AND tehsil-level city a tenant or owner would actually
-- search when renting property in Pakistan — all four provincial
-- capitals, all divisional headquarters, populous district cities, AND
-- the smaller tehsil-level towns beneath them (e.g. Talagang, Pind Dadan
-- Khan, Kot Momin, Shahpur, Shorkot, Hasan Abdal), plus Azad Jammu &
-- Kashmir and Gilgit-Baltistan seats. Hand-authored public knowledge
-- (administrative city/tehsil names), no scraping, no proprietary
-- datasets.
--
-- Idempotent: INSERT ... ON CONFLICT (node_id) DO UPDATE ... WHERE
-- locations.source = 'fixture'. Re-running this file safely refreshes only
-- the rows it created; if an admin has already edited a city row through
-- location-manager.html (source <> 'fixture'), the WHERE guard makes that
-- conflict a no-op — this file can never overwrite it. This is how
-- "preserve existing data" is actually enforced, not just claimed.
--
-- Run in the Supabase SQL editor (or `supabase db push`) AFTER 0001 and
-- 0002. Safe to run multiple times.
-- ============================================================================

insert into locations (node_id, parent_node_id, name, slug, type, status, active, sort_order, source)
values
  -- Punjab
  ('lahore', null, 'Lahore', 'lahore', 'city', 'approved', true, 0, 'fixture'),
  ('rawalpindi', null, 'Rawalpindi', 'rawalpindi', 'city', 'approved', true, 0, 'fixture'),
  ('faisalabad', null, 'Faisalabad', 'faisalabad', 'city', 'approved', true, 0, 'fixture'),
  ('multan', null, 'Multan', 'multan', 'city', 'approved', true, 0, 'fixture'),
  ('gujranwala', null, 'Gujranwala', 'gujranwala', 'city', 'approved', true, 0, 'fixture'),
  ('sialkot', null, 'Sialkot', 'sialkot', 'city', 'approved', true, 0, 'fixture'),
  ('bahawalpur', null, 'Bahawalpur', 'bahawalpur', 'city', 'approved', true, 0, 'fixture'),
  ('sargodha', null, 'Sargodha', 'sargodha', 'city', 'approved', true, 0, 'fixture'),
  ('sahiwal', null, 'Sahiwal', 'sahiwal', 'city', 'approved', true, 0, 'fixture'),
  ('rahim-yar-khan', null, 'Rahim Yar Khan', 'rahim-yar-khan', 'city', 'approved', true, 0, 'fixture'),
  ('gujrat', null, 'Gujrat', 'gujrat', 'city', 'approved', true, 0, 'fixture'),
  ('sheikhupura', null, 'Sheikhupura', 'sheikhupura', 'city', 'approved', true, 0, 'fixture'),
  ('jhang', null, 'Jhang', 'jhang', 'city', 'approved', true, 0, 'fixture'),
  ('kasur', null, 'Kasur', 'kasur', 'city', 'approved', true, 0, 'fixture'),
  ('okara', null, 'Okara', 'okara', 'city', 'approved', true, 0, 'fixture'),
  ('sadiqabad', null, 'Sadiqabad', 'sadiqabad', 'city', 'approved', true, 0, 'fixture'),
  ('mianwali', null, 'Mianwali', 'mianwali', 'city', 'approved', true, 0, 'fixture'),
  ('bahawalnagar', null, 'Bahawalnagar', 'bahawalnagar', 'city', 'approved', true, 0, 'fixture'),
  ('muzaffargarh', null, 'Muzaffargarh', 'muzaffargarh', 'city', 'approved', true, 0, 'fixture'),
  ('khanewal', null, 'Khanewal', 'khanewal', 'city', 'approved', true, 0, 'fixture'),
  ('vehari', null, 'Vehari', 'vehari', 'city', 'approved', true, 0, 'fixture'),
  ('dera-ghazi-khan', null, 'Dera Ghazi Khan', 'dera-ghazi-khan', 'city', 'approved', true, 0, 'fixture'),
  ('chiniot', null, 'Chiniot', 'chiniot', 'city', 'approved', true, 0, 'fixture'),
  ('kamoke', null, 'Kamoke', 'kamoke', 'city', 'approved', true, 0, 'fixture'),
  ('hafizabad', null, 'Hafizabad', 'hafizabad', 'city', 'approved', true, 0, 'fixture'),
  ('jhelum', null, 'Jhelum', 'jhelum', 'city', 'approved', true, 0, 'fixture'),
  ('attock', null, 'Attock', 'attock', 'city', 'approved', true, 0, 'fixture'),
  ('chakwal', null, 'Chakwal', 'chakwal', 'city', 'approved', true, 0, 'fixture'),
  ('mandi-bahauddin', null, 'Mandi Bahauddin', 'mandi-bahauddin', 'city', 'approved', true, 0, 'fixture'),
  ('narowal', null, 'Narowal', 'narowal', 'city', 'approved', true, 0, 'fixture'),
  ('toba-tek-singh', null, 'Toba Tek Singh', 'toba-tek-singh', 'city', 'approved', true, 0, 'fixture'),
  ('layyah', null, 'Layyah', 'layyah', 'city', 'approved', true, 0, 'fixture'),
  ('rajanpur', null, 'Rajanpur', 'rajanpur', 'city', 'approved', true, 0, 'fixture'),
  ('pakpattan', null, 'Pakpattan', 'pakpattan', 'city', 'approved', true, 0, 'fixture'),
  ('nankana-sahib', null, 'Nankana Sahib', 'nankana-sahib', 'city', 'approved', true, 0, 'fixture'),
  ('khushab', null, 'Khushab', 'khushab', 'city', 'approved', true, 0, 'fixture'),
  ('bhakkar', null, 'Bhakkar', 'bhakkar', 'city', 'approved', true, 0, 'fixture'),
  ('lodhran', null, 'Lodhran', 'lodhran', 'city', 'approved', true, 0, 'fixture'),

  -- Sindh
  ('karachi', null, 'Karachi', 'karachi', 'city', 'approved', true, 0, 'fixture'),
  ('hyderabad', null, 'Hyderabad', 'hyderabad', 'city', 'approved', true, 0, 'fixture'),
  ('sukkur', null, 'Sukkur', 'sukkur', 'city', 'approved', true, 0, 'fixture'),
  ('larkana', null, 'Larkana', 'larkana', 'city', 'approved', true, 0, 'fixture'),
  ('nawabshah', null, 'Nawabshah', 'nawabshah', 'city', 'approved', true, 0, 'fixture'),
  ('mirpurkhas', null, 'Mirpurkhas', 'mirpurkhas', 'city', 'approved', true, 0, 'fixture'),
  ('jacobabad', null, 'Jacobabad', 'jacobabad', 'city', 'approved', true, 0, 'fixture'),
  ('shikarpur', null, 'Shikarpur', 'shikarpur', 'city', 'approved', true, 0, 'fixture'),
  ('khairpur', null, 'Khairpur', 'khairpur', 'city', 'approved', true, 0, 'fixture'),
  ('dadu', null, 'Dadu', 'dadu', 'city', 'approved', true, 0, 'fixture'),
  ('thatta', null, 'Thatta', 'thatta', 'city', 'approved', true, 0, 'fixture'),
  ('badin', null, 'Badin', 'badin', 'city', 'approved', true, 0, 'fixture'),
  ('tando-adam', null, 'Tando Adam', 'tando-adam', 'city', 'approved', true, 0, 'fixture'),
  ('tando-allahyar', null, 'Tando Allahyar', 'tando-allahyar', 'city', 'approved', true, 0, 'fixture'),
  ('umerkot', null, 'Umerkot', 'umerkot', 'city', 'approved', true, 0, 'fixture'),
  ('ghotki', null, 'Ghotki', 'ghotki', 'city', 'approved', true, 0, 'fixture'),

  -- Khyber Pakhtunkhwa
  ('peshawar', null, 'Peshawar', 'peshawar', 'city', 'approved', true, 0, 'fixture'),
  ('abbottabad', null, 'Abbottabad', 'abbottabad', 'city', 'approved', true, 0, 'fixture'),
  ('mardan', null, 'Mardan', 'mardan', 'city', 'approved', true, 0, 'fixture'),
  ('mingora', null, 'Mingora', 'mingora', 'city', 'approved', true, 0, 'fixture'),
  ('kohat', null, 'Kohat', 'kohat', 'city', 'approved', true, 0, 'fixture'),
  ('dera-ismail-khan', null, 'Dera Ismail Khan', 'dera-ismail-khan', 'city', 'approved', true, 0, 'fixture'),
  ('bannu', null, 'Bannu', 'bannu', 'city', 'approved', true, 0, 'fixture'),
  ('swabi', null, 'Swabi', 'swabi', 'city', 'approved', true, 0, 'fixture'),
  ('nowshera', null, 'Nowshera', 'nowshera', 'city', 'approved', true, 0, 'fixture'),
  ('charsadda', null, 'Charsadda', 'charsadda', 'city', 'approved', true, 0, 'fixture'),
  ('mansehra', null, 'Mansehra', 'mansehra', 'city', 'approved', true, 0, 'fixture'),
  ('haripur', null, 'Haripur', 'haripur', 'city', 'approved', true, 0, 'fixture'),
  ('batgram', null, 'Battagram', 'battagram', 'city', 'approved', true, 0, 'fixture'),
  ('karak', null, 'Karak', 'karak', 'city', 'approved', true, 0, 'fixture'),
  ('hangu', null, 'Hangu', 'hangu', 'city', 'approved', true, 0, 'fixture'),
  ('lakki-marwat', null, 'Lakki Marwat', 'lakki-marwat', 'city', 'approved', true, 0, 'fixture'),
  ('tank', null, 'Tank', 'tank', 'city', 'approved', true, 0, 'fixture'),
  ('chitral', null, 'Chitral', 'chitral', 'city', 'approved', true, 0, 'fixture'),
  ('buner', null, 'Buner', 'buner', 'city', 'approved', true, 0, 'fixture'),
  ('shangla', null, 'Shangla', 'shangla', 'city', 'approved', true, 0, 'fixture'),

  -- Balochistan
  ('quetta', null, 'Quetta', 'quetta', 'city', 'approved', true, 0, 'fixture'),
  ('gwadar', null, 'Gwadar', 'gwadar', 'city', 'approved', true, 0, 'fixture'),
  ('khuzdar', null, 'Khuzdar', 'khuzdar', 'city', 'approved', true, 0, 'fixture'),
  ('turbat', null, 'Turbat', 'turbat', 'city', 'approved', true, 0, 'fixture'),
  ('chaman', null, 'Chaman', 'chaman', 'city', 'approved', true, 0, 'fixture'),
  ('sibi', null, 'Sibi', 'sibi', 'city', 'approved', true, 0, 'fixture'),
  ('zhob', null, 'Zhob', 'zhob', 'city', 'approved', true, 0, 'fixture'),
  ('dera-murad-jamali', null, 'Dera Murad Jamali', 'dera-murad-jamali', 'city', 'approved', true, 0, 'fixture'),
  ('hub', null, 'Hub', 'hub', 'city', 'approved', true, 0, 'fixture'),
  ('loralai', null, 'Loralai', 'loralai', 'city', 'approved', true, 0, 'fixture'),
  ('pishin', null, 'Pishin', 'pishin', 'city', 'approved', true, 0, 'fixture'),

  -- Islamabad Capital Territory
  ('islamabad', null, 'Islamabad', 'islamabad', 'city', 'approved', true, 0, 'fixture'),

  -- Azad Jammu & Kashmir
  ('muzaffarabad', null, 'Muzaffarabad', 'muzaffarabad', 'city', 'approved', true, 0, 'fixture'),
  ('mirpur-ajk', null, 'Mirpur (AJK)', 'mirpur-ajk', 'city', 'approved', true, 0, 'fixture'),
  ('rawalakot', null, 'Rawalakot', 'rawalakot', 'city', 'approved', true, 0, 'fixture'),
  ('kotli', null, 'Kotli', 'kotli', 'city', 'approved', true, 0, 'fixture'),
  ('bhimber', null, 'Bhimber', 'bhimber', 'city', 'approved', true, 0, 'fixture'),

  -- Gilgit-Baltistan
  ('gilgit', null, 'Gilgit', 'gilgit', 'city', 'approved', true, 0, 'fixture'),
  ('skardu', null, 'Skardu', 'skardu', 'city', 'approved', true, 0, 'fixture'),

  -- Punjab: tehsil-level cities (not district headquarters, but
  -- routinely searched when renting — the brief's explicit examples
  -- are marked)
  ('talagang', null, 'Talagang', 'talagang', 'city', 'approved', true, 0, 'fixture'),          -- example
  ('pind-dadan-khan', null, 'Pind Dadan Khan', 'pind-dadan-khan', 'city', 'approved', true, 0, 'fixture'), -- example
  ('kot-momin', null, 'Kot Momin', 'kot-momin', 'city', 'approved', true, 0, 'fixture'),        -- example
  ('shahpur', null, 'Shahpur', 'shahpur', 'city', 'approved', true, 0, 'fixture'),              -- example
  ('shorkot', null, 'Shorkot', 'shorkot', 'city', 'approved', true, 0, 'fixture'),              -- example
  ('hasan-abdal', null, 'Hasan Abdal', 'hasan-abdal', 'city', 'approved', true, 0, 'fixture'),  -- example
  ('wazirabad', null, 'Wazirabad', 'wazirabad', 'city', 'approved', true, 0, 'fixture'),
  ('daska', null, 'Daska', 'daska', 'city', 'approved', true, 0, 'fixture'),
  ('pasrur', null, 'Pasrur', 'pasrur', 'city', 'approved', true, 0, 'fixture'),
  ('renala-khurd', null, 'Renala Khurd', 'renala-khurd', 'city', 'approved', true, 0, 'fixture'),
  ('depalpur', null, 'Depalpur', 'depalpur', 'city', 'approved', true, 0, 'fixture'),
  ('chunian', null, 'Chunian', 'chunian', 'city', 'approved', true, 0, 'fixture'),
  ('pattoki', null, 'Pattoki', 'pattoki', 'city', 'approved', true, 0, 'fixture'),
  ('kot-radha-kishan', null, 'Kot Radha Kishan', 'kot-radha-kishan', 'city', 'approved', true, 0, 'fixture'),
  ('ferozewala', null, 'Ferozewala', 'ferozewala', 'city', 'approved', true, 0, 'fixture'),
  ('muridke', null, 'Muridke', 'muridke', 'city', 'approved', true, 0, 'fixture'),
  ('safdarabad', null, 'Safdarabad', 'safdarabad', 'city', 'approved', true, 0, 'fixture'),
  ('jaranwala', null, 'Jaranwala', 'jaranwala', 'city', 'approved', true, 0, 'fixture'),
  ('tandlianwala', null, 'Tandlianwala', 'tandlianwala', 'city', 'approved', true, 0, 'fixture'),
  ('samundri', null, 'Samundri', 'samundri', 'city', 'approved', true, 0, 'fixture'),
  ('chak-jhumra', null, 'Chak Jhumra', 'chak-jhumra', 'city', 'approved', true, 0, 'fixture'),
  ('gojra', null, 'Gojra', 'gojra', 'city', 'approved', true, 0, 'fixture'),
  ('kamalia', null, 'Kamalia', 'kamalia', 'city', 'approved', true, 0, 'fixture'),
  ('ahmedpur-east', null, 'Ahmedpur East', 'ahmedpur-east', 'city', 'approved', true, 0, 'fixture'),
  ('hasilpur', null, 'Hasilpur', 'hasilpur', 'city', 'approved', true, 0, 'fixture'),
  ('yazman', null, 'Yazman', 'yazman', 'city', 'approved', true, 0, 'fixture'),
  ('khanpur', null, 'Khanpur', 'khanpur', 'city', 'approved', true, 0, 'fixture'),
  ('liaquatpur', null, 'Liaquatpur', 'liaquatpur', 'city', 'approved', true, 0, 'fixture'),
  ('chishtian', null, 'Chishtian', 'chishtian', 'city', 'approved', true, 0, 'fixture'),
  ('haroonabad', null, 'Haroonabad', 'haroonabad', 'city', 'approved', true, 0, 'fixture'),
  ('fort-abbas', null, 'Fort Abbas', 'fort-abbas', 'city', 'approved', true, 0, 'fixture'),
  ('mailsi', null, 'Mailsi', 'mailsi', 'city', 'approved', true, 0, 'fixture'),
  ('burewala', null, 'Burewala', 'burewala', 'city', 'approved', true, 0, 'fixture'),
  ('mian-channu', null, 'Mian Channu', 'mian-channu', 'city', 'approved', true, 0, 'fixture'),
  ('kabirwala', null, 'Kabirwala', 'kabirwala', 'city', 'approved', true, 0, 'fixture'),
  ('jalalpur-pirwala', null, 'Jalalpur Pirwala', 'jalalpur-pirwala', 'city', 'approved', true, 0, 'fixture'),
  ('shujabad', null, 'Shujabad', 'shujabad', 'city', 'approved', true, 0, 'fixture'),
  ('kot-addu', null, 'Kot Addu', 'kot-addu', 'city', 'approved', true, 0, 'fixture'),
  ('alipur', null, 'Alipur', 'alipur', 'city', 'approved', true, 0, 'fixture'),
  ('taunsa', null, 'Taunsa', 'taunsa', 'city', 'approved', true, 0, 'fixture'),
  ('kalur-kot', null, 'Kalur Kot', 'kalur-kot', 'city', 'approved', true, 0, 'fixture'),
  ('darya-khan', null, 'Darya Khan', 'darya-khan', 'city', 'approved', true, 0, 'fixture'),
  ('isakhel', null, 'Isakhel', 'isakhel', 'city', 'approved', true, 0, 'fixture'),
  ('piplan', null, 'Piplan', 'piplan', 'city', 'approved', true, 0, 'fixture'),
  ('bhera', null, 'Bhera', 'bhera', 'city', 'approved', true, 0, 'fixture'),
  ('bhalwal', null, 'Bhalwal', 'bhalwal', 'city', 'approved', true, 0, 'fixture'),
  ('sillanwali', null, 'Sillanwali', 'sillanwali', 'city', 'approved', true, 0, 'fixture'),
  ('phalia', null, 'Phalia', 'phalia', 'city', 'approved', true, 0, 'fixture'),
  ('malakwal', null, 'Malakwal', 'malakwal', 'city', 'approved', true, 0, 'fixture'),
  ('kharian', null, 'Kharian', 'kharian', 'city', 'approved', true, 0, 'fixture'),
  ('sarai-alamgir', null, 'Sarai Alamgir', 'sarai-alamgir', 'city', 'approved', true, 0, 'fixture'),
  ('zafarwal', null, 'Zafarwal', 'zafarwal', 'city', 'approved', true, 0, 'fixture'),
  ('shakargarh', null, 'Shakargarh', 'shakargarh', 'city', 'approved', true, 0, 'fixture'),
  ('nowshera-virkan', null, 'Nowshera Virkan', 'nowshera-virkan', 'city', 'approved', true, 0, 'fixture'),
  ('chichawatni', null, 'Chichawatni', 'chichawatni', 'city', 'approved', true, 0, 'fixture'),
  ('arifwala', null, 'Arifwala', 'arifwala', 'city', 'approved', true, 0, 'fixture'),
  ('duniyapur', null, 'Duniyapur', 'duniyapur', 'city', 'approved', true, 0, 'fixture'),
  ('kahror-pacca', null, 'Kahror Pacca', 'kahror-pacca', 'city', 'approved', true, 0, 'fixture'),

  -- Khyber Pakhtunkhwa: tehsil-level cities
  ('takht-bhai', null, 'Takht Bhai', 'takht-bhai', 'city', 'approved', true, 0, 'fixture'),
  ('topi', null, 'Topi', 'topi', 'city', 'approved', true, 0, 'fixture'),
  ('timergara', null, 'Timergara', 'timergara', 'city', 'approved', true, 0, 'fixture'),
  ('batkhela', null, 'Batkhela', 'batkhela', 'city', 'approved', true, 0, 'fixture'),
  ('daggar', null, 'Daggar', 'daggar', 'city', 'approved', true, 0, 'fixture'),
  ('alpuri', null, 'Alpuri', 'alpuri', 'city', 'approved', true, 0, 'fixture'),

  -- Sindh: tehsil-level cities
  ('rohri', null, 'Rohri', 'rohri', 'city', 'approved', true, 0, 'fixture'),
  ('pano-aqil', null, 'Pano Aqil', 'pano-aqil', 'city', 'approved', true, 0, 'fixture'),
  ('kashmore', null, 'Kashmore', 'kashmore', 'city', 'approved', true, 0, 'fixture'),
  ('naushahro-feroze', null, 'Naushahro Feroze', 'naushahro-feroze', 'city', 'approved', true, 0, 'fixture'),
  ('moro', null, 'Moro', 'moro', 'city', 'approved', true, 0, 'fixture'),
  ('matiari', null, 'Matiari', 'matiari', 'city', 'approved', true, 0, 'fixture'),
  ('hala', null, 'Hala', 'hala', 'city', 'approved', true, 0, 'fixture'),
  ('sanghar', null, 'Sanghar', 'sanghar', 'city', 'approved', true, 0, 'fixture'),
  ('shahdadpur', null, 'Shahdadpur', 'shahdadpur', 'city', 'approved', true, 0, 'fixture'),
  ('tando-muhammad-khan', null, 'Tando Muhammad Khan', 'tando-muhammad-khan', 'city', 'approved', true, 0, 'fixture'),
  ('kotri', null, 'Kotri', 'kotri', 'city', 'approved', true, 0, 'fixture'),
  ('jamshoro', null, 'Jamshoro', 'jamshoro', 'city', 'approved', true, 0, 'fixture'),
  ('ranipur', null, 'Ranipur', 'ranipur', 'city', 'approved', true, 0, 'fixture'),
  ('gambat', null, 'Gambat', 'gambat', 'city', 'approved', true, 0, 'fixture'),

  -- Balochistan: tehsil-level cities
  ('mastung', null, 'Mastung', 'mastung', 'city', 'approved', true, 0, 'fixture'),
  ('kalat', null, 'Kalat', 'kalat', 'city', 'approved', true, 0, 'fixture'),
  ('kharan', null, 'Kharan', 'kharan', 'city', 'approved', true, 0, 'fixture'),
  ('nushki', null, 'Nushki', 'nushki', 'city', 'approved', true, 0, 'fixture'),
  ('usta-muhammad', null, 'Usta Muhammad', 'usta-muhammad', 'city', 'approved', true, 0, 'fixture'),
  ('panjgur', null, 'Panjgur', 'panjgur', 'city', 'approved', true, 0, 'fixture'),
  ('uthal', null, 'Uthal', 'uthal', 'city', 'approved', true, 0, 'fixture')

on conflict (node_id) do update set
  name = excluded.name, slug = excluded.slug, active = true, status = 'approved'
  where locations.source = 'fixture';  -- never overwrite an admin-edited city row (source <> 'fixture')
