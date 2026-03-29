/**
 * Vercel serverless function — SAM segmentation proxy to Replicate.
 *
 * POST body: { imageBase64: string, mimeType: string, points: [{nx, ny}], width: number, height: number }
 * Response:  { maskBase64: string, maskMimeType: string }
 */

const MODEL_VERSION = '33432afdfc06a10da6b4018932893d39b0159f838b6d11dd1236dff85cc5ec1d'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { imageBase64, mimeType, points, width, height } = req.body
  if (!imageBase64 || !points?.length || !width || !height) {
    res.status(400).json({ error: 'Missing required fields' })
    return
  }

  const token = process.env.REPLICATE_API_TOKEN
  if (!token) {
    res.status(500).json({ error: 'REPLICATE_API_TOKEN not configured' })
    return
  }

  try {
    const dataUri          = `data:${mimeType};base64,${imageBase64}`
    const clickCoordinates = points.map(p => `[${Math.round(p.nx * width)},${Math.round(p.ny * height)}]`).join(',')
    const clickLabels      = points.map(() => '1').join(',')
    const clickFrames      = points.map(() => '0').join(',')

    // Create prediction (Prefer: wait asks Replicate to resolve synchronously up to 60s)
    const createResp = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait',
      },
      body: JSON.stringify({
        version: MODEL_VERSION,
        input: {
          input_video:       dataUri,
          click_coordinates: clickCoordinates,
          click_labels:      clickLabels,
          click_frames:      clickFrames,
          mask_type:         'binary',
          output_video:      false,
          output_format:     'png',
        },
      }),
    })

    if (!createResp.ok) {
      const err = await createResp.json().catch(() => ({}))
      throw new Error(err.detail || `Replicate error ${createResp.status}`)
    }

    let prediction = await createResp.json()

    // Poll if not yet resolved
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
      await new Promise(r => setTimeout(r, 1500))
      const pollResp = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      prediction = await pollResp.json()
      if (!prediction.status) throw new Error(`Unexpected Replicate response: ${JSON.stringify(prediction).slice(0, 200)}`)
    }

    if (prediction.status !== 'succeeded') {
      throw new Error(prediction.error || 'SAM prediction failed')
    }

    const output  = prediction.output
    const maskUrl = Array.isArray(output) ? output[0] : output
    if (!maskUrl) throw new Error('No mask returned from SAM')
    if (!String(maskUrl).startsWith('https://')) throw new Error('Unexpected mask URL format')

    const maskResponse = await fetch(String(maskUrl))
    if (!maskResponse.ok) throw new Error(`Failed to fetch mask: ${maskResponse.status}`)

    const maskArrayBuffer = await maskResponse.arrayBuffer()
    const maskBase64      = Buffer.from(maskArrayBuffer).toString('base64')
    const maskMimeType    = maskResponse.headers.get('content-type') || 'image/png'

    res.status(200).json({ maskBase64, maskMimeType })
  } catch (err) {
    console.error('[api/sam] error:', err)
    res.status(500).json({ error: err.message })
  }
}
