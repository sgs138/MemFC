/**
 * Convert screen pointer coordinates to SVG normalized 0–1 space.
 * Works because the SVG uses viewBox="0 0 1 1" stretched over the image.
 *
 * @param {number} clientX
 * @param {number} clientY
 * @param {SVGElement} svgElement
 * @returns {[number, number]} normalized [x, y] in 0–1 range
 */
export function screenToSVG(clientX, clientY, svgElement) {
  const rect = svgElement.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return [0, 0]
  return [
    (clientX - rect.left) / rect.width,
    (clientY - rect.top) / rect.height,
  ]
}

/**
 * Check if two screen-space points are within thresholdPx of each other.
 * Used for the polygon close mechanic (tap near first vertex to close).
 * Always compare in screen pixels — NOT in SVG user units.
 *
 * @param {[number, number]} aClient  [clientX, clientY] of first point
 * @param {[number, number]} bClient  [clientX, clientY] of second point
 * @param {number} thresholdPx
 * @returns {boolean}
 */
export function isNearPoint(aClient, bClient, thresholdPx = 20) {
  const dx = aClient[0] - bClient[0]
  const dy = aClient[1] - bClient[1]
  return Math.hypot(dx, dy) < thresholdPx
}

/**
 * Ray-casting point-in-polygon test.
 * Both point and polygon vertices are in the same normalized 0–1 space.
 *
 * @param {[number, number]} point    [x, y] normalized
 * @param {[number, number][]} polygon  array of [x, y] vertices
 * @returns {boolean}
 */
export function pointInPolygon(point, polygon) {
  const [px, py] = point
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersect = (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Convert a normalized SVG coordinate back to screen clientX/clientY.
 * Used to get screen-space position of first vertex for isNearPoint check.
 *
 * @param {[number, number]} normCoord  normalized [x, y] in 0–1 range
 * @param {SVGElement} svgElement
 * @returns {[number, number]} [clientX, clientY]
 */
export function svgToScreen(normCoord, svgElement) {
  const rect = svgElement.getBoundingClientRect()
  return [
    normCoord[0] * rect.width + rect.left,
    normCoord[1] * rect.height + rect.top,
  ]
}
