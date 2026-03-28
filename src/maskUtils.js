/**
 * Pixel-mask utilities for region annotation and quiz rendering.
 *
 * Masks are stored at a fixed logical resolution (≤256px on the longest side)
 * as a flat Uint8Array of 0/1 values, one byte per pixel.
 */

const MASK_MAX_DIM = 256

// ── Mask lifecycle ────────────────────────────────────────────────────────────

export function createMask(imgWidth, imgHeight) {
  const scale  = Math.min(1, MASK_MAX_DIM / Math.max(imgWidth || 1, imgHeight || 1))
  const width  = Math.max(1, Math.round((imgWidth  || MASK_MAX_DIM) * scale))
  const height = Math.max(1, Math.round((imgHeight || MASK_MAX_DIM) * scale))
  return { width, height, pixels: new Uint8Array(width * height) }
}

export function cloneMask(mask) {
  return { width: mask.width, height: mask.height, pixels: new Uint8Array(mask.pixels) }
}

export function isMaskEmpty(mask) {
  for (let i = 0; i < mask.pixels.length; i++) {
    if (mask.pixels[i]) return false
  }
  return true
}

// ── Painting ──────────────────────────────────────────────────────────────────

/**
 * Paint or erase a circular brush stroke at normalized position (nx, ny).
 * brushNorm is the brush radius expressed as a fraction of mask width.
 * Mutates mask in place.
 */
export function paintAt(mask, nx, ny, brushNorm, erase = false) {
  const cx = nx * mask.width
  const cy = ny * mask.height
  const r  = brushNorm * mask.width
  const r2 = r * r
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(mask.width  - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(mask.height - 1, Math.ceil(cy + r))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) {
        mask.pixels[y * mask.width + x] = erase ? 0 : 1
      }
    }
  }
}

// ── Hit testing ───────────────────────────────────────────────────────────────

export function hitTestMask(mask, nx, ny) {
  if (!mask) return false
  const x = Math.min(mask.width  - 1, Math.max(0, Math.round(nx * (mask.width  - 1))))
  const y = Math.min(mask.height - 1, Math.max(0, Math.round(ny * (mask.height - 1))))
  return mask.pixels[y * mask.width + x] === 1
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Draw a mask as a colored overlay onto a canvas 2D context.
 * imgRect: { x, y, w, h } — position of the image within the current ctx transform.
 */
export function drawMaskOverlay(ctx, mask, imgRect, r, g, b, alpha) {
  const off  = document.createElement('canvas')
  off.width  = mask.width
  off.height = mask.height
  const octx = off.getContext('2d')
  const data = octx.createImageData(mask.width, mask.height)
  for (let i = 0; i < mask.pixels.length; i++) {
    if (mask.pixels[i]) {
      data.data[i * 4]     = r
      data.data[i * 4 + 1] = g
      data.data[i * 4 + 2] = b
      data.data[i * 4 + 3] = alpha
    }
  }
  octx.putImageData(data, 0, 0)
  ctx.drawImage(off, imgRect.x, imgRect.y, imgRect.w, imgRect.h)
}

// ── Layout helpers ────────────────────────────────────────────────────────────

/**
 * Compute the letterboxed image rect (x, y, w, h) in CSS pixels
 * that fits imgW×imgH inside containerW×containerH with aspect ratio preserved.
 */
export function fitRect(imgW, imgH, containerW, containerH) {
  const imgAspect = imgW / imgH
  const boxAspect = containerW / containerH
  let w, h
  if (imgAspect > boxAspect) {
    w = containerW; h = containerW / imgAspect
  } else {
    h = containerH; w = containerH * imgAspect
  }
  return { x: (containerW - w) / 2, y: (containerH - h) / 2, w, h }
}

/**
 * Convert a screen point (clientX, clientY) to normalized image coordinates
 * given an <img> element rendered with object-fit: contain.
 */
export function screenToNorm(clientX, clientY, imgEl) {
  const elRect = imgEl.getBoundingClientRect()
  const ir = fitRect(imgEl.naturalWidth, imgEl.naturalHeight, elRect.width, elRect.height)
  return {
    nx: (clientX - elRect.left - ir.x) / ir.w,
    ny: (clientY - elRect.top  - ir.y) / ir.h,
  }
}

// ── Color ─────────────────────────────────────────────────────────────────────

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Compute the median [r, g, b] of image pixels that fall within a mask.
 * imageData is an ImageData object covering the image rect in physical pixels.
 * The mask's logical pixel grid is mapped onto imageData's dimensions.
 */
export function medianMaskColor(imageData, mask) {
  const { data, width, height } = imageData
  const rs = [], gs = [], bs = []

  for (let my = 0; my < mask.height; my++) {
    for (let mx = 0; mx < mask.width; mx++) {
      if (!mask.pixels[my * mask.width + mx]) continue
      const nx = (mx + 0.5) / mask.width
      const ny = (my + 0.5) / mask.height
      const px = Math.min(width  - 1, Math.max(0, Math.round(nx * width)))
      const py = Math.min(height - 1, Math.max(0, Math.round(ny * height)))
      const idx = (py * width + px) * 4
      rs.push(data[idx])
      gs.push(data[idx + 1])
      bs.push(data[idx + 2])
    }
  }

  if (rs.length === 0) return [128, 128, 128]

  rs.sort((a, b) => a - b)
  gs.sort((a, b) => a - b)
  bs.sort((a, b) => a - b)

  const mid = Math.floor(rs.length / 2)
  return [rs[mid], gs[mid], bs[mid]]
}
