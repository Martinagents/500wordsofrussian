# 500 Words of Russian

Static, offline-capable MVP PWA for learning immediately useful Russian before **2026-07-15**. It has Today, Study, Progress, Library, and Data/settings screens; production/listening/reading cards; local progress; export/import; and a generated 500-item curriculum.

## Run

```bash
npm run generate:curriculum
npm run validate:curriculum
npm run typecheck
npm test
npm run build
npm run dev
```

`npm run build` writes `dist/`, which can be deployed to GitHub Pages. This repository declares React/Vite/PWA dependencies for a normal install, while the checked-in MVP build script is dependency-light so the app remains buildable in restricted environments.

## Curriculum

Inspect `src/data/deck.generated.json`, `curriculum/generated/deck-report.md`, and `curriculum/generated/deck-report.csv`. Stable item IDs are not rank-based, and card IDs are `<item-id>:<card-type>`, so reordered decks preserve progress.

## Sources actually used

The generator documents four source categories: `wordfreq-ru-2026`, `rnc-frequency-dictionary`, `elementary-lexical-minimum`, and `editorial-communicative-layer`. See `curriculum/README.md`. The current checked-in sources are transformation/metadata files rather than live downloads; no fabricated remote download is claimed.

## GitHub Pages

Enable **Settings → Pages → Build and deployment → GitHub Actions**. Optionally set `VITE_BASE_PATH` for project pages. The workflow runs curriculum validation, typecheck, tests, build, then deploys `dist/`.

## iPhone install and offline behavior

Open the Pages URL in Safari, wait for the “ready for offline use” message, then Share → Add to Home Screen. The service worker caches the app shell after first load. Audio uses browser Russian speech synthesis unless future `audioUrl` MP3 files are added.

## Export/import

Data/settings offers Export Progress (JSON), Import Progress, and Reset Progress. Imports validate schema before merging matching stable card IDs; removed IDs are ignored by the runtime.

## Limitations

No backend, accounts, notifications, speech recognition, native-speaker certification, or generated MP3 audio. The curriculum is source-grounded and reproducible but should receive further native review.
