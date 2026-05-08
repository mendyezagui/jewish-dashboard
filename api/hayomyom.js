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
  'Adar':     'Adar',
  'Adar I':   'Adar I',
  'Adar 1':   'Adar I',
  'Adar II':  'Adar',     // no Adar II in dataset → fall back to Adar
  'Adar 2':   'Adar',
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
    const dataUrl = `${url.origin}/hayomyom-data.json`;
    const dataset = await fetch(dataUrl).then(r => r.json()).catch(() => null);
    if (!Array.isArray(dataset)) {
      return json({ error: 'dataset unavailable', tried: dataUrl }, headers);
    }

    const dayNum = Number(heb.hd);
    const dsMonth = MONTH_MAP[heb.hm] || heb.hm;

    // Find matching entry. Days are stored as strings or numbers depending on entry.
    let entry = dataset.find(e => e && e.date
      && String(e.date.month).toLowerCase() === String(dsMonth).toLowerCase()
      && Number(e.date.day) === dayNum);

    // Special case: 18 Elul = Chai Elul has its own entry in the dataset
    if (!entry && dsMonth === 'Elul' && dayNum === 18) {
      entry = dataset.find(e => e && e.date && e.date.month === 'Chai');
    }

    if (!entry) {
      return json({
        error: 'no entry for today',
        hebrewDate: { hd: heb.hd, hm: heb.hm, hy: heb.hy },
        triedMonth: dsMonth, triedDay: dayNum,
      }, headers);
    }

    const en = (entry.hayomYom && entry.hayomYom.english) || '';
    const he = (entry.hayomYom && entry.hayomYom.hebrew) || '';
    const dateHeader = `${heb.hd} ${heb.hm} ${heb.hy}`;
    return json({
      teaching_en: en || null,
      teaching_he: he || null,
      dateHeader,
      hebrewDate: heb.hebrew || null,
      year: heb.hy ? String(heb.hy) : null,
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
