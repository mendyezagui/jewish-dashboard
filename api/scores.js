export const config = { runtime: 'edge' };

// Dodgers (MLB id 19) and Lakers (NBA id 13) score proxy.
// Fetches each team's full schedule, picks the most relevant events.
// Cached 60s on Vercel edge to keep ESPN happy.

const MLB_URL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/19/schedule';
const NBA_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/13/schedule';

export default async function handler() {
  const headers = {
    'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  };

  try {
    const [mlb, nba] = await Promise.all([
      fetch(MLB_URL, { headers: { 'accept': 'application/json' } }).then(r => r.json()).catch(() => null),
      fetch(NBA_URL, { headers: { 'accept': 'application/json' } }).then(r => r.json()).catch(() => null),
    ]);

    return new Response(JSON.stringify({
      dodgers: extract(mlb, '19'),
      lakers: extract(nba, '13'),
      fetchedAt: new Date().toISOString(),
    }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 200, headers });
  }
}

const LA_TZ = 'America/Los_Angeles';
const laDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: LA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

function laDateOf(iso) {
  if (!iso) return '';
  return laDateFmt.format(new Date(iso));
}

function scoreVal(s) {
  if (s == null) return null;
  if (typeof s === 'string' || typeof s === 'number') return String(s);
  if (typeof s === 'object') {
    if (s.displayValue != null) return String(s.displayValue);
    if (s.value != null) return String(s.value);
  }
  return null;
}

function extract(data, teamId) {
  const events = (data && Array.isArray(data.events)) ? data.events : [];
  const now = Date.now();
  const todayLA = laDateFmt.format(new Date());

  let live = null;
  let todayEvent = null;
  let lastFinal = null;
  let nextScheduled = null;

  for (const e of events) {
    const c = e.competitions && e.competitions[0];
    if (!c) continue;
    const st = c.status && c.status.type;
    if (!st) continue;
    const evMs = new Date(e.date).getTime();
    const isToday = laDateOf(e.date) === todayLA;

    if (st.state === 'in') live = e;
    if (isToday) todayEvent = e;

    if (st.completed) {
      if (!lastFinal || new Date(lastFinal.date) < new Date(e.date)) lastFinal = e;
    }
    if (st.state === 'pre' && evMs > now) {
      if (!nextScheduled || new Date(nextScheduled.date) > new Date(e.date)) nextScheduled = e;
    }
  }

  return {
    live: compact(live, teamId),
    todayEvent: compact(todayEvent, teamId),
    lastFinal: compact(lastFinal, teamId),
    nextScheduled: compact(nextScheduled, teamId),
  };
}

function compact(e, teamId) {
  if (!e) return null;
  const c = e.competitions && e.competitions[0];
  if (!c) return null;
  const competitors = c.competitors || [];
  const us = competitors.find(x => String(x.id) === String(teamId));
  const them = competitors.find(x => String(x.id) !== String(teamId));
  const st = (c.status && c.status.type) || {};
  return {
    id: e.id,
    date: e.date,
    state: st.state || null,
    completed: !!st.completed,
    detail: st.detail || null,
    shortDetail: st.shortDetail || null,
    period: c.status && c.status.period,
    clock: c.status && c.status.displayClock,
    home: us ? us.homeAway === 'home' : null,
    us: us ? { score: scoreVal(us.score), winner: us.winner === true } : null,
    them: them ? {
      id: them.id,
      abbr: them.team && them.team.abbreviation,
      name: them.team && (them.team.shortDisplayName || them.team.displayName || them.team.name),
      score: scoreVal(them.score),
    } : null,
  };
}
