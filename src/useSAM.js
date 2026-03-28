import { useState, useRef } from 'react'
import { createMask } from './maskUtils'

// aiState values
export const SAM_IDLE          = 'idle'
export const SAM_LOADING_MODEL = 'loading-model'
export const SAM_EMBEDDING     = 'embedding'
export const SAM_READY         = 'ready'
export const SAM_ERROR         = 'error'

/**
 * Hook that wraps the Segment Anything Model (SAM) from @xenova/transformers.
 * Lazy-loads the model on first use, computes image embeddings once per deck,
 * and exposes a promptPoint() function to segment a region from a tap.
 *
 * SAM model: Xenova/sam-vit-base (~91MB, downloaded once, cached in browser)
 */
export function useSAM() {
  const [aiState, setAiState] = useState(SAM_IDLE)
  const [loadProgress, setLoadProgress] = useState(0) // 0–100

  const modelRef            = useRef(null)  // { model, processor }
  const embeddingRef        = useRef(null)  // { imageEmbeddings, rawImage, reshapedInputSizes }
  const embeddedDeckIdRef   = useRef(null)
  const loadingRef          = useRef(false) // prevents concurrent loads

  // Nearest-neighbor resample a flat Float32Array from [samH×samW] to [outH×outW]
  // Thresholds logits at 0 (pred_masks values are before sigmoid in transformers.js v2)
  function samOutputToMask(data, samH, samW, outW, outH) {
    const mask = createMask(outW, outH)
    const scaleX = samW / outW
    const scaleY = samH / outH
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const sx = Math.min(Math.round(x * scaleX), samW - 1)
        const sy = Math.min(Math.round(y * scaleY), samH - 1)
        mask.pixels[y * outW + x] = data[sy * samW + sx] > 0 ? 1 : 0
      }
    }
    return mask
  }

  /**
   * Load the SAM model (lazy, cached).
   * Updates `aiState` to loading-model then ready-to-embed.
   */
  async function loadModel() {
    if (modelRef.current) return modelRef.current
    if (loadingRef.current) {
      // Wait for the existing load to finish
      await new Promise(resolve => {
        const check = setInterval(() => {
          if (modelRef.current) { clearInterval(check); resolve() }
        }, 200)
      })
      return modelRef.current
    }

    loadingRef.current = true
    setAiState(SAM_LOADING_MODEL)
    setLoadProgress(0)

    try {
      // Dynamic import so the large ONNX runtime is only loaded when needed
      const { SamModel, AutoProcessor, env } = await import('@xenova/transformers')

      // Disable the web worker proxy — simpler and avoids COOP/COEP requirement
      env.backends.onnx.wasm.proxy = false

      let lastReported = 0
      function onProgress(p) {
        if (p.status === 'progress' && p.total > 0) {
          const pct = Math.round((p.loaded / p.total) * 100)
          if (pct !== lastReported) {
            lastReported = pct
            setLoadProgress(pct)
          }
        }
      }

      const [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained('Xenova/sam-vit-base'),
        SamModel.from_pretrained('Xenova/sam-vit-base', { progress_callback: onProgress }),
      ])

      modelRef.current = { model, processor }
      loadingRef.current = false
      return modelRef.current
    } catch (err) {
      loadingRef.current = false
      throw err
    }
  }

  /**
   * Activate AI mode for a given image deck.
   * Loads the model (if not already loaded) and computes the image embedding.
   * @param {Blob} imageBlob - the deck's image blob
   * @param {string} deckId - used to avoid re-embedding the same deck
   */
  async function activateAI(imageBlob, deckId) {
    try {
      await loadModel()

      // Re-use cached embedding if the same deck
      if (embeddedDeckIdRef.current === deckId && embeddingRef.current) {
        setAiState(SAM_READY)
        return
      }

      setAiState(SAM_EMBEDDING)
      const { model, processor } = modelRef.current

      const { RawImage } = await import('@xenova/transformers')
      const url = URL.createObjectURL(imageBlob)
      let rawImage
      try {
        rawImage = await RawImage.fromURL(url)
      } finally {
        URL.revokeObjectURL(url)
      }

      const inputs = await processor(rawImage)
      const { image_embeddings } = await model.get_image_embeddings(inputs)

      embeddingRef.current = {
        imageEmbeddings: image_embeddings,
        rawImage,
        inputs,
      }
      embeddedDeckIdRef.current = deckId
      setAiState(SAM_READY)
    } catch (err) {
      console.error('SAM activation error:', err)
      setAiState(SAM_ERROR)
      throw err
    }
  }

  /**
   * Prompt SAM with a point at normalized image coordinates [0,1].
   * Returns a mask object { width, height, pixels: Uint8Array } in MemFC mask format,
   * or null on failure.
   *
   * @param {number} nx - normalized x [0,1] in original image space
   * @param {number} ny - normalized y [0,1] in original image space
   * @param {number} maskW - target mask width (from createMask)
   * @param {number} maskH - target mask height (from createMask)
   */
  async function promptPoint(nx, ny, maskW, maskH) {
    const embedding = embeddingRef.current
    if (!embedding || !modelRef.current) return null

    try {
      const { model, processor } = modelRef.current
      const { imageEmbeddings, rawImage, inputs } = embedding

      // Convert normalized coords to pixel coords in the original image
      const px = nx * rawImage.width
      const py = ny * rawImage.height

      const decodingInputs = await processor(rawImage, {
        input_points: [[[px, py]]],
        input_labels: [[1]],            // 1 = foreground point
      })

      const { pred_masks } = await model({
        ...decodingInputs,
        image_embeddings: imageEmbeddings,
        reshaped_input_sizes: inputs.reshaped_input_sizes,
      })

      // pred_masks.dims: [batch=1, num_masks=1, H, W]
      const [, , samH, samW] = pred_masks.dims
      const data = pred_masks.data  // Float32Array (logits — threshold at 0)

      return samOutputToMask(data, samH, samW, maskW, maskH)
    } catch (err) {
      console.error('SAM promptPoint error:', err)
      return null
    }
  }

  function deactivateAI() {
    // Don't unload the model — keep it cached for fast re-activation
    setAiState(SAM_IDLE)
  }

  return { aiState, loadProgress, activateAI, deactivateAI, promptPoint }
}
