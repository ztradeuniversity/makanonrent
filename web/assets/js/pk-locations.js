/* MakanOnRent — Pakistan city → area master data (public subset).
   Shape mirrors docs/04 geo hierarchy: City → Area. Area level only.
   Slugs feed the /rent/{city}/{area} URL contract (docs/13 §4.1). */
(function (root) {
  'use strict';

  var CITIES = [
    { name: 'Lahore', slug: 'lahore', areas: [
      'DHA Defence', 'Bahria Town', 'Johar Town', 'Model Town', 'Gulberg',
      'Faisal Town', 'Wapda Town', 'Allama Iqbal Town', 'Garden Town',
      'Valencia Town', 'Askari', 'Cantt', 'Township', 'Sabzazar', 'Samanabad',
      'Shadman', 'Muslim Town', 'New Muslim Town', 'Punjab Coop Housing Society',
      'EME Society', 'LDA Avenue', 'Park View City', 'Central Park Housing',
      'Lake City', 'Al Kabir Town', 'Paragon City', 'State Life Housing Society',
      'PIA Housing Scheme', 'Canal View', 'Nasheman-e-Iqbal', 'Izmir Town',
      'Jubilee Town', 'Tariq Gardens', 'Khayaban-e-Amin', 'Marghzar Colony',
      'Architects Engineers Society', 'Bankers Cooperative Housing Society',
      'Military Accounts Housing Society', 'Cavalry Ground', 'Walton Road',
      'Gulshan-e-Ravi', 'Awan Town', 'Hanjarwal', 'Kot Lakhpat', 'Ghazi Road',
      'Thokar Niaz Baig', 'Multan Road', 'Ferozepur Road', 'Raiwind Road',
      'Bedian Road', 'Barki Road', 'Ring Road', 'Harbanspura', 'Shalimar',
      'Baghbanpura', 'Mughalpura', 'Ichhra', 'Krishan Nagar', 'Ravi Road',
      'Chauburji', 'Mall Road', 'Jail Road', 'Upper Mall', 'Gulberg III',
      'Main Boulevard', 'Nishtar Colony', 'Chungi Amar Sadhu', 'Gajjumata',
      'Manawan', 'Shahdara', 'Mehmood Booti', 'Wapda City', 'Green City',
      'Rehman Gardens', 'Sui Gas Housing Society', 'Divine Gardens'
    ]},
    { name: 'Karachi', slug: 'karachi', areas: [
      'DHA Defence', 'Clifton', 'Gulshan-e-Iqbal', 'Gulistan-e-Johar',
      'North Nazimabad', 'Nazimabad', 'PECHS', 'Bahadurabad', 'Tariq Road',
      'Shahra-e-Faisal', 'Bahria Town Karachi', 'Scheme 33', 'Federal B Area',
      'Gulberg Town', 'Malir', 'Malir Cantt', 'Korangi', 'Landhi', 'Saddar',
      'Garden East', 'Soldier Bazar', 'KDA Scheme 1', 'Askari', 'Cantt',
      'North Karachi', 'New Karachi', 'Surjani Town', 'Orangi Town',
      'Model Colony', 'Shah Faisal Colony', 'Manzoor Colony', 'Sea View',
      'Hawksbay', 'Gadap Town', 'Lyari', 'Nazimabad No 4', 'Buffer Zone'
    ]},
    { name: 'Islamabad', slug: 'islamabad', areas: [
      'F-6', 'F-7', 'F-8', 'F-10', 'F-11', 'E-7', 'E-11', 'G-6', 'G-7', 'G-8',
      'G-9', 'G-10', 'G-11', 'G-13', 'G-14', 'G-15', 'I-8', 'I-9', 'I-10',
      'D-12', 'B-17', 'DHA Defence', 'Bahria Town', 'Gulberg Islamabad',
      'PWD Housing Society', 'Soan Garden', 'Media Town', 'Park Road',
      'Chak Shahzad', 'Bani Gala', 'Blue Area', 'Korang Town', 'Ghauri Town',
      'Naval Anchorage', 'Top City', 'Faisal Town Islamabad'
    ]},
    { name: 'Rawalpindi', slug: 'rawalpindi', areas: [
      'Bahria Town', 'DHA Defence', 'Satellite Town', 'Chaklala Scheme 3',
      'Adiala Road', 'Airport Housing Society', 'Gulraiz Housing Society',
      'Peshawar Road', 'Westridge', 'Saddar', 'Committee Chowk', 'Morgah',
      'Range Road', 'Askari', 'Media Town', 'Gulistan Colony', 'PWD Housing',
      'Khayaban-e-Sir Syed', 'Tulsa Road', 'Dhoke Kala Khan', 'Chur Harpal',
      'Bani', 'Sadiqabad', 'Chaklala Cantt'
    ]},
    { name: 'Faisalabad', slug: 'faisalabad', areas: [
      'Peoples Colony', 'Madina Town', 'Susan Road', 'D Ground', 'Gulberg',
      'Jaranwala Road', 'Satiana Road', 'Canal Road', 'Wapda City', 'Model City',
      'Batala Colony', 'Samanabad', 'Ghulam Muhammad Abad', 'Millat Town',
      'Sargodha Road', 'Eden Valley', 'Citi Housing', 'Abdullahpur',
      'Civil Lines', 'Kohinoor City'
    ]},
    { name: 'Multan', slug: 'multan', areas: [
      'Gulgasht Colony', 'Cantt', 'Model Town', 'Shah Rukn-e-Alam Colony',
      'Wapda Town', 'Buch Villas', 'Royal Orchard', 'DHA Defence', 'Bosan Road',
      'Northern Bypass', 'New Multan', 'Mumtazabad', 'Chungi No 9', 'Askari',
      'Zakariya Town', 'Garden Town', 'Nawabpur Road', 'Shalimar Colony'
    ]},
    { name: 'Peshawar', slug: 'peshawar', areas: [
      'Hayatabad', 'University Town', 'Gulbahar', 'Warsak Road', 'Ring Road',
      'Regi Model Town', 'DHA Defence', 'Askari', 'Cantt', 'Board Bazar',
      'Charsadda Road', 'Kohat Road', 'Nasir Bagh Road', 'Pishtakhara',
      'Danish Abad', 'Shami Road'
    ]},
    { name: 'Gujranwala', slug: 'gujranwala', areas: [
      'DHA Defence', 'Model Town', 'Satellite Town', 'Peoples Colony',
      'Wapda Town', 'Citi Housing', 'Rahwali Cantt', 'GT Road',
      'Sialkot Bypass', 'Gulshan-e-Iqbal', 'Civil Lines', 'Master City'
    ]},
    { name: 'Sialkot', slug: 'sialkot', areas: [
      'Cantt', 'Model Town', 'Citi Housing', 'Defence Road', 'Kashmir Road',
      'Paris Road', 'Ugoki', 'Sublime Chowk', 'Master City', 'Shahabpura',
      'Rangpura', 'Hajipura'
    ]},
    { name: 'Hyderabad', slug: 'hyderabad', areas: [
      'Latifabad', 'Qasimabad', 'Auto Bhan Road', 'Saddar', 'Cantt',
      'Gulistan-e-Sarmast', 'Citizen Colony', 'Defence Housing Authority',
      'Hussainabad', 'Thandi Sarak'
    ]},
    { name: 'Quetta', slug: 'quetta', areas: [
      'Jinnah Town', 'Samungli Road', 'Airport Road', 'Cantt', 'Satellite Town',
      'Chaman Housing Scheme', 'Askari', 'Shahbaz Town', 'Sabzal Road',
      'Brewery Road', 'Zarghoon Road', 'Killi Almas'
    ]},
    { name: 'Abbottabad', slug: 'abbottabad', areas: [
      'Mandian', 'Supply Bazar', 'Cantt', 'PMA Kakul Road', 'Jhangi',
      'Nawansher', 'Mirpur', 'Karakoram Highway', 'Salhad'
    ]},
    { name: 'Bahawalpur', slug: 'bahawalpur', areas: [
      'Model Town A', 'Model Town B', 'Satellite Town', 'Cantt', 'Gulberg',
      'Shahdara Colony', 'Trust Colony', 'Noor Mahal Road', 'Yazman Road'
    ]},
    { name: 'Sargodha', slug: 'sargodha', areas: [
      'Satellite Town', 'Cantt', 'Model Town', 'Block Z', 'University Road',
      'Faisalabad Road', 'Old Civil Lines', 'Gulberg City'
    ]},
    { name: 'Sahiwal', slug: 'sahiwal', areas: [
      'Farid Town', 'Cantt', 'Model Town', 'Gulshan Colony', 'Jinnah Park',
      'Canal Colony', 'Officers Colony'
    ]},
    { name: 'Sukkur', slug: 'sukkur', areas: [
      'Military Road', 'Barrage Colony', 'Airport Road', 'Shikarpur Road',
      'Minara Road', 'Bunder Road', 'New Pind'
    ]},
    { name: 'Rahim Yar Khan', slug: 'rahim-yar-khan', areas: [
      'Model Town', 'Satellite Town', 'Abu Dhabi Road', 'Garden Town',
      'Shahbaz Colony', 'Airport Road', 'Canal Colony'
    ]},
    { name: 'Mirpur (AJK)', slug: 'mirpur-ajk', areas: [
      'Sector B-1', 'Sector C-1', 'Sector D-1', 'Sector F-1', 'Allama Iqbal Road',
      'Kotli Road', 'Islamgarh Road', 'New City'
    ]},
    { name: 'Gujrat', slug: 'gujrat', areas: [
      'Citi Housing', 'Model Town', 'Satellite Town', 'GT Road', 'Kutchery Chowk',
      'Shadman Colony', 'Rehman Shaheed Road'
    ]},
    { name: 'Sheikhupura', slug: 'sheikhupura', areas: [
      'Model Town', 'Civil Lines', 'Sharaqpur Road', 'Faisalabad Road',
      'Lahore Road', 'Batti Chowk'
    ]}
  ];

  function slugify(v) {
    return String(v).toLowerCase().trim()
      .replace(/[()]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  root.MOR_LOCATIONS = { cities: CITIES, slugify: slugify };
})(window);
