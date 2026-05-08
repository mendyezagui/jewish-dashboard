export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') || '';
  const headers = {
    'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  };

  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

  try {
    const fetchUrl = 'https://m.chabad.org/dailystudy/hayomyom.htm' + (date ? '?tdate=' + encodeURIComponent(date) : '');
    const r = await fetch(fetchUrl, {
      headers: { 'user-agent': ua, 'accept': 'text/html', 'accept-language': 'en-US,en' }
    });
    const html = await r.text();

    if (!html || html.length < 5000) {
      return new Response(JSON.stringify({ error: 'empty response', status: r.status }), { status: 200, headers });
    }

    const result = parseHayomYom(html);
    result.fetchedAt = new Date().toISOString();
    result.source = fetchUrl;

    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 200, headers });
  }
}

function parseHayomYom(html) {
  const out = {
    dateHeader: null,
    omer: null,
    year: null,
    chumash: null,
    tehillim: null,
    tanya: null,
    teaching_en: null,
    teaching_he: null,
    hebrewDate: null,
  };

  // Extract English block: from <div class="hayom-yom-native hayom-yom-language"> until next <div class="hayom-yom-hebrew
  const enStart = html.indexOf('class="hayom-yom-native hayom-yom-language"');
  const enEnd = html.indexOf('class="hayom-yom-hebrew');
  if (enStart === -1) return out;
  const enBlock = enEnd > enStart ? html.substring(enStart, enEnd) : html.substring(enStart, enStart + 8000);

  // Date row: <tr class="hayom-yom-date"> with 3 td: day, date+omer, year
  const dateRow = enBlock.match(/<tr class="hayom-yom-date"[\s\S]*?<\/tr>/i);
  if (dateRow) {
    const cells = Array.from(dateRow[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map(m => stripHtml(m[1]));
    if (cells[1]) {
      out.dateHeader = cells[1];
      const omerMatch = cells[1].match(/(\d+)(?:st|nd|rd|th)?\s+day\s+of\s+the/i);
      if (omerMatch) out.omer = parseInt(omerMatch[1], 10);
    }
    if (cells[2]) out.year = cells[2];
  }

  // Torah lessons: rows with class hayom-yom-shiur
  const shiurRows = Array.from(enBlock.matchAll(/<td[^>]*class="hayom-yom-shiur"[^>]*>([\s\S]*?)<\/td>/gi)).map(m => stripHtml(m[1]));
  for (const row of shiurRows) {
    if (/^Chumash:/i.test(row)) out.chumash = row.replace(/^Chumash:\s*/i, '').replace(/\.$/, '');
    else if (/^Tehillim:/i.test(row)) out.tehillim = row.replace(/^Tehillim:\s*/i, '').replace(/\.$/, '');
    else if (/^Tanya:/i.test(row)) out.tanya = row.replace(/^Tanya:\s*/i, '').replace(/\.$/, '');
  }

  // Teaching paragraph(s): <p> tags after the </table> in the english block, before <p class="inlineCopyright"
  const afterTable = enBlock.split(/<\/table>\s*<\/div>/);
  if (afterTable.length > 1) {
    const remainder = afterTable.slice(1).join('</table></div>');
    const stop = remainder.indexOf('inlineCopyright');
    const teachingPart = stop > 0 ? remainder.substring(0, stop) : remainder;
    const paragraphs = Array.from(teachingPart.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
      .map(m => stripHtml(m[1]).trim())
      .filter(p => p && !/inlineCopyright/i.test(p));
    if (paragraphs.length) out.teaching_en = paragraphs.join('\n\n');
  }

  // Hebrew block
  if (enEnd > 0) {
    const heBlock = html.substring(enEnd, enEnd + 8000);
    const heDateRow = heBlock.match(/<tr class="hayom-yom-date"[\s\S]*?<\/tr>/i);
    if (heDateRow) {
      const cells = Array.from(heDateRow[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map(m => stripHtml(m[1]));
      if (cells[1]) out.hebrewDate = cells[1];
    }
    const heAfter = heBlock.split(/<\/table>\s*<\/div>/);
    if (heAfter.length > 1) {
      const remainder = heAfter.slice(1).join('</table></div>');
      const stop = remainder.indexOf('inlineCopyright');
      const teachingPart = stop > 0 ? remainder.substring(0, stop) : remainder;
      const paragraphs = Array.from(teachingPart.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
        .map(m => stripHtml(m[1]).trim())
        .filter(p => p);
      if (paragraphs.length) out.teaching_he = paragraphs.join('\n\n');
    }
  }

  return out;
}

function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“")
    .replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#8230;|&hellip;/g, "…")
    .replace(/G‑d|G&#8209;d/g, "G‑d")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
