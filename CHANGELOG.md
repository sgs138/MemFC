# Changelog

All notable changes to MemFC will be documented in this file.

## [0.0.1.0] - 2026-03-29

### Added
- SAM Fill: AI-powered segmentation via Replicate serverless proxy (`api/sam.js` + `src/useSAM.js`). Paints pixel mask from up to 10 sampled points, calls `meta/sam-2-video` on Replicate, returns binary mask scaled to match app mask format
- Mouse support for annotation canvas: paint, pan, and region tap now work on desktop in addition to touch
- `vercel.json` with `maxDuration: 60` for SAM serverless function and `NetworkOnly` service worker rule for `/api/` routes

### Fixed
- SAM result discarded if user cancels/finishes painting while segmentation is in-flight
- Smart Fill and Undo Fill buttons disabled during SAM in-flight to prevent mask state race
- SAM error handler resets `smartFilled` state and guards against null `prevMaskRef`
- `canvas.toBlob` null return produces a clear error instead of a cryptic TypeError
- Poll loop exits cleanly if Replicate returns a response without a `status` field
- SSRF guard: mask URL validated as `https://` before server-side fetch
- `MASK_MAX_DIM` constant exported from `maskUtils.js` and imported in `useSAM.js` — single source of truth
