import { uuid } from './imageUtils'

// ──────────────────────────────────────────────────────────────────────────────
// .memfc file format v1
//
// {
//   version: 1,
//   name: string,
//   image: "data:image/jpeg;base64,...",   // from FileReader.readAsDataURL
//   imageWidth: number,
//   imageHeight: number,
//   fieldKeys: string[],
//   regions: [{
//     id: string,
//     fields: [{key, value}],
//     mask: { width, height, pixels: string },   // pixels = base64 Uint8Array
//     occlusionMask: null | { width, height, pixels: string },
//     zIndex: number,
//   }],
//   occlusionMask: null | { width, height, pixels: string },
//   createdAt: number,
//   lastQuizzedAt: number | null,
// }
// ──────────────────────────────────────────────────────────────────────────────

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)[1]
  const binary = atob(data)
  const arr = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

function pixelsToBase64(uint8arr) {
  let binary = ''
  for (let i = 0; i < uint8arr.length; i++) binary += String.fromCharCode(uint8arr[i])
  return btoa(binary)
}

function base64ToPixels(b64) {
  const binary = atob(b64)
  const arr = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)
  return arr
}

function serializeMask(mask) {
  if (!mask) return null
  return {
    width: mask.width,
    height: mask.height,
    pixels: pixelsToBase64(mask.pixels),
  }
}

function deserializeMask(m) {
  if (!m) return null
  return {
    width: m.width,
    height: m.height,
    pixels: base64ToPixels(m.pixels),
  }
}

// Serialize an ImageDeck from IndexedDB → JSON string
export async function exportDeck(imageDeck) {
  const image = await blobToDataUrl(imageDeck.imageBlob)

  const regions = imageDeck.regions.map(r => ({
    id: r.id,
    fields: r.fields,
    mask: serializeMask(r.mask),
    occlusionMask: serializeMask(r.occlusionMask ?? null),
    zIndex: r.zIndex,
  }))

  const data = {
    version: 1,
    name: imageDeck.name,
    image,
    imageWidth: imageDeck.imageWidth,
    imageHeight: imageDeck.imageHeight,
    fieldKeys: imageDeck.fieldKeys,
    regions,
    occlusionMask: serializeMask(imageDeck.occlusionMask ?? null),
    createdAt: imageDeck.createdAt,
    lastQuizzedAt: imageDeck.lastQuizzedAt ?? null,
  }

  return JSON.stringify(data)
}

// Trigger a browser file download of the deck as a .memfc file
export async function downloadDeck(imageDeck) {
  const json = await exportDeck(imageDeck)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safeName = imageDeck.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  a.href = url
  a.download = `${safeName}.memfc`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// Share via Web Share API; falls back to download if not supported
export async function shareDeck(imageDeck) {
  const json = await exportDeck(imageDeck)
  const blob = new Blob([json], { type: 'application/json' })
  const safeName = imageDeck.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  const file = new File([blob], `${safeName}.memfc`, { type: 'application/json' })

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: imageDeck.name })
  } else {
    // Fallback: download
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}.memfc`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}

// Parse a .memfc JSON string → ImageDeck ready for putImageDeck()
export async function importDeckFromText(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Invalid .memfc file — could not parse JSON.')
  }

  if (data.version !== 1) throw new Error(`Unsupported .memfc version: ${data.version}`)
  if (!data.name || !data.image || !Array.isArray(data.regions)) {
    throw new Error('Invalid .memfc file — missing required fields.')
  }

  const imageBlob = dataUrlToBlob(data.image)

  const regions = data.regions.map(r => ({
    id: r.id ?? uuid(),
    fields: r.fields ?? [],
    mask: deserializeMask(r.mask),
    occlusionMask: deserializeMask(r.occlusionMask ?? null),
    zIndex: r.zIndex ?? 0,
  }))

  return {
    id: uuid(),   // fresh ID — never overwrite an existing deck on import
    name: data.name,
    imageBlob,
    imageWidth: data.imageWidth ?? 0,
    imageHeight: data.imageHeight ?? 0,
    fieldKeys: data.fieldKeys ?? ['name'],
    regions,
    occlusionMask: deserializeMask(data.occlusionMask ?? null),
    createdAt: data.createdAt ?? Date.now(),
    lastQuizzedAt: null,
  }
}

// Import from a File object (reads text then calls importDeckFromText)
export async function importDeckFromFile(file) {
  const text = await file.text()
  return importDeckFromText(text)
}

// Check if Web Share API supports file sharing
export const canShareFiles = navigator.canShare?.({ files: [new File([''], 'x.memfc')] }) ?? false
