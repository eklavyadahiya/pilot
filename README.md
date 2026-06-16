# Pilot Training Tools

Static web app designed to work with GitHub Pages.

## Tools

1. Homepage (default)
2. Map + KMZ circuit viewer + wind vector calculator
3. Quiz / flashcards (JSON question bank + category selector)
4. In-Flight Guide (DV20 seeded content)
5. Weight & Balance (converted from `W_and_B_Versie_10.03_EFIS.xls`)

## Wind workflow (simple)

1. Enter a wind code like `31004KT` (direction FROM / speed in knots).
2. Click **Select Point On Map**.
3. Click the map where that windsock reading was observed.
4. Repeat for multiple nearby readings.

The app sums the vectors and shows the resultant wind **at EHHV**.
A dashed 50 km ring is shown around EHHV, and the summary includes how many readings are outside that radius.
Wind readings are saved in browser `localStorage` and restored on refresh.
Use **Reset Wind Data** to clear only wind-related saved page data.

## Distance measuring

1. Click **Start Measuring**.
2. Click points on the map to build a route.
3. Read per-segment and cumulative distance in both km and nm.
4. Enter speed in knots to get estimated elapsed time.
5. Drag any measure point to adjust the route live.
6. Use **Undo Last Point** to remove the latest point.
7. Click **Stop Measuring** or **Clear Measure** when done.

## Quiz / flashcards

- Questions are loaded from `quiz/questions.json`.
- Category filter defaults to `All categories` and applies to both modes.
- **Start Quiz (50)**: randomizes from the selected category pool and serves up to 50.
- **Start Flashcards**: randomizes the selected category pool and reveals answer text only.
- Power drill categories now include:
  - `Power Settings - Circuit`
  - `Power Settings - Climb Turns`
  - `Power Settings - Go Around`
  - `Power Settings - MP Equipped`
  - `Power Settings - Cruise & Descent`
  - `Power Settings - Fundamentals`
  - `Power Settings - Nightmare Mode`
  - `Power Settings - Nightmare Mode 2`

### `quiz/questions.json` format

```json
[
  {
    "id": "DV20-001",
    "category": "Performance",
    "question": "What is the best glide speed for the DV20 in normal configuration?",
    "options": {
      "A": "60 KIAS",
      "B": "68 KIAS",
      "C": "75 KIAS",
      "D": "82 KIAS"
    },
    "correct": "C"
  }
]
```

Required fields per question:
- `id` (string)
- `category` (string)
- `question` (string)
- `options` object with keys `A`, `B`, `C`, `D`
- `correct` (`A`, `B`, `C`, or `D`)

## Weight & Balance

- Aircraft registry data: `data/aircraft.json`
- Aircraft type limits/performance: `data/aircraft-types.json`
- Parity test cases: `data/wb-parity-cases.json`
- Calculation engine: `src/tools/weight-balance/engine.js`
- UI module: `src/tools/weight-balance/ui.js`

The tool reproduces workbook calculations, limit warnings, envelope chart points, and EFIS export values. Inputs are saved in browser `localStorage`.

## In-Flight Guide

- Guide content is loaded from `guide/dv20-guide.json`.
- Includes seeded sections for performance, power settings, emergency procedures, and expansion placeholders.
- Use section and search filters to quickly find a value/procedure.

### `guide/dv20-guide.json` format

```json
{
  "aircraft": "DV20 Katana",
  "sections": [
    {
      "id": "performance",
      "title": "Flight Performance Quick Reference",
      "items": [
        {
          "type": "speed",
          "label": "Best glide",
          "value": "75 KIAS",
          "note": "AFM reference required for final dispatch values."
        }
      ]
    }
  ]
}
```

Required structure:
- top-level `aircraft` (string)
- top-level `sections` (array)
- section fields: `id`, `title`, `items`
- item fields: `type`, `label`, `value`, `note` (strings; keep concise)

## Extending To More Aircraft

Current app paths:
- `quiz/questions.json`
- `guide/dv20-guide.json`

To extend:
1. Add new question banks and guide files, e.g. `quiz/da40.json`, `guide/da40-guide.json`.
2. Keep the same schema so existing renderers continue working.
3. Add an aircraft selector later and map selected aircraft to the corresponding JSON paths.
4. Keep AFM/POH values conservative and checklist-aligned.

## Local run

Because browsers restrict `fetch()` from `file://`, run a local server:

```bash
python -m http.server 8080
```

Open <http://localhost:8080>.

## KMZ files

1. Put your KMZ files in `data/`.
2. Edit `data/kmz-manifest.json`:

```json
{
  "files": [
    "./data/your-file-1.kmz",
    "./data/your-file-2.kmz"
  ]
}
```

3. Reload the page if you changed the manifest.
4. Use the per-file toggle buttons to turn each KMZ layer on/off (multiple can be active).

## GitHub Pages deploy

This project is now configured for GitHub Pages via GitHub Actions.

### One-time setup on GitHub

1. Push this repository to GitHub.
2. Open repository **Settings** -> **Pages**.
3. Set **Source** to **GitHub Actions**.
4. Keep your default branch as `main` (or update workflow branch trigger if you use a different branch).

### Deploy flow

- Workflow file: `.github/workflows/deploy-pages.yml`
- Trigger: every push to `main` (and manual `workflow_dispatch`)
- Publish target: repository root as static artifact

After pushing to `main`, GitHub will build and publish automatically. Your site URL will appear in the workflow summary and Pages settings.

### If you prefer branch deploy instead of Actions

Set Pages source to branch `main` and folder `/ (root)`.

## Git ignore policy

The project `.gitignore` is set to ignore document/spreadsheet binaries such as:

- `*.pdf`
- `*.xls`, `*.xlsx`, `*.xlsm`, `*.xlsb`
- `*.ods`, `*.doc`, `*.docx`, `*.ppt`, `*.pptx`

And it explicitly keeps:

- `*.json` (including `quiz/questions.json`)
- `*.kmz`
