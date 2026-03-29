/**
 * generateCanadaDeck.mjs
 *
 * Generates public/demo/canada_provinces.memfc from the Canada provinces SVG.
 * Run with:  node scripts/generateCanadaDeck.mjs
 *
 * Requires: @resvg/resvg-js and canvas (dev dependencies)
 */

import { createCanvas, createImageData } from 'canvas'
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH  = join(__dirname, '../public/demo/canada_provinces.memfc')
const SVG_PATH  = join(__dirname, 'canada_provinces_source.svg')

// ── Province data ─────────────────────────────────────────────────────────────
const PROVINCES = [
  { cssClass: 'BC',   name: 'British Columbia',              capital: 'Victoria' },
  { cssClass: 'ALTA', name: 'Alberta',                       capital: 'Edmonton' },
  { cssClass: 'SASK', name: 'Saskatchewan',                  capital: 'Regina' },
  { cssClass: 'MAN',  name: 'Manitoba',                      capital: 'Winnipeg' },
  { cssClass: 'ONT',  name: 'Ontario',                       capital: 'Toronto' },
  { cssClass: 'QUE',  name: 'Quebec',                        capital: 'Quebec City' },
  { cssClass: 'NB',   name: 'New Brunswick',                 capital: 'Fredericton' },
  { cssClass: 'NS',   name: 'Nova Scotia',                   capital: 'Halifax' },
  { cssClass: 'PEI',  name: 'Prince Edward Island',          capital: 'Charlottetown' },
  { cssClass: 'NFLD', name: 'Newfoundland and Labrador',     capital: "St. John's" },
  { cssClass: 'YK',   name: 'Yukon',                         capital: 'Whitehorse' },
  { cssClass: 'NWT',  name: 'Northwest Territories',         capital: 'Yellowknife' },
  { cssClass: 'NU',   name: 'Nunavut',                       capital: 'Iqaluit' },
]

// Colors for the main deck image (one per province)
const PROVINCE_COLORS = [
  '#4e9af1', '#f0a500', '#6abf69', '#e05252',
  '#9b59b6', '#26a69a', '#ff7043', '#5c6bc0',
  '#ec407a', '#8d6e63', '#00acc1', '#66bb6a', '#ffa726',
]

// Mask max dimension (matches maskUtils.js MASK_MAX_DIM)
const MASK_MAX_DIM = 256

// Image size for the embedded map (SVG natural size)
const IMG_W = 978
const IMG_H = 950

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

function pixelsToBase64(arr) {
  return Buffer.from(arr).toString('base64')
}

/**
 * The SVG paths have inline fill attributes/styles, so CSS overrides don't work.
 * We must replace fill values directly in the path elements.
 *
 * Strategy: Replace all province-class elements' inline fills.
 * Each province path looks like: class="BC" fill="#88bb88" ... style="fill:#88bb88; fill-opacity:1"
 */
function setProvinceFills(svgText, colorMap) {
  // colorMap: { 'BC': '#ff0000', 'ALTA': '#ffffff', ... }
  let result = svgText
  for (const [cls, color] of Object.entries(colorMap)) {
    // We'll do a two-pass replacement for each element with class="CLS":
    // Replace fill attribute and fill in style attribute
    // Use a replacer function to only modify elements that have class="CLS"
    result = result.replace(
      new RegExp(`(class="${cls}"[^>]*?)fill="#[0-9a-fA-F]+"`, 'g'),
      `$1fill="${color}"`
    )
    result = result.replace(
      new RegExp(`(class="${cls}"[^>]*)style="fill:#[0-9a-fA-F]+;`, 'g'),
      `$1style="fill:${color};`
    )
    // Also handle class="CLS"\n      fill="..." (fill attr on next line/different position)
    result = result.replace(
      new RegExp(`(id="[^"]*"\\s+class="${cls}"[^>]*?\\n[^>]*?)fill="#[0-9a-fA-F]+"`, 'g'),
      `$1fill="${color}"`
    )
  }
  return result
}

/**
 * The Newfoundland island path has no class attribute, only id="Newfoundland".
 * Handle it explicitly wherever we set province colors.
 */
function fixNewfoundlandFill(svgText, color) {
  // id and fill are on separate lines, so use [\s\S]*? to match across lines.
  // Also replace fill in the style attribute.
  let result = svgText.replace(
    /(id="Newfoundland"[\s\S]*?)fill="#[0-9a-fA-F]+"/,
    `$1fill="${color}"`
  )
  result = result.replace(
    /(id="Newfoundland"[\s\S]*?style="fill:)#[0-9a-fA-F]+/,
    `$1${color}`
  )
  return result
}

/**
 * Build SVG with only targetClass in fillColor, everything else in bgColor.
 */
function buildSingleProvinceSvg(svgText, targetClass, fillColor, bgColor) {
  const colorMap = {}
  for (const { cssClass } of PROVINCES) {
    colorMap[cssClass] = cssClass === targetClass ? fillColor : bgColor
  }
  const nfldColor = targetClass === 'NFLD' ? fillColor : bgColor
  return fixNewfoundlandFill(setProvinceFills(svgText, colorMap), nfldColor)
}

/**
 * Build the colorized SVG where each province has a distinct color.
 */
function buildColorizedSvg(svgText) {
  const colorMap = {}
  for (let i = 0; i < PROVINCES.length; i++) {
    colorMap[PROVINCES[i].cssClass] = PROVINCE_COLORS[i]
  }
  const nfldColor = PROVINCE_COLORS[PROVINCES.findIndex(p => p.cssClass === 'NFLD')]
  return fixNewfoundlandFill(setProvinceFills(svgText, colorMap), nfldColor)
}

/**
 * Render SVG string to raw RGBA pixels at given dimensions using resvg.
 */
function renderSvg(svgText, width, height) {
  const resvg = new Resvg(svgText, {
    fitTo: { mode: 'width', value: width },
    background: 'white',
  })
  const rendered = resvg.render()
  // rendered.pixels is Uint8Array of RGBA
  return { pixels: rendered.pixels, width: rendered.width, height: rendered.height }
}

/**
 * Extract binary mask: pixel is "on" if it differs from white by more than threshold.
 */
function extractBinaryMask(rgbaPixels, w, h, threshold = 30) {
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = rgbaPixels[i * 4]
    const g = rgbaPixels[i * 4 + 1]
    const b = rgbaPixels[i * 4 + 2]
    const diff = (255 - r) + (255 - g) + (255 - b)
    mask[i] = diff > threshold ? 1 : 0
  }
  return mask
}

/**
 * Compute mask dimensions (max dim = MASK_MAX_DIM, preserving aspect ratio).
 */
function maskDims(imgW, imgH) {
  const scale = MASK_MAX_DIM / Math.max(imgW, imgH)
  return { mw: Math.round(imgW * scale), mh: Math.round(imgH * scale) }
}

/**
 * Render SVG at mask resolution and extract binary mask.
 */
function renderMask(svgText, mw, mh) {
  const { pixels, width, height } = renderSvg(svgText, mw, mh)
  return extractBinaryMask(pixels, width, height)
}

/**
 * Render colorized SVG to JPEG data URL.
 */
function renderToDataUrl(svgText, width, height) {
  const { pixels, width: w, height: h } = renderSvg(svgText, width, height)
  // Use canvas to convert RGBA → JPEG data URL
  const cvs = createCanvas(w, h)
  const ctx = cvs.getContext('2d')
  const imgData = createImageData(new Uint8ClampedArray(pixels), w, h)
  ctx.putImageData(imgData, 0, 0)
  return cvs.toDataURL('image/jpeg', 0.85)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(SVG_PATH)) {
    console.error(`SVG source not found at ${SVG_PATH}`)
    console.error('Run: curl -L "https://upload.wikimedia.org/wikipedia/commons/b/b2/Canada_provinces-blank-map_XMLcomments-CSSclasses-SVGids_green.svg" -o scripts/canada_provinces_source.svg')
    process.exit(1)
  }

  console.log('Loading SVG…')
  const svgText = readFileSync(SVG_PATH, 'utf8')

  const { mw, mh } = maskDims(IMG_W, IMG_H)
  console.log(`Image: ${IMG_W}×${IMG_H}  Mask: ${mw}×${mh}`)

  // 1. Render colorized map as the deck image
  console.log('Rendering colorized deck image…')
  const colorSvg = buildColorizedSvg(svgText)
  const imageBase64 = renderToDataUrl(colorSvg, IMG_W, IMG_H)
  console.log(`  Image data URL length: ${imageBase64.length}`)

  // 2. Render each province mask
  const regions = []
  for (let i = 0; i < PROVINCES.length; i++) {
    const { cssClass, name, capital } = PROVINCES[i]
    process.stdout.write(`  Masking ${name} (.${cssClass})…`)

    const singleSvg = buildSingleProvinceSvg(svgText, cssClass, '#000000', '#ffffff')
    const maskPixels = renderMask(singleSvg, mw, mh)

    const filled = maskPixels.reduce((n, v) => n + v, 0)
    if (filled === 0) {
      console.log(` ⚠️  EMPTY — CSS class may not match`)
    } else {
      const pct = ((filled / (mw * mh)) * 100).toFixed(1)
      console.log(` ✓ ${filled} px (${pct}%)`)
    }

    regions.push({
      id: uuid(),
      fields: [
        { key: 'name', value: name },
        { key: 'capital', value: capital },
      ],
      mask: { width: mw, height: mh, pixels: pixelsToBase64(maskPixels) },
      occlusionMask: null,
      zIndex: i,
    })
  }

  // 3. Assemble the .memfc JSON
  const deck = {
    version: 1,
    name: 'Canadian Provinces & Territories',
    image: imageBase64,
    imageWidth: IMG_W,
    imageHeight: IMG_H,
    fieldKeys: ['name', 'capital'],
    regions,
    occlusionMask: null,
    createdAt: Date.now(),
    lastQuizzedAt: null,
  }

  const json = JSON.stringify(deck)
  writeFileSync(OUT_PATH, json)
  const kb = (json.length / 1024).toFixed(1)
  console.log(`\nWrote ${OUT_PATH} (${kb} KB, ${regions.length} regions)`)
}

main().catch(err => { console.error(err); process.exit(1) })
