import { useState } from 'react'
import { MASK_MAX_DIM } from './maskUtils'

/**
 * SAM segmentation via /api/sam (Vercel serverless proxy to Replicate).
 *
 * samStatus: null | 'resizing' | 'segmenting'
 *
 * segmentMask(imageBlob, points) → { pixels: Uint8Array, width, height }
 *   imageBlob — the deck's original image Blob
 *   points    — [{nx, ny}] normalized 0..1 coordinates of painted pixels
 */
export function useSAM() {
  const [samStatus, setSamStatus] = useState(null)

  async function segmentMask(imageBlob, points) {
    try {
      // 1. Resize image to max 1024px on longest side
      setSamStatus('resizing')
      const { blob: resizedBlob, width, height } = await resizeImage(imageBlob, 1024)

      // 2. Convert to base64
      const imageBase64 = await blobToBase64(resizedBlob)
      const mimeType    = resizedBlob.type || 'image/jpeg'

      // 3. Call server proxy
      setSamStatus('segmenting')
      const resp = await fetch('/api/sam', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64, mimeType, points, width, height }),
      })
      if (!resp.ok) {
        const { error } = await resp.json().catch(() => ({}))
        throw new Error(error || `Server error ${resp.status}`)
      }
      const { maskBase64, maskMimeType } = await resp.json()

      // 4. Extract binary mask pixels from the returned PNG
      return await extractMaskPixels(maskBase64, maskMimeType, width, height)
    } finally {
      setSamStatus(null)
    }
  }

  return { samStatus, segmentMask }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function resizeImage(blob, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
      const w     = Math.max(1, Math.round(img.naturalWidth  * scale))
      const h     = Math.max(1, Math.round(img.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width  = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (b) => b ? resolve({ blob: b, width: w, height: h }) : reject(new Error('Image encoding failed')),
        'image/jpeg',
        0.85
      )
    }
    img.onerror = reject
    img.src = url
  })
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function extractMaskPixels(maskBase64, maskMimeType, origW, origH) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = `data:${maskMimeType};base64,${maskBase64}`
    img.onload = () => {
      // Scale to our mask format (max MASK_MAX_DIM px on longest side, matching createMask)
      const scale = Math.min(1, MASK_MAX_DIM / Math.max(origW, origH))
      const outW  = Math.max(1, Math.round(origW * scale))
      const outH  = Math.max(1, Math.round(origH * scale))

      const canvas = document.createElement('canvas')
      canvas.width  = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, outW, outH)

      const { data } = ctx.getImageData(0, 0, outW, outH)
      const pixels   = new Uint8Array(outW * outH)
      for (let i = 0; i < pixels.length; i++) {
        // SAM binary mask: white (r≥128) = masked region
        pixels[i] = data[i * 4] >= 128 ? 1 : 0
      }
      resolve({ pixels, width: outW, height: outH })
    }
    img.onerror = reject
    img.src = url
  })
}
