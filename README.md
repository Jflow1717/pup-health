# Sunny & Chomper: health records

A private web app for Sunny's and Chomper Kelce's vaccines, medications,
weights, IDs, and vet records. It works on phones and computers, shared
between two logins. Hosting is free (GitHub Pages), and so is the database
(Supabase free plan).

**No personal records are kept in this folder's GitHub copy.** Microchip
numbers, starter data, and backups live only in `private/` on this
computer and in the Supabase database, which only the two household logins
can open.

## What's where

| Folder / file              | What it is                                                  |
|----------------------------|-------------------------------------------------------------|
| `index.html`, `css/`, `js/`| The app itself (what GitHub Pages will serve)               |
| `manifest.json`, `icons/`, `sw.js` | Home-screen install: name, icon, quick opening, clean updates |
| `js/config.js`             | Where the Supabase address and publishable key go           |
| `js/logic.js`              | The arithmetic: last given, due dates, colors, sizes        |
| `js/chart.js`              | The growth chart (drawn by hand, no chart library)          |
| `js/importer.js`           | Import from Claude: reads and checks a pasted block         |
| `js/backup.js`             | Backups: the JSON file, spreadsheets, and the zip            |
| `js/screens/summary.js`    | The printable vet summary                                    |
| `SETUP.md`                 | One-time database setup, step by step                       |
| `supabase/schema.sql`      | The database tables and privacy rules                        |
| `private/` (not on GitHub) | Starter records for Sunny and Chomper, open questions       |
| `tools/json-to-sql.mjs`    | Turns a JSON backup into SQL, to load or restore records    |
| `tools/make-icons.py`      | Draws the app icon (only needed to change it)                |
| `.github/workflows/`       | A free daily job that keeps the Supabase database awake      |
| `tests/`                   | Check-ups that run on this computer (`npm test`)            |

## Trying it on this computer

Until Supabase is set up, the app runs in **demo mode** with a practice
copy of the starter records. Changes vanish when you reload.

```
cd ~/Documents/claude/pup-health
python3 -m http.server 8650 --bind 127.0.0.1
```

Then open http://localhost:8650 in a browser. (`--bind 127.0.0.1` keeps
it on this computer only, so nobody else on the Wi-Fi can open
`private/`.) Press Control-C in that window to stop it.

## Build progress

1. Data model and seed data (done)
2. Dashboard and history views (done)
3. Weight log and chart (done)
4. IDs and contacts (done)
5. Import screen (done)
6. Vet summary page and export (done, waiting for your OK)

After that: going live (Supabase setup from SETUP.md, then GitHub Pages).
