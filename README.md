# MemFC

Image-based spatial flashcard PWA. Photograph any document, paint pixel-mask regions, quiz yourself in two directions: tap-to-locate and identify-region.

## Dev

```bash
fnm use 22
npm install       # first time or after pulling changes
npm run dev       # http://localhost:5174
```

## Clean install

```bash
fnm use 22
rm -rf node_modules
npm install
```

## Deploy

```bash
fnm use 22
npm run build
vercel --prod --yes
```

Live at: https://memfc.vercel.app

## Stack

- React + Vite
- IndexedDB via `idb` (offline storage)
- `vite-plugin-pwa` (service worker + web app manifest)
- Deployed on Vercel

## Install as standalone app (iOS)

1. Open https://memfc.vercel.app in Safari
2. Share → Add to Home Screen
