// ISO 3166-1 alpha-2 country utilities

const COUNTRY_NAMES = {
  af: 'Afghanistan',
  al: 'Albania',
  dz: 'Algeria',
  ar: 'Argentina',
  am: 'Armenia',
  au: 'Australia',
  at: 'Austria',
  az: 'Azerbaijan',
  bd: 'Bangladesh',
  by: 'Belarus',
  be: 'Belgium',
  bo: 'Bolivia',
  ba: 'Bosnia & Herzegovina',
  br: 'Brazil',
  bg: 'Bulgaria',
  kh: 'Cambodia',
  ca: 'Canada',
  cl: 'Chile',
  cn: 'China',
  co: 'Colombia',
  cr: 'Costa Rica',
  hr: 'Croatia',
  cy: 'Cyprus',
  cz: 'Czech Republic',
  dk: 'Denmark',
  ec: 'Ecuador',
  eg: 'Egypt',
  ee: 'Estonia',
  fi: 'Finland',
  fr: 'France',
  ge: 'Georgia',
  de: 'Germany',
  gr: 'Greece',
  hk: 'Hong Kong',
  hu: 'Hungary',
  is: 'Iceland',
  in: 'India',
  id: 'Indonesia',
  ir: 'Iran',
  iq: 'Iraq',
  ie: 'Ireland',
  il: 'Israel',
  it: 'Italy',
  jp: 'Japan',
  jo: 'Jordan',
  kz: 'Kazakhstan',
  ke: 'Kenya',
  kr: 'South Korea',
  kw: 'Kuwait',
  lv: 'Latvia',
  lb: 'Lebanon',
  lt: 'Lithuania',
  lu: 'Luxembourg',
  my: 'Malaysia',
  mx: 'Mexico',
  md: 'Moldova',
  mn: 'Mongolia',
  ma: 'Morocco',
  np: 'Nepal',
  nl: 'Netherlands',
  nz: 'New Zealand',
  ng: 'Nigeria',
  no: 'Norway',
  pk: 'Pakistan',
  pa: 'Panama',
  pe: 'Peru',
  ph: 'Philippines',
  pl: 'Poland',
  pt: 'Portugal',
  qa: 'Qatar',
  ro: 'Romania',
  ru: 'Russia',
  sa: 'Saudi Arabia',
  rs: 'Serbia',
  sg: 'Singapore',
  sk: 'Slovakia',
  si: 'Slovenia',
  za: 'South Africa',
  es: 'Spain',
  se: 'Sweden',
  ch: 'Switzerland',
  tw: 'Taiwan',
  th: 'Thailand',
  tr: 'Turkey',
  ua: 'Ukraine',
  ae: 'United Arab Emirates',
  gb: 'United Kingdom',
  us: 'United States',
  uy: 'Uruguay',
  uz: 'Uzbekistan',
  ve: 'Venezuela',
  vn: 'Vietnam',
};

export function countryName(code) {
  if (!code) return 'Unknown Country';
  const c = code.toLowerCase().trim();
  return COUNTRY_NAMES[c] || code.toUpperCase();
}

export function countryFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  const upper = code.toUpperCase();
  if (upper === '??' || upper === 'XX') return '🌐';
  try {
    return String.fromCodePoint(
      0x1f1e6 + upper.charCodeAt(0) - 65,
      0x1f1e6 + upper.charCodeAt(1) - 65
    );
  } catch {
    return '🌐';
  }
}
