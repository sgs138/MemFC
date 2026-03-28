// crypto APIs require a secure context (HTTPS/localhost).
// Fall back to Math.random() for local network HTTP testing.
export function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto.getRandomValues === 'function') {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
      (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
    )
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const MAX_DIMENSION = 1920
const JPEG_QUALITY = 0.85

export async function compressImage(file, maxDimension = MAX_DIMENSION) {
  // Load image via <img> element — works reliably on iOS Safari
  const url = URL.createObjectURL(file)
  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('CORRUPT_IMAGE'))
    el.src = url
  }).finally(() => URL.revokeObjectURL(url))

  const { naturalWidth: width, naturalHeight: height } = img

  const scale = Math.min(1, maxDimension / Math.max(width, height))
  const newWidth  = Math.round(width  * scale)
  const newHeight = Math.round(height * scale)

  const canvas = document.createElement('canvas')
  canvas.width  = newWidth
  canvas.height = newHeight
  canvas.getContext('2d').drawImage(img, 0, 0, newWidth, newHeight)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('IMAGE_TOO_LARGE')),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

export function createImageDeck(name, blob) {
  return {
    id: uuid(),
    name,
    imageBlob: blob,
    imageWidth: 0,
    imageHeight: 0,
    fieldKeys: ['name'],
    regions: [],
    createdAt: Date.now(),
    lastQuizzedAt: null,
  }
}
