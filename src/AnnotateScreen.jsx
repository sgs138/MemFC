import { useState, useEffect, useRef } from 'react'
import { useApp } from './App'
import { getImageDeck, putImageDeck } from './db'
import { uuid } from './imageUtils'
import { createMask, cloneMask, isMaskEmpty, fitRect } from './maskUtils'
import { useAnnotateCanvas, OVERLAY_COLORS } from './useAnnotateCanvas'
import { useAnnotateTouch } from './useAnnotateTouch'
import { useSAM, SAM_IDLE, SAM_LOADING_MODEL, SAM_EMBEDDING, SAM_READY, SAM_ERROR } from './useSAM'
import RegionDetailModal from './RegionDetailModal'

const IDLE      = 'idle'
const PAINTING  = 'painting'
const OCCLUDING = 'occluding'

export default function AnnotateScreen({ imageDeckId }) {
  const { nav } = useApp()

  // ── React state (drives JSX re-renders) ───────────────────────────────────
  const [imageDeck, setImageDeck]                 = useState(null)
  const [mode, setMode]                         = useState(IDLE)
  const [erasing, setErasing]                   = useState(false)
  const [modalOpen, setModalOpen]               = useState(false)
  const [selectedRegionId, setSelectedRegionId] = useState(null)
  const [occludingRegionId, setOccludingRegionId] = useState(null)
  const [paintingSubmode, setPaintingSubmode]     = useState('region') // 'region' | 'occlusion'
  const [saving, setSaving]                     = useState(false)
  const [error, setError]                       = useState(null)
  const [aiMode, setAiMode]                     = useState(false)     // AI segment toggle
  const [aiProposalPending, setAiProposalPending] = useState(false)   // SAM result awaiting accept/reject
  const [editingName, setEditingName]           = useState(false)
  const [draftName, setDraftName]               = useState('')

  // ── Refs (mutated during touch events without causing re-renders) ─────────
  const imgRef               = useRef(null)    // loaded HTMLImageElement
  const imageDeckRef          = useRef(null)    // mirrors imageDeck state
  const modeRef              = useRef(IDLE)    // mirrors mode state
  const erasingRef           = useRef(false)   // mirrors erasing state
  const displayRectRef       = useRef(null)    // { x, y, w, h } in CSS px
  const currentMaskRef       = useRef(null)    // region mask being painted
  const occlusionWorkRef     = useRef(null)    // occlusion mask work-in-progress
  const occludingRegionIdRef  = useRef(null)    // which region's occlusion is being edited
  const paintingSubmodeRef    = useRef('region') // mirrors paintingSubmode
  const aiModeRef             = useRef(false)    // mirrors aiMode
  const aiProposalMaskRef     = useRef(null)     // pending SAM mask awaiting accept/reject

  // Keep refs in sync with state
  useEffect(() => { imageDeckRef.current = imageDeck },                   [imageDeck])
  useEffect(() => { modeRef.current = mode },                           [mode])
  useEffect(() => { erasingRef.current = erasing },                     [erasing])
  useEffect(() => { occludingRegionIdRef.current = occludingRegionId }, [occludingRegionId])
  useEffect(() => { paintingSubmodeRef.current = paintingSubmode },    [paintingSubmode])
  useEffect(() => { aiModeRef.current = aiMode },                      [aiMode])

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const { aiState, loadProgress, activateAI, deactivateAI, promptPoint } = useSAM()

  const { canvasRef, requestDraw } = useAnnotateCanvas({
    imgRef, imageDeckRef, displayRectRef,
    modeRef, occludingRegionIdRef, occlusionWorkRef, currentMaskRef,
    aiProposalMaskRef,
  })

  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useAnnotateTouch({
    canvasRef, displayRectRef, modeRef, erasingRef, paintingSubmodeRef,
    currentMaskRef, occlusionWorkRef, imageDeckRef, requestDraw,
    onRegionTap: regionId => { setSelectedRegionId(regionId); setModalOpen(true) },
    aiModeRef,
    onAiTap: handleAiTap,
  })

  // ── Load imageDeck ─────────────────────────────────────────────────────────
  useEffect(() => {
    getImageDeck(imageDeckId).then(deck => {
      if (!deck) { nav.library(); return }
      if (!deck.imageBlob) {
        setError('Image data missing — try re-importing this deck.')
        imageDeckRef.current = deck; setImageDeck(deck); return
      }
      const url = URL.createObjectURL(deck.imageBlob)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        imgRef.current = img
        imageDeckRef.current = deck
        setImageDeck(deck)
        const canvas = canvasRef.current
        if (canvas && canvas.offsetWidth > 0 && canvas.offsetHeight > 0) {
          displayRectRef.current = fitRect(img.naturalWidth, img.naturalHeight, canvas.offsetWidth, canvas.offsetHeight)
        }
        requestDraw()
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        setError('Image failed to load.')
        imageDeckRef.current = deck; setImageDeck(deck)
      }
      img.src = url
    }).catch(err => setError('Failed to load: ' + err.message))
  }, [imageDeckId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save ──────────────────────────────────────────────────────────────────
  async function save(updatedDeck) {
    setSaving(true)
    imageDeckRef.current = updatedDeck
    setImageDeck(updatedDeck)
    requestDraw()
    try {
      await putImageDeck(updatedDeck)
    } catch (err) {
      setError(err.message === 'STORAGE_FULL'
        ? 'Storage full — delete some decks to continue.'
        : 'Failed to save — please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── AI segmentation ───────────────────────────────────────────────────────
  async function handleAiToggle() {
    if (aiMode) {
      // Turn off: clear any pending proposal
      aiProposalMaskRef.current = null
      setAiProposalPending(false)
      setAiMode(false)
      aiModeRef.current = false
      deactivateAI()
      requestDraw()
    } else {
      // Turn on: load model + compute embedding
      setAiMode(true)
      aiModeRef.current = true
      const deck = imageDeckRef.current
      if (deck?.imageBlob) {
        try {
          await activateAI(deck.imageBlob, deck.id)
        } catch {
          setError('AI model failed to load. Check your connection and try again.')
          setAiMode(false)
          aiModeRef.current = false
        }
      }
    }
  }

  async function handleAiTap(nx, ny) {
    if (!currentMaskRef.current) return
    const mask = currentMaskRef.current
    try {
      const proposal = await promptPoint(nx, ny, mask.width, mask.height)
      if (proposal) {
        aiProposalMaskRef.current = proposal
        setAiProposalPending(true)
        requestDraw()
      }
    } catch {
      setError('AI segmentation failed — tap again or paint manually.')
    }
  }

  function handleAiAccept() {
    const proposal = aiProposalMaskRef.current
    const current  = currentMaskRef.current
    if (proposal && current) {
      // Merge proposal into current mask (bitwise OR)
      for (let i = 0; i < current.pixels.length; i++) {
        current.pixels[i] = current.pixels[i] | proposal.pixels[i]
      }
    }
    aiProposalMaskRef.current = null
    setAiProposalPending(false)
    requestDraw()
  }

  function handleAiReject() {
    aiProposalMaskRef.current = null
    setAiProposalPending(false)
    requestDraw()
  }

  // ── Mode management ───────────────────────────────────────────────────────
  function startNewRegion() {
    const deck = imageDeckRef.current
    if (!deck) return
    const imgW = imgRef.current?.naturalWidth  || deck.imageWidth  || 1000
    const imgH = imgRef.current?.naturalHeight || deck.imageHeight || 1000
    currentMaskRef.current   = createMask(imgW, imgH)
    occlusionWorkRef.current = createMask(imgW, imgH)
    paintingSubmodeRef.current = 'region'
    modeRef.current = PAINTING; erasingRef.current = false
    setMode(PAINTING); setErasing(false); setPaintingSubmode('region'); requestDraw()
  }

  function startOccluding(regionId) {
    const deck = imageDeckRef.current
    if (!deck) return
    const region = deck.regions.find(r => r.id === regionId)
    if (!region) return
    const imgW = imgRef.current?.naturalWidth  || deck.imageWidth  || 1000
    const imgH = imgRef.current?.naturalHeight || deck.imageHeight || 1000
    occludingRegionIdRef.current = regionId
    occlusionWorkRef.current = region.occlusionMask ? cloneMask(region.occlusionMask) : createMask(imgW, imgH)
    modeRef.current = OCCLUDING; erasingRef.current = false
    setOccludingRegionId(regionId); setMode(OCCLUDING); setErasing(false); requestDraw()
  }

  function finishOccluding() {
    const mask     = occlusionWorkRef.current
    const regionId = occludingRegionIdRef.current
    occlusionWorkRef.current     = null
    occludingRegionIdRef.current = null
    modeRef.current = IDLE; erasingRef.current = false
    setOccludingRegionId(null); setMode(IDLE); setErasing(false)
    const deck = imageDeckRef.current
    save({
      ...deck,
      regions: deck.regions.map(r =>
        r.id === regionId
          ? { ...r, occlusionMask: mask && !isMaskEmpty(mask) ? mask : null }
          : r
      ),
    })
  }

  function cancelPainting() {
    currentMaskRef.current       = null
    occlusionWorkRef.current     = null
    occludingRegionIdRef.current = null
    paintingSubmodeRef.current   = 'region'
    aiProposalMaskRef.current    = null
    modeRef.current = IDLE; erasingRef.current = false
    setOccludingRegionId(null); setMode(IDLE); setErasing(false); setPaintingSubmode('region')
    setAiMode(false); setAiProposalPending(false); aiModeRef.current = false
    requestDraw()
  }

  function finishPainting() {
    if (!currentMaskRef.current || isMaskEmpty(currentMaskRef.current)) {
      setError('Paint at least one area before saving.')
      return
    }
    setSelectedRegionId(null); setModalOpen(true)
  }

  // ── Modal callbacks ───────────────────────────────────────────────────────
  function handleModalSave(fields) {
    setModalOpen(false)
    const deck = imageDeckRef.current
    if (selectedRegionId) {
      save({ ...deck, regions: deck.regions.map(r => r.id === selectedRegionId ? { ...r, fields } : r) })
    } else {
      const occ = occlusionWorkRef.current
      save({
        ...deck,
        regions: [...deck.regions, {
          id: uuid(),
          mask: cloneMask(currentMaskRef.current),
          fields,
          zIndex: deck.regions.length,
          occlusionMask: occ && !isMaskEmpty(occ) ? occ : null,
        }],
      })
      currentMaskRef.current     = null
      occlusionWorkRef.current   = null
      paintingSubmodeRef.current = 'region'
      modeRef.current = IDLE; erasingRef.current = false
      setMode(IDLE); setErasing(false); setPaintingSubmode('region')
    }
    setSelectedRegionId(null)
  }

  function handleModalCancel() { setModalOpen(false); setSelectedRegionId(null) }

  function handleDeleteRegion(regionId) {
    setModalOpen(false); setSelectedRegionId(null)
    const deck = imageDeckRef.current
    save({
      ...deck,
      regions: deck.regions
        .filter(r => r.id !== regionId)
        .map((r, i) => ({ ...r, zIndex: i })),
    })
  }

  // ── Field key management ──────────────────────────────────────────────────
  function getFieldKeys() {
    if (!imageDeck) return []
    if (imageDeck.fieldKeys?.length > 0) return imageDeck.fieldKeys
    return [...new Set(imageDeck.regions.flatMap(r => r.fields.map(f => f.key)))]
  }

  function renameFieldKey(oldKey, newKey) {
    const trimmed = newKey.trim()
    if (!trimmed || trimmed === oldKey) return
    const keys = getFieldKeys()
    if (keys.includes(trimmed)) return
    save({
      ...imageDeck,
      fieldKeys: keys.map(k => k === oldKey ? trimmed : k),
      regions: imageDeck.regions.map(r => ({
        ...r, fields: r.fields.map(f => f.key === oldKey ? { ...f, key: trimmed } : f),
      })),
    })
  }

  function addFieldKey() {
    const keys = getFieldKeys()
    let n = keys.length + 1
    let newKey = `field${n}`
    while (keys.includes(newKey)) { n++; newKey = `field${n}` }
    save({ ...imageDeck, fieldKeys: [...keys, newKey] })
  }

  function removeFieldKey(key) {
    const keys = getFieldKeys()
    if (keys.length <= 1) return
    save({
      ...imageDeck,
      fieldKeys: keys.filter(k => k !== key),
      regions: imageDeck.regions.map(r => ({ ...r, fields: r.fields.filter(f => f.key !== key) })),
    })
  }

  function moveRegion(index, direction) {
    const regions = [...imageDeck.regions]
    const target  = index + direction
    if (target < 0 || target >= regions.length) return
    ;[regions[index], regions[target]] = [regions[target], regions[index]]
    save({ ...imageDeck, regions: regions.map((r, i) => ({ ...r, zIndex: i })) })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!imageDeck) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      </div>
    )
  }

  const fieldKeys       = getFieldKeys()
  const sortedRegions   = [...imageDeck.regions].sort((a, b) => a.zIndex - b.zIndex)
  const selectedRegion  = imageDeck.regions.find(r => r.id === selectedRegionId)
  const occludingRegion = imageDeck.regions.find(r => r.id === occludingRegionId)
  const occludingLabel  = occludingRegion?.fields.find(f => f.key === fieldKeys[0])?.value
                       ?? occludingRegion?.fields[0]?.value
                       ?? 'region'

  return (
    <>
      {/* Nav */}
      <div className="navbar">
        <button className="btn btn-ghost" onClick={() => nav.library()} style={{ padding: '4px 8px' }}>‹ Back</button>
        {editingName ? (
          <input
            autoFocus type="text" value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={() => {
              const name = draftName.trim() || imageDeck.name
              setEditingName(false)
              if (name !== imageDeck.name) save({ ...imageDeck, name })
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.target.blur()
              if (e.key === 'Escape') setEditingName(false)
            }}
            style={{
              fontSize: 16, fontWeight: 600, background: 'transparent',
              border: 'none', borderBottom: '1px solid var(--primary)',
              outline: 'none', color: 'var(--text)', minWidth: 0, flex: 1, textAlign: 'center',
            }}
          />
        ) : (
          <span
            className="navbar-title"
            onClick={() => { setDraftName(imageDeck.name); setEditingName(true) }}
            title="Tap to rename" style={{ cursor: 'pointer' }}
          >
            {imageDeck.name}
          </span>
        )}
        {saving
          ? <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Saving…</span>
          : imageDeck.regions.length >= 2 && mode === IDLE && (
            <button className="btn btn-primary" style={{ padding: '4px 12px' }} onClick={() => nav.quizConfig(imageDeck.id)}>
              Quiz →
            </button>
          )
        }
      </div>

      {error && (
        <div className="error-banner" style={{ margin: '8px 16px 0' }}>
          {error}
          <button className="btn btn-ghost" style={{ float: 'right', padding: '0 4px' }} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, alignItems: 'center' }}>
        {mode === IDLE ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1, margin: 0 }}>
              {imageDeck.regions.length === 0 ? 'Tap "+ Region" to start painting' : 'Tap a region to edit · pinch to zoom'}
            </p>
            <button className="btn btn-primary" style={{ padding: '4px 12px', flexShrink: 0 }} onClick={startNewRegion}>+ Region</button>
          </>
        ) : mode === OCCLUDING ? (
          <>
            <button
              className={`btn ${erasing ? 'btn-danger' : 'btn-ghost'}`}
              style={{ padding: '4px 10px' }}
              onClick={() => { const n = !erasing; erasingRef.current = n; setErasing(n) }}
            >
              {erasing ? 'Erasing' : 'Erase'}
            </button>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1, margin: '0 4px', textAlign: 'center' }}>
              Hiding: {occludingLabel}
            </p>
            <button className="btn" style={{ padding: '4px 10px' }} onClick={cancelPainting}>Cancel</button>
            <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={finishOccluding}>Done</button>
          </>
        ) : (
          <>
            {/* AI toggle button */}
            <button
              className={`btn ${aiMode ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 10px', flexShrink: 0 }}
              onClick={handleAiToggle}
              disabled={aiState === SAM_LOADING_MODEL || aiState === SAM_EMBEDDING}
              title="AI-assisted segmentation"
            >
              {aiState === SAM_LOADING_MODEL
                ? `AI ${loadProgress}%`
                : aiState === SAM_EMBEDDING
                ? 'AI…'
                : 'AI'}
            </button>

            {aiProposalPending ? (
              /* Proposal pending: show Accept/Reject */
              <>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)', margin: '0 4px' }}>Accept segment?</span>
                <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={handleAiAccept}>Accept</button>
                <button className="btn" style={{ padding: '4px 10px' }} onClick={handleAiReject}>Reject</button>
              </>
            ) : aiMode ? (
              /* AI mode on, no proposal yet */
              <>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)', margin: '0 4px' }}>
                  {aiState === SAM_READY ? 'Tap to segment' : aiState === SAM_ERROR ? 'AI error' : '…'}
                </span>
                <button className="btn" style={{ padding: '4px 10px' }} onClick={cancelPainting}>Cancel</button>
                <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={finishPainting}>Done</button>
              </>
            ) : (
              /* Normal manual painting mode */
              <>
                <button
                  className={`btn ${erasing ? 'btn-danger' : 'btn-ghost'}`}
                  style={{ padding: '4px 10px' }}
                  onClick={() => { const next = !erasing; erasingRef.current = next; setErasing(next) }}
                >
                  {erasing ? 'Erasing' : 'Erase'}
                </button>
                <button
                  className={`btn ${paintingSubmode === 'occlusion' ? 'btn-danger' : 'btn-ghost'}`}
                  style={{ padding: '4px 10px' }}
                  onClick={() => {
                    const next = paintingSubmode === 'occlusion' ? 'region' : 'occlusion'
                    paintingSubmodeRef.current = next; setPaintingSubmode(next)
                  }}
                >
                  Occlude
                </button>
                <button className="btn" style={{ padding: '4px 10px' }} onClick={cancelPainting}>Cancel</button>
                <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={finishPainting}>Done</button>
              </>
            )}
          </>
        )}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '60vh', flexShrink: 0, touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      />

      {/* Quizzable fields */}
      <div className="screen-content" style={{ paddingBottom: 0, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', flex: 1, margin: 0 }}>QUIZZABLE FIELDS</p>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '2px 8px', color: 'var(--text-secondary)' }} onClick={addFieldKey}>
            + Add field
          </button>
        </div>
        {fieldKeys.map(key => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <input
              type="text" defaultValue={key}
              onBlur={e => renameFieldKey(key, e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
              style={{
                flex: 1, padding: '6px 10px', fontSize: 13,
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                background: 'var(--bg)', color: 'var(--text)',
              }}
            />
            {fieldKeys.length > 1 && (
              <button
                className="btn btn-ghost"
                style={{ padding: '4px 6px', color: 'var(--text-secondary)', flexShrink: 0 }}
                onClick={() => removeFieldKey(key)} aria-label={`Remove field ${key}`}
              >✕</button>
            )}
          </div>
        ))}
      </div>

      {/* Region list */}
      <div className="screen-content" style={{ paddingBottom: 16 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
          REGIONS ({imageDeck.regions.length})
        </p>
        {imageDeck.regions.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No regions yet — tap "+ Region" above to paint one.</p>
        )}
        {sortedRegions.map((r, i) => (
          <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
              background: `rgb(${OVERLAY_COLORS[i % OVERLAY_COLORS.length].join(',')})`,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.fields.find(f => f.key === fieldKeys[0])?.value ?? r.fields[0]?.value ?? `Region ${i + 1}`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {r.fields.map(f => `${f.key}: ${f.value}`).join(' · ') || 'No fields'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-ghost" style={{ padding: '2px 6px' }} onClick={() => moveRegion(i, -1)} disabled={i === 0}>↑</button>
              <button className="btn btn-ghost" style={{ padding: '2px 6px' }} onClick={() => moveRegion(i, 1)} disabled={i === sortedRegions.length - 1}>↓</button>
              <button className="btn btn-ghost" style={{ padding: '2px 6px' }} onClick={() => { setSelectedRegionId(r.id); setModalOpen(true) }}>Edit</button>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <RegionDetailModal
          region={selectedRegion ?? null}
          fieldKeys={fieldKeys}
          onSave={handleModalSave}
          onCancel={handleModalCancel}
          onDelete={selectedRegionId ? () => handleDeleteRegion(selectedRegionId) : null}
          onEditOcclusion={selectedRegionId ? () => { setModalOpen(false); startOccluding(selectedRegionId) } : null}
        />
      )}
    </>
  )
}
