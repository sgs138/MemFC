import { useState } from 'react'

export default function RegionDetailModal({ region, fieldKeys, onSave, onCancel, onDelete, onEditOcclusion }) {
  const [values, setValues] = useState(() => {
    const init = {}
    for (const key of fieldKeys) {
      init[key] = region?.fields.find(f => f.key === key)?.value ?? ''
    }
    return init
  })

  function handleSave() {
    const fields = fieldKeys
      .map(key => ({ key, value: values[key]?.trim() ?? '' }))
      .filter(f => f.value !== '')
    onSave(fields)
  }

  const isNew = !region
  const displayName = region?.fields.find(f => f.key === 'name')?.value
    || region?.fields[0]?.value
    || null

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-end',
      zIndex: 100,
    }}>
      <div style={{
        background: 'var(--bg)',
        width: '100%',
        maxWidth: 480,
        margin: '0 auto',
        borderRadius: '16px 16px 0 0',
        padding: '20px 16px',
        paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ flex: 1, fontSize: 17, fontWeight: 600 }}>
            {isNew ? 'New region' : (displayName ?? 'Edit region')}
          </h2>
          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onCancel}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fieldKeys.map((key, i) => (
            <div key={key}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {key}
              </label>
              <input
                type="text"
                value={values[key] ?? ''}
                onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
                autoFocus={isNew && i === 0}
                style={inputStyle}
              />
            </div>
          ))}
        </div>

        {onEditOcclusion && (
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onEditOcclusion}>
            Edit hidden pixels
          </button>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {onDelete && (
            <button className="btn btn-danger" style={{ flex: 1 }} onClick={onDelete}>
              Delete
            </button>
          )}
          <button className="btn" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  fontSize: 14,
  background: 'var(--bg)',
  color: 'var(--text)',
  boxSizing: 'border-box',
}
