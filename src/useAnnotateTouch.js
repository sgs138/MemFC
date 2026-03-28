import { useRef } from 'react'
import { paintAt, hitTestMask } from './maskUtils'

const PAINTING  = 'painting'
const OCCLUDING = 'occluding'
const BRUSH_PX  = 15  // brush radius in CSS pixels (fixed screen size)

/**
 * Manages all touch interaction on the annotation canvas.
 * Handles: single-finger paint strokes, single-finger pan (IDLE),
 * two-finger pinch-to-zoom, and single-tap region selection.
 *
 * Returns { handleTouchStart, handleTouchMove, handleTouchEnd }.
 */
export function useAnnotateTouch({
  canvasRef,
  displayRectRef,
  modeRef,
  erasingRef,
  paintingSubmodeRef,
  currentMaskRef,
  occlusionWorkRef,
  imageDeckRef,
  requestDraw,
  onRegionTap,   // (regionId: string) => void — called on single tap hit in IDLE
}) {
  const touchStateRef = useRef({ type: 'none' })

  function touchToCanvas(touch) {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
  }

  function canvasToNorm(cx, cy) {
    const dr = displayRectRef.current
    if (!dr || dr.w === 0 || dr.h === 0) return { nx: 0.5, ny: 0.5 }
    return { nx: (cx - dr.x) / dr.w, ny: (cy - dr.y) / dr.h }
  }

  function paintStroke(cx, cy) {
    let target
    if (modeRef.current === OCCLUDING) {
      target = occlusionWorkRef.current
    } else if (modeRef.current === PAINTING) {
      target = paintingSubmodeRef.current === 'occlusion' ? occlusionWorkRef.current : currentMaskRef.current
    }
    if (!target) return
    const { nx, ny } = canvasToNorm(cx, cy)
    const brushNorm = BRUSH_PX / (displayRectRef.current?.w || 1)
    paintAt(target, nx, ny, brushNorm, erasingRef.current)
    requestDraw()
  }

  function handleTouchStart(e) {
    e.preventDefault()
    if (e.touches.length === 1) {
      const pt = touchToCanvas(e.touches[0])
      const isPainting = modeRef.current === PAINTING || modeRef.current === OCCLUDING
      touchStateRef.current = {
        type: isPainting ? 'paint' : 'pan',
        startX: pt.x, startY: pt.y,
        lastX:  pt.x, lastY:  pt.y,
        moved: false,
      }
      if (isPainting) paintStroke(pt.x, pt.y)
    } else if (e.touches.length >= 2) {
      const p1 = touchToCanvas(e.touches[0])
      const p2 = touchToCanvas(e.touches[1])
      touchStateRef.current = {
        type:     'pinch',
        lastDist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        lastMidX: (p1.x + p2.x) / 2,
        lastMidY: (p1.y + p2.y) / 2,
      }
    }
  }

  function handleTouchMove(e) {
    e.preventDefault()
    const state = touchStateRef.current

    if (e.touches.length === 1) {
      const pt = touchToCanvas(e.touches[0])
      if (state.type === 'paint') {
        state.moved = true
        state.lastX = pt.x; state.lastY = pt.y
        paintStroke(pt.x, pt.y)
      } else if (state.type === 'pan') {
        const dx = pt.x - state.lastX
        const dy = pt.y - state.lastY
        state.lastX = pt.x; state.lastY = pt.y
        if (Math.abs(pt.x - state.startX) > 5 || Math.abs(pt.y - state.startY) > 5) state.moved = true
        const dr = displayRectRef.current
        if (dr) displayRectRef.current = { ...dr, x: dr.x + dx, y: dr.y + dy }
        requestDraw()
      }
    } else if (e.touches.length >= 2 && state.type === 'pinch') {
      const p1 = touchToCanvas(e.touches[0])
      const p2 = touchToCanvas(e.touches[1])
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      const midX = (p1.x + p2.x) / 2
      const midY = (p1.y + p2.y) / 2
      const f    = dist / state.lastDist
      const dr   = displayRectRef.current
      if (dr) {
        displayRectRef.current = {
          x: midX + (dr.x - midX) * f + (midX - state.lastMidX),
          y: midY + (dr.y - midY) * f + (midY - state.lastMidY),
          w: dr.w * f,
          h: dr.h * f,
        }
      }
      state.lastDist = dist
      state.lastMidX = midX
      state.lastMidY = midY
      requestDraw()
    }
  }

  function handleTouchEnd(e) {
    e.preventDefault()
    const state = touchStateRef.current

    // Single tap in IDLE → hit-test regions
    if (state.type === 'pan' && !state.moved && e.changedTouches.length === 1 && e.touches.length === 0) {
      const { nx, ny } = canvasToNorm(state.startX, state.startY)
      const deck = imageDeckRef.current
      if (deck) {
        const sorted = [...deck.regions].sort((a, b) => b.zIndex - a.zIndex)
        const hit = sorted.find(r => r.mask && hitTestMask(r.mask, nx, ny))
        if (hit) onRegionTap(hit.id)
      }
    }

    if (e.touches.length === 0) {
      touchStateRef.current = { type: 'none' }
    } else if (e.touches.length === 1) {
      // One finger remaining after pinch ends
      const pt = touchToCanvas(e.touches[0])
      const isPainting = modeRef.current === PAINTING || modeRef.current === OCCLUDING
      touchStateRef.current = {
        type: isPainting ? 'paint' : 'pan',
        startX: pt.x, startY: pt.y,
        lastX:  pt.x, lastY:  pt.y,
        moved: false,
      }
    }
  }

  return { handleTouchStart, handleTouchMove, handleTouchEnd }
}
