import { useRef, useEffect } from 'react'
import { drawMaskOverlay, fitRect } from './maskUtils'

const IDLE      = 'idle'
const PAINTING  = 'painting'
const OCCLUDING = 'occluding'

export const OVERLAY_COLORS = [
  [80, 150, 255], [255, 160, 50],  [80, 200, 120],
  [220, 80,  80], [160, 100, 220], [0,  180, 200],
]

/**
 * Manages the annotation canvas: drawing and resize handling.
 * All drawing logic lives here; touch handling is in useAnnotateTouch.
 *
 * Accepts shared refs from AnnotateScreen — does not own them.
 * Returns { canvasRef, requestDraw }.
 */
export function useAnnotateCanvas({
  imgRef,
  imageDeckRef,
  displayRectRef,
  modeRef,
  occludingRegionIdRef,
  occlusionWorkRef,
  currentMaskRef,
  aiProposalMaskRef,  // Ref<Mask|null> — pending SAM proposal, rendered as cyan overlay
}) {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)

  function draw() {
    rafRef.current = null
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img) return

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
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, cssW, cssH)
    ctx.drawImage(img, dr.x, dr.y, dr.w, dr.h)

    const deck = imageDeckRef.current
    if (deck) {
      const sorted = [...deck.regions].sort((a, b) => a.zIndex - b.zIndex)

      if (modeRef.current === IDLE) {
        sorted.forEach((r, i) => {
          if (!r.mask) return
          const [rv, g, b] = OVERLAY_COLORS[i % OVERLAY_COLORS.length]
          drawMaskOverlay(ctx, r.mask, dr, rv, g, b, 120)
          if (r.occlusionMask) {
            drawMaskOverlay(ctx, r.occlusionMask, dr, 30, 30, 30, 200)
          }
        })
      } else if (modeRef.current === PAINTING) {
        if (currentMaskRef.current) {
          drawMaskOverlay(ctx, currentMaskRef.current, dr, 80, 150, 255, 160)
        }
        if (occlusionWorkRef.current) {
          drawMaskOverlay(ctx, occlusionWorkRef.current, dr, 30, 30, 30, 200)
        }
        // SAM proposal overlay — cyan at 60% alpha, distinct from the blue painted mask
        if (aiProposalMaskRef?.current) {
          drawMaskOverlay(ctx, aiProposalMaskRef.current, dr, 0, 200, 220, 153)
        }
      } else if (modeRef.current === OCCLUDING) {
        sorted.forEach((r, i) => {
          if (!r.mask) return
          const [rv, g, b] = OVERLAY_COLORS[i % OVERLAY_COLORS.length]
          const alpha = r.id === occludingRegionIdRef.current ? 100 : 40
          drawMaskOverlay(ctx, r.mask, dr, rv, g, b, alpha)
        })
        if (occlusionWorkRef.current) {
          drawMaskOverlay(ctx, occlusionWorkRef.current, dr, 30, 30, 30, 200)
        }
      }
    }

    ctx.restore()
  }

  function requestDraw() {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(draw)
  }

  // Resize observer — recalculates displayRect and redraws
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      if (imgRef.current && canvas.offsetWidth > 0 && canvas.offsetHeight > 0) {
        displayRectRef.current = fitRect(
          imgRef.current.naturalWidth, imgRef.current.naturalHeight,
          canvas.offsetWidth, canvas.offsetHeight,
        )
      }
      requestDraw()
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { canvasRef, requestDraw }
}
