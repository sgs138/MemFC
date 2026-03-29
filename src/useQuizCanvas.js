import { useRef, useState, useEffect } from 'react'
import { drawMaskOverlay, drawSpotlight, fitRect, medianMaskColor } from './maskUtils'

/**
 * Manages the quiz canvas: drawing overlays and occlusion fills.
 * Owns canvasRef, displayRectRef, and the resize observer.
 *
 * Returns { canvasRef, displayRectRef }.
 * displayRectRef is exposed so the parent can convert canvas taps to normalized coords.
 */
export function useQuizCanvas({ imgRef, imageDeck, question, region, phase, tapNorm, answeredCorrect }) {
  const canvasRef         = useRef(null)
  const displayRectRef    = useRef(null)
  const occlusionColorsRef = useRef({})
  const [renderTick, setRenderTick] = useState(0)
  const requestDraw = () => setRenderTick(t => t + 1)

  // Compute occlusion fill colors once per imageDeck using a stable offscreen canvas.
  // This must be independent of zoom/pan so colors don't shift while the user navigates.
  useEffect(() => {
    const img = imgRef.current
    if (!img || !imageDeck) return
    const SIZE  = 512
    const scale = Math.min(1, SIZE / Math.max(img.naturalWidth, img.naturalHeight))
    const w     = Math.max(1, Math.round(img.naturalWidth  * scale))
    const h     = Math.max(1, Math.round(img.naturalHeight * scale))
    const oc    = document.createElement('canvas')
    oc.width = w; oc.height = h
    const octx  = oc.getContext('2d')
    octx.drawImage(img, 0, 0, w, h)
    const imgPixels = octx.getImageData(0, 0, w, h)
    const colors = {}
    imageDeck.regions.forEach(reg => {
      if (reg.occlusionMask && reg.mask) {
        colors[reg.id] = medianMaskColor(imgPixels, reg.mask)
      }
    })
    occlusionColorsRef.current = colors
  }, [imageDeck]) // eslint-disable-line react-hooks/exhaustive-deps

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img || !imageDeck || !question || !region) return

    const dpr  = window.devicePixelRatio || 1
    const cssW = canvas.offsetWidth
    const cssH = canvas.offsetHeight
    if (cssW === 0 || cssH === 0) return

    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width  = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
    }
    if (!displayRectRef.current) {
      displayRectRef.current = fitRect(img.naturalWidth, img.naturalHeight, cssW, cssH)
    }

    const dr  = displayRectRef.current
    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, cssW, cssH)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, cssW, cssH)
    ctx.drawImage(img, dr.x, dr.y, dr.w, dr.h)

    const sorted          = [...imageDeck.regions].sort((a, b) => a.zIndex - b.zIndex)
    const occlusionColors = occlusionColorsRef.current

    // Build overlay color for each region based on mode/phase
    const overlayColors = new Map()
    if (question.mode === 'tap-to-locate') {
      if (phase === 'asking') {
        sorted.forEach(r => { if (r.mask) overlayColors.set(r.id, [136, 136, 136, 40]) })
      } else {
        sorted.forEach(r => {
          if (!r.mask) return
          overlayColors.set(r.id, r.id === region.id
            ? (answeredCorrect ? [0, 204, 102, 100] : [221, 0, 0, 100])
            : [136, 136, 136, 25])
        })
      }
    }

    // Draw region overlays
    sorted.forEach(r => {
      const ov = overlayColors.get(r.id)
      if (r.mask && ov) drawMaskOverlay(ctx, r.mask, dr, ...ov)
    })

    // Draw occlusion fills: median color base, then same highlight tint on top
    sorted.forEach(reg => {
      if (reg.occlusionMask) {
        const [r, g, b] = occlusionColors[reg.id] ?? [0, 0, 0]
        drawMaskOverlay(ctx, reg.occlusionMask, dr, r, g, b, 255)
        const ov = overlayColors.get(reg.id)
        if (ov) drawMaskOverlay(ctx, reg.occlusionMask, dr, ...ov)
      }
    })

    // Spotlight for identify-region: dim everything except the target region.
    // Must be drawn after occlusion fills so they get dimmed too.
    if (question.mode === 'identify-region' && region.mask) {
      drawSpotlight(ctx, region.mask, dr)
    }

    // Tap indicator drawn last so it's always on top
    if (question.mode === 'tap-to-locate' && phase !== 'asking' && tapNorm) {
      const cx = tapNorm.nx * dr.w + dr.x
      const cy = tapNorm.ny * dr.h + dr.y
      ctx.beginPath()
      ctx.arc(cx, cy, 10, 0, Math.PI * 2)
      ctx.fillStyle = answeredCorrect ? '#00cc66' : '#dd0000'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    ctx.restore()
  }, [imageDeck, phase, question?.regionId, tapNorm, answeredCorrect, renderTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      if (imgRef.current && canvas.offsetWidth > 0 && canvas.offsetHeight > 0) {
        displayRectRef.current = fitRect(
          imgRef.current.naturalWidth, imgRef.current.naturalHeight,
          canvas.offsetWidth, canvas.offsetHeight,
        )
        setRenderTick(t => t + 1)
      }
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { canvasRef, displayRectRef, requestDraw }
}
