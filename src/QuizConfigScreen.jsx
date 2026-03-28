import { useState, useEffect } from 'react'
import { useApp } from './App'
import { getImageDeck } from './db'
import { getQuizzableFields, buildQuestions } from './quizEngine'

const MODES = [
  {
    id: 'tap-to-locate',
    label: 'Tap to Locate',
    desc: "You're shown a label — tap the correct region on the image",
  },
  {
    id: 'identify-region',
    label: 'Identify Region',
    desc: 'A region is highlighted — pick the correct label from 4 choices',
  },
]

export default function QuizConfigScreen({ imageDeckId }) {
  const { nav } = useApp()

  const [imageDeck, setImageDeck]           = useState(null)
  const [quizzableFields, setQuizzableFields] = useState([])
  const [selectedFields, setSelectedFields] = useState([])
  const [selectedModes, setSelectedModes]   = useState(['tap-to-locate', 'identify-region'])

  useEffect(() => {
    getImageDeck(imageDeckId).then(deck => {
      if (!deck) { nav.library(); return }
      setImageDeck(deck)
      // Use deck-level fieldKeys as source of truth; derive per-key counts for warnings
      const keys = deck.fieldKeys?.length > 0
        ? deck.fieldKeys
        : getQuizzableFields(deck).map(f => f.key)
      const counts = {}
      for (const r of deck.regions) {
        for (const f of r.fields) { counts[f.key] = (counts[f.key] || 0) + 1 }
      }
      const fields = keys.map(key => ({ key, count: counts[key] || 0 }))
      setQuizzableFields(fields)
      setSelectedFields(fields.filter(f => f.count >= 2).map(f => f.key))
    })
  }, [imageDeckId])

  function toggleField(key) {
    setSelectedFields(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  function toggleMode(id) {
    setSelectedModes(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    )
  }

  function handleStart() {
    const questions = buildQuestions(imageDeck, selectedFields, selectedModes)
    nav.quizSession(imageDeck.id, questions)
  }

  const canStart = selectedFields.length > 0 && selectedModes.length > 0

  if (!imageDeck) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      </div>
    )
  }

  const questionCount = selectedFields.length * imageDeck.regions.length * selectedModes.length

  return (
    <>
      <div className="navbar">
        <button className="btn btn-ghost" onClick={() => nav.annotate(imageDeckId)} style={{ padding: '4px 8px' }}>‹ Back</button>
        <span className="navbar-title">Quiz Setup</span>
      </div>

      <div className="screen-content">
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
          FIELDS TO QUIZ
        </p>

        {quizzableFields.length === 0 ? (
          <div className="card" style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              No quizzable fields yet. Add fields to at least 2 regions with the same key.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {quizzableFields.map(({ key, count }) => {
              const selected = selectedFields.includes(key)
              const lowCount = count < 4
              return (
                <label
                  key={key}
                  className="card"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleField(key)}
                    style={{ width: 18, height: 18, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{key}</div>
                    <div style={{ fontSize: 12, color: count < 2 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                      {count === 0 ? 'no values yet'
                        : count === 1 ? '1 region — need at least 2 to quiz'
                        : `${count} regions${count < 4 ? ' · fewer than 4 values — distractors may repeat' : ''}`}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        )}

        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
          QUIZ MODES
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {MODES.map(mode => {
            const selected = selectedModes.includes(mode.id)
            return (
              <label
                key={mode.id}
                className="card"
                style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleMode(mode.id)}
                  style={{ width: 18, height: 18, flexShrink: 0, marginTop: 2 }}
                />
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{mode.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{mode.desc}</div>
                </div>
              </label>
            )
          })}
        </div>

        {canStart && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, textAlign: 'center' }}>
            ~{questionCount} question{questionCount !== 1 ? 's' : ''}
          </p>
        )}

        <button
          className="btn btn-primary"
          style={{ width: '100%', padding: '12px', fontSize: 16 }}
          onClick={handleStart}
          disabled={!canStart}
        >
          Start Quiz
        </button>
      </div>
    </>
  )
}
