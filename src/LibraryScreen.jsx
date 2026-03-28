import { useState, useEffect, useRef } from 'react'
import { useApp } from './App'
import { getAllMeta, deleteImageDeck, putImageDeck } from './db'
import { compressImage, createImageDeck } from './imageUtils'

const ERROR_MESSAGES = {
  IMAGE_TOO_LARGE: 'Image too large — try a smaller or cropped photo.',
  CORRUPT_IMAGE:   'Couldn\'t read that image — try a different file.',
  STORAGE_FULL:    'Storage full — delete some decks to continue.',
}

export default function LibraryScreen() {
  const { nav } = useApp()
  const [decks, setDecks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [importing, setImporting] = useState(false)
  const [pendingBlob, setPendingBlob] = useState(null)   // blob waiting for a name
  const [draftName, setDraftName] = useState('')
  const fileInputRef = useRef(null)
  const nameInputRef = useRef(null)

  useEffect(() => {
    getAllMeta()
      .then(meta => setDecks(meta.sort((a, b) => (b.lastQuizzedAt ?? 0) - (a.lastQuizzedAt ?? 0))))
      .finally(() => setLoading(false))
  }, [])

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setError(null)
    setImporting(true)
    try {
      const blob = await compressImage(file)
      setPendingBlob(blob)
      setDraftName('')
      setImporting(false)
      setTimeout(() => nameInputRef.current?.focus(), 50)
    } catch (err) {
      setError(ERROR_MESSAGES[err.message] ?? 'Something went wrong — please try again.')
      setImporting(false)
    }
  }

  async function handleNameConfirm() {
    const name = draftName.trim()
    if (!name) return
    setImporting(true)
    try {
      const imageDeck = createImageDeck(name, pendingBlob)
      await putImageDeck(imageDeck)
      setPendingBlob(null)
      nav.annotate(imageDeck.id)
    } catch (err) {
      setError(ERROR_MESSAGES[err.message] ?? 'Something went wrong — please try again.')
    } finally {
      setImporting(false)
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    await deleteImageDeck(id)
    setDecks(prev => prev.filter(s => s.id !== id))
  }

  return (
    <>
      <div className="navbar">
        <span className="navbar-title">My FC Decks</span>
      </div>

      <div className="screen-content">
        {error && (
          <div className="error-banner">
            {error}
            <button className="btn btn-ghost" style={{ float: 'right', padding: '0 4px' }} onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {loading && <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: 40 }}>Loading…</p>}

        {!loading && decks.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 60, color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🖼️</div>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>No FC decks yet</p>
            <p style={{ fontSize: 14 }}>Tap + to import an image and start annotating</p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {decks.map(deck => (
            <DeckCard
              key={deck.id}
              deck={deck}
              onEdit={() => nav.annotate(deck.id)}
              onQuiz={() => nav.quizConfig(deck.id)}
              onDelete={() => handleDelete(deck.id, deck.name)}
            />
          ))}
        </div>

        {/* spacer so FAB doesn't overlap last card */}
        <div style={{ height: 80 }} />
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* New FC Deck modal */}
      {pendingBlob && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'flex-end', zIndex: 100,
        }}>
          <div style={{
            background: 'var(--surface)', width: '100%',
            borderRadius: 'var(--radius) var(--radius) 0 0',
            padding: '20px 16px 32px',
          }}>
            <p style={{ fontWeight: 600, fontSize: 16, marginBottom: 12 }}>New FC Deck</p>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              Topic
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleNameConfirm()}
              style={{
                width: '100%', padding: '10px 12px', fontSize: 15,
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                background: 'var(--bg)', color: 'var(--text)',
                boxSizing: 'border-box', marginBottom: 12,
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                style={{ flex: 1, padding: '10px' }}
                onClick={() => { setPendingBlob(null); setDraftName('') }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 2, padding: '10px' }}
                onClick={handleNameConfirm}
                disabled={importing || !draftName.trim()}
              >
                {importing ? '…' : 'Start Annotating'}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        className="fab"
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        aria-label="Import image"
      >
        {importing ? '…' : '+'}
      </button>
    </>
  )
}

function DeckCard({ deck, onEdit, onQuiz, onDelete }) {
  const lastQuizzed = deck.lastQuizzedAt
    ? formatRelative(deck.lastQuizzedAt)
    : 'never quizzed'

  const fieldSummary = deck.fieldKeys?.length > 0
    ? deck.fieldKeys.join(', ')
    : 'no fields'

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deck.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {deck.regionCount} region{deck.regionCount !== 1 ? 's' : ''} · {fieldSummary}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>
            {lastQuizzed}
          </div>
        </div>
        <button className="btn btn-ghost btn-danger" style={{ padding: '4px 8px', fontSize: 18 }} onClick={onDelete} aria-label="Delete deck">
          🗑
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" style={{ flex: 1 }} onClick={onEdit}>Edit</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={onQuiz} disabled={deck.regionCount < 2}>
          Quiz
        </button>
      </div>
    </div>
  )
}

function formatRelative(ts) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'quizzed just now'
  if (mins < 60)  return `quizzed ${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `quizzed ${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `quizzed ${days}d ago`
}
