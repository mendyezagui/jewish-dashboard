# Jewish Dashboard

Static dashboard with one Vercel Edge function. No build step.

## Files
- `index.html` — the dashboard (clock, Hebrew date, Hayom Yom, Daily Learning, Zmanim, Shabbos times, video).
- `api/hayomyom.js` — Edge function that scrapes m.chabad.org for the daily Hayom Yom teaching (English + Hebrew). The frontend calls `/api/hayomyom?date=M/D/YYYY`.
- `package.json` — declares ESM so the edge function loads correctly.

## Configuration
Both timezone and ZIP are inline in `index.html`:
```js
var TZ='America/Los_Angeles', ZIP='90035';
```
Change those if you move.

## External APIs (no keys required)
- hebcal.com (`/converter`, `/shabbat`, `/zmanim`)
- sefaria.org (`/api/calendars`)
- m.chabad.org (scraped via the edge function)

## Redeploy

### Option A — Vercel CLI (fastest)
```bash
cd jewish-dashboard
npx vercel --prod
```
Pick the existing `jewish-dashboard` project when prompted.

### Option B — Drag and drop
1. Open https://vercel.com/mendyezagui-1944s-projects/jewish-dashboard
2. Settings -> Deployments -> "Create Deployment" or use the project's deploy zone
3. Drag the entire `jewish-dashboard` folder in

### Option C — Connect a Git repo
Push this folder to GitHub, then Connect Git in the Vercel project settings.

## Sanity check after deploy
- Open the production URL — clock and English date should appear instantly.
- Hebrew date and badges fill in within ~1s (hebcal).
- Daily Learning fills in within ~1s (sefaria).
- Hayom Yom fills in within ~1-3s (chabad scrape, cached on Vercel for 1h).
- Zmanim card shows ~10 rows for LA.
- Shabbos card only appears Friday/Saturday/Yom Tov.
- On Shabbos/Yom Tov the YouTube video swaps for a static "Shabbat Shalom" image.
