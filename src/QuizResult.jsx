import { useEffect } from 'react'
import { useApp } from './App'
import { updateLastQuizzedAt } from './db'

export default function QuizResult({ imageDeckId, score, total, missed }) {
  const { nav } = useApp()

  useEffect(() => {
    updateLastQuizzedAt(imageDeckId)
  }, [imageDeckId])

  const pct = total > 0 ? Math.round((score / total) * 100) : 0
  const grade = pct === 100 ? 'Perfect!' : pct >= 80 ? 'Great job' : pct >= 60 ? 'Keep going' : 'Keep practicing'

  return (
    <>
      <div className="navbar">
        <button className="btn btn-ghost" onClick={() => nav.library()} style={{ padding: '4px 8px' }}>‹ Library</button>
        <span className="navbar-title">Results</span>
      </div>

      <div className="screen-content">
        {/* Score summary */}
        <div className="card" style={{ textAlign: 'center', marginBottom: 16, padding: '24px 14px' }}>
          <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 4 }}>{pct}%</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{grade}</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            {score} / {total} correct
          </div>
        </div>

        {/* Missed items */}
        {missed.length > 0 && (
          <>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              MISSED ({missed.length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {missed.map((q, i) => (
                <div key={i} className="card" style={{ fontSize: 14 }}>
                  <div style={{ fontWeight: 500 }}>{q.promptValue}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {q.mode === 'tap-to-locate' ? 'Tap to Locate' : 'Identify Region'} · {q.promptField}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px' }}
            onClick={() => nav.quizConfig(imageDeckId)}
          >
            Quiz Again
          </button>
          <button
            className="btn"
            style={{ width: '100%', padding: '12px' }}
            onClick={() => nav.annotate(imageDeckId)}
          >
            Edit Regions
          </button>
          <button
            className="btn btn-ghost"
            style={{ width: '100%', padding: '12px' }}
            onClick={() => nav.library()}
          >
            Back to Library
          </button>
        </div>
      </div>
    </>
  )
}
