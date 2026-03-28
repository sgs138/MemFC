import { useState, useEffect, useRef, useMemo } from 'react'
import { useApp } from './App'
import { getImageDeck } from './db'
import { hitTestMask } from './maskUtils'
import { useQuizCanvas } from './useQuizCanvas'

export default function QuizSession({ imageDeckId, questions }) {
  const { nav } = useApp()

  const [imageDeck, setImageDeck]               = useState(null)
  const [qIndex, setQIndex]                   = useState(0)
  const [phase, setPhase]                     = useState('asking')  // 'asking' | 'feedback'
  const [answeredCorrect, setAnsweredCorrect] = useState(null)
  const [score, setScore]                     = useState(0)
  const [missed, setMissed]                   = useState([])
  const [selectedChoice, setSelectedChoice]   = useState(null)
  const [tapNorm, setTapNorm]                 = useState(null)  // { nx, ny }

  const imgRef = useRef(null)

  const question = questions[qIndex]
  const region   = imageDeck?.regions.find(r => r.id === question?.regionId)
  const isLast   = qIndex === questions.length - 1

  const choices = useMemo(() => {
    if (!question || question.mode !== 'identify-region') return []
    return shuffle([question.promptValue, ...question.distractors])
  }, [qIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  const { canvasRef, displayRectRef, requestDraw } = useQuizCanvas({
    imgRef, imageDeck, question, region, phase, tapNorm, answeredCorrect,
  })
  const touchStateRef = useRef({ type: 'none' })

  // ── Load imageDeck ─────────────────────────────────────────────────────────
  useEffect(() => {
    getImageDeck(imageDeckId).then(deck => {
      if (!deck) { nav.library(); return }
      const url = URL.createObjectURL(deck.imageBlob)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        imgRef.current = img
        setImageDeck(deck)
      }
      img.onerror = () => URL.revokeObjectURL(url)
      img.src = url
    })
  }, [imageDeckId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tap to locate ─────────────────────────────────────────────────────────
  function doCanvasTap(clientX, clientY) {
    if (phase !== 'asking' || question.mode !== 'tap-to-locate') return
    if (!region?.mask) return
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const dr     = displayRectRef.current
    if (!dr) return
    const nx = (clientX - rect.left - dr.x) / dr.w
    const ny = (clientY - rect.top  - dr.y) / dr.h
    setTapNorm({ nx, ny })
    recordAnswer(hitTestMask(region.mask, nx, ny))
  }

  function touchToCanvas(touch) {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
  }

  // Touch start — begin pan or pinch gesture
  function handleCanvasTouchStart(e) {
    e.preventDefault()
    if (e.touches.length === 1) {
      const t  = e.touches[0]
      const pt = touchToCanvas(t)
      touchStateRef.current = {
        type: 'pan',
        startClientX: t.clientX, startClientY: t.clientY,
        startX: pt.x, startY: pt.y,
        lastX:  pt.x, lastY:  pt.y,
        moved: false,
      }
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

  // Touch move — pan or pinch-to-zoom; never registers as an answer
  function handleCanvasTouchMove(e) {
    e.preventDefault()
    const state = touchStateRef.current

    if (e.touches.length === 1 && state.type === 'pan') {
      const pt = touchToCanvas(e.touches[0])
      const dx = pt.x - state.lastX
      const dy = pt.y - state.lastY
      state.lastX = pt.x
      state.lastY = pt.y
      if (Math.abs(pt.x - state.startX) > 5 || Math.abs(pt.y - state.startY) > 5) state.moved = true
      const dr = displayRectRef.current
      if (dr) {
        displayRectRef.current = { ...dr, x: dr.x + dx, y: dr.y + dy }
        requestDraw()
      }
    } else if (e.touches.length >= 2 && state.type === 'pinch') {
      const p1   = touchToCanvas(e.touches[0])
      const p2   = touchToCanvas(e.touches[1])
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

  // Touch end — fire answer only on a clean single-tap (no pan, no pinch)
  function handleCanvasTouchEnd(e) {
    e.preventDefault()
    const state = touchStateRef.current

    if (state.type === 'pan' && !state.moved && e.touches.length === 0) {
      doCanvasTap(state.startClientX, state.startClientY)
    }

    if (e.touches.length === 0) {
      touchStateRef.current = { type: 'none' }
    } else if (e.touches.length === 1) {
      // One finger remains after lifting second — mark moved so it can't accidentally answer
      const t  = e.touches[0]
      const pt = touchToCanvas(t)
      touchStateRef.current = {
        type: 'pan',
        startClientX: t.clientX, startClientY: t.clientY,
        startX: pt.x, startY: pt.y,
        lastX:  pt.x, lastY:  pt.y,
        moved: true,
      }
    }
  }

  // Pointer down (mouse / stylus — skip touch, which is handled above)
  function handleCanvasPointerDown(e) {
    if (e.pointerType === 'touch') return
    doCanvasTap(e.clientX, e.clientY)
  }

  // ── Identify region ───────────────────────────────────────────────────────
  function handleChoiceSelect(value) {
    if (phase !== 'asking') return
    setSelectedChoice(value)
    recordAnswer(value === question.promptValue)
  }

  // ── Shared answer logic ───────────────────────────────────────────────────
  function recordAnswer(correct) {
    setAnsweredCorrect(correct)
    setPhase('feedback')
    if (correct) {
      setScore(s => s + 1)
    } else {
      setMissed(m => [...m, question])
    }
  }

  function handleNext() {
    if (isLast) {
      nav.quizResult(imageDeckId, score, questions.length, missed)
      return
    }
    displayRectRef.current = null  // reset zoom/pan for next question
    setQIndex(i => i + 1)
    setPhase('asking')
    setAnsweredCorrect(null)
    setSelectedChoice(null)
    setTapNorm(null)
  }

  // ── Loading guard ─────────────────────────────────────────────────────────
  if (!imageDeck || !question) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      </div>
    )
  }

  return (
    <>
      {/* Nav */}
      <div className="navbar">
        <button className="btn btn-ghost" onClick={() => nav.library()} style={{ padding: '4px 8px' }} title="Quit quiz">✕</button>
        <span className="navbar-title" style={{ fontSize: 14 }}>
          {qIndex + 1} / {questions.length}
        </span>
        <span style={{ fontSize: 14, color: 'var(--text-secondary)', marginRight: 4 }}>
          {score} ✓
        </span>
      </div>

      {/* Progress bar */}
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${((qIndex + (phase === 'feedback' ? 1 : 0)) / questions.length) * 100}%` }}
        />
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block', width: '100%', height: '52vh', flexShrink: 0, touchAction: 'none',
          cursor: question.mode === 'tap-to-locate' && phase === 'asking' ? 'crosshair' : 'default',
        }}
        onTouchStart={handleCanvasTouchStart}
        onTouchMove={handleCanvasTouchMove}
        onTouchEnd={handleCanvasTouchEnd}
        onPointerDown={handleCanvasPointerDown}
      />

      {/* Prompt / choices */}
      {question.mode === 'tap-to-locate' ? (
        <TapToLocatePrompt
          promptField={question.promptField}
          promptValue={question.promptValue}
          phase={phase}
          answeredCorrect={answeredCorrect}
        />
      ) : (
        <IdentifyRegionChoices
          choices={choices}
          correctValue={question.promptValue}
          promptField={question.promptField}
          phase={phase}
          selectedChoice={selectedChoice}
          onSelect={handleChoiceSelect}
        />
      )}

      {/* Next / Finish */}
      {phase === 'feedback' && (
        <div style={{ padding: '8px 16px 16px', flexShrink: 0 }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px', fontSize: 15 }}
            onClick={handleNext}
          >
            {isLast ? 'See Results' : 'Next →'}
          </button>
        </div>
      )}
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TapToLocatePrompt({ promptField, promptValue, phase, answeredCorrect }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'var(--surface)',
      borderTop: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      textAlign: 'center',
    }}>
      {phase === 'asking' ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            Tap the region for the {promptField}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{promptValue}</div>
        </>
      ) : (
        <>
          <div style={{
            fontSize: 15, fontWeight: 600, marginBottom: 2,
            color: answeredCorrect ? 'var(--success)' : 'var(--danger)',
          }}>
            {answeredCorrect ? '✓ Correct' : '✗ Incorrect'}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{promptValue}</div>
          {!answeredCorrect && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              The correct region is highlighted in red above
            </div>
          )}
        </>
      )}
    </div>
  )
}

function IdentifyRegionChoices({ choices, correctValue, promptField, phase, selectedChoice, onSelect }) {
  return (
    <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 2 }}>
        What is the <strong>{promptField}</strong> of the highlighted region?
      </p>
      {choices.map(value => {
        const isCorrect  = value === correctValue
        const isSelected = value === selectedChoice
        let borderColor = 'var(--border)'
        let bg    = 'var(--bg)'
        let color = 'var(--text)'
        if (phase === 'feedback') {
          if (isCorrect)       { bg = '#f0fff4'; borderColor = 'var(--success)'; color = 'var(--success)' }
          else if (isSelected) { bg = '#fff0f0'; borderColor = 'var(--danger)';  color = 'var(--danger)'  }
        }
        return (
          <button
            key={value}
            onClick={() => onSelect(value)}
            disabled={phase === 'feedback'}
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius)',
              border: `1px solid ${borderColor}`,
              background: bg, color,
              fontSize: 14, fontWeight: 500,
              textAlign: 'left',
              cursor: phase === 'asking' ? 'pointer' : 'default',
            }}
          >
            {value}
          </button>
        )
      })}
    </div>
  )
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
