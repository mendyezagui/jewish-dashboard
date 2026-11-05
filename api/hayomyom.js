export const config = { runtime: 'edge' };

// Hayom Yom from a bundled static dataset.
// Background: Chabad.org is now Cloudflare-walled (cf-mitigated: challenge)
// and serves X-Frame-Options: SAMEORIGIN — direct fetch, public proxies,
// and iframe embed all fail. So we ship the canonical Rebbe text alongside
// the dashboard and look up today's entry by Hebrew date.
//
// Dataset: hayomyom-data.json at the deployment root, 384 entries
// keyed by { date: { month, day } }. Sourced from
// github.com/bfp4/hayom-yom-app (Kehot text, public domain re-publish).

// Hebcal Hebrew month name → dataset month name
const MONTH_MAP = {
  'Tishrei':  'Tishrei',
  'Cheshvan': 'Cheshvan',
  'Kislev':   'Kislev',
  'Tevet':    'Tevet',
  "Sh'vat":   "Sh'vat",
  'Shvat':    "Sh'vat",
  'Adar I':   'Adar I',
  'Adar 1':   'Adar I',
  'Nisan':    'Nissan',
  'Nissan':   'Nissan',
  'Iyyar':    'iyyar',
  'Iyar':     'iyyar',
  'Sivan':    'Sivan',
  'Tammuz':   'Tamuz',
  'Tamuz':    'Tamuz',
  'Av':       'Av',
  'Elul':     'Elul',
};

// In a leap year the dataset splits Adar two ways: month 'Adar I' with plain
// numeric days, and month 'Adar' whose days read 'Sheini 1'...'Sheini 29',
// meaning Adar Sheini (Adar II). A plain numeric lookup matches neither, which
// silently blanked every Adar II day, all of a regular year's Adar, and
// Adar I 28-30.
//
// A regular year has one Adar. Halachically it lines up with Adar II - that is
// when Purim and most yahrzeits fall - so that is what we show. If your minhag
// is to read Adar I's text in a regular year, change this to 'Adar I'.
const ADAR_IN_REGULAR_YEAR = 'Adar II';

// 32 of the 384 entries spell the key 'hayom-yom' rather than 'hayomYom'.
// The dataset the panel reads, served as a static file from the deployment
// root. The older hayomyom-data.json is kept in the repository alongside it;
// change this one line to read that instead.
const DATASET = 'hayomyom-data-clear.json';

// Which English the panel shows.
//   'clear'   - the newer translation carried by hayomyom-data-clear.json. It
//               includes passages the Kehot English truncates (29 Sh'vat and
//               1 Adar II), but renders only the teaching: liturgical
//               instructions such as "Bless Rosh Chodesh ..." are left out of
//               it by design.
//   'english' - the Kehot text, which keeps those instructions.
// Whichever is chosen, the other is the fallback, so the older dataset - which
// has no 'clear' field - still works unchanged.
const TEXT_FIELD = 'clear';

// 32 of the 384 entries in the older dataset spell the key 'hayom-yom'.
export function entryText(entry) {
  const t = (entry && (entry.hayomYom || entry['hayom-yom'])) || {};
  const first  = TEXT_FIELD === 'clear' ? t.clear : t.english;
  const second = TEXT_FIELD === 'clear' ? t.english : t.clear;
  return { en: (first || second || '').trim(), he: t.hebrew || '' };
}

export function findEntry(dataset, hebMonth, dayNum) {
  if (!Array.isArray(dataset)) return null;
  const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  let month = String(hebMonth || '');
  if (/^adar\s*(ii|2|sheini)$/i.test(month)) month = 'Adar II';
  else if (/^adar\s*(i|1)$/i.test(month)) month = 'Adar I';
  else if (/^adar$/i.test(month)) month = ADAR_IN_REGULAR_YEAR;

  if (month === 'Adar II') {
    // stored as month 'Adar', day 'Sheini N'
    const hit = dataset.find(e => e && e.date && eq(e.date.month, 'Adar')
      && /^sheini\s+(\d+)$/i.test(String(e.date.day))
      && Number(String(e.date.day).replace(/^sheini\s+/i, '')) === dayNum);
    if (hit) return hit;
  }

  const dsMonth = MONTH_MAP[month] || month;
  let entry = dataset.find(e => e && e.date
    && eq(e.date.month, dsMonth) && Number(e.date.day) === dayNum);

  // 18 Elul (Chai Elul) has its own entry, filed under month 'Chai'.
  if (!entry && dsMonth === 'Elul' && dayNum === 18) {
    entry = dataset.find(e => e && e.date && eq(e.date.month, 'Chai'));
  }

  // Hayom Yom was compiled for 5703, which had a 29-day Cheshvan and a 29-day
  // Kislev, so no text was ever written for 30 Cheshvan or 30 Kislev. In years
  // where those months are full, chabad.org shows the 29th's entry on the 30th,
  // keeping its original 'Cheshvan 29' label. We do the same, and say which
  // entry it is rather than let it read as today's.
  if (!entry && dayNum === 30 && (dsMonth === 'Cheshvan' || dsMonth === 'Kislev')) {
    const prev = dataset.find(e => e && e.date
      && eq(e.date.month, dsMonth) && Number(e.date.day) === 29);
    if (prev) return { ...prev, borrowedFrom: dsMonth + ' 29' };
  }
  return entry || null;
}

export default async function handler(req) {
  const headers = {
    'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  };

  try {
    const url = new URL(req.url);
    const tz = url.searchParams.get('tz') || 'America/Los_Angeles';

    // Today's Hebrew date via Hebcal (free, no key)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
    const heb = await fetch(`https://www.hebcal.com/converter?cfg=json&date=${today}&g2h=1&strict=1`)
      .then(r => r.json()).catch(() => null);
    if (!heb || !heb.hm || !heb.hd) {
      return json({ error: 'hebcal converter unavailable' }, headers);
    }

    // Load bundled dataset from same origin (Vercel serves it as a static asset)
    const dataUrl = `${url.origin}/${DATASET}`;
    const dataset = await fetch(dataUrl).then(r => r.json()).catch(() => null);
    if (!Array.isArray(dataset)) {
      return json({ error: 'dataset unavailable', tried: dataUrl }, headers);
    }

    const dayNum = Number(heb.hd);
    const entry = findEntry(dataset, heb.hm, dayNum);

    if (!entry) {
      // Hayom Yom was written for 5703, so a day that year did not have has no
      // entry: 30 Cheshvan and 30 Kislev, in years where those months are full.
      return json({
        error: 'no entry for today',
        hebrewDate: { hd: heb.hd, hm: heb.hm, hy: heb.hy },
        triedMonth: heb.hm, triedDay: dayNum,
      }, headers);
    }

    const { en, he } = entryText(entry);
    const dateHeader = `${heb.hd} ${heb.hm} ${heb.hy}`;
    return json({
      teaching_en: en || null,
      teaching_he: he || null,
      dateHeader,
      hebrewDate: heb.hebrew || null,
      year: heb.hy ? String(heb.hy) : null,
      borrowedFrom: entry.borrowedFrom || null,
      source: 'bundled-dataset',
      label: 'Hayom Yom',
      fetchedAt: new Date().toISOString(),
    }, headers);
  } catch (err) {
    return json({ error: String(err) }, headers);
  }
}

function json(body, headers) {
  return new Response(JSON.stringify(body), { status: 200, headers });
}
