/**
 * Build a shuffled list of quiz questions from an imageDeck.
 *
 * @param {object} imageDeck
 * @param {string[]} selectedFields  field keys to quiz on
 * @param {string[]} selectedModes   ['tap-to-locate', 'identify-region']
 * @returns {object[]} Question[]
 */
export function buildQuestions(imageDeck, selectedFields, selectedModes) {
  const questions = []

  for (const region of imageDeck.regions) {
    for (const fieldKey of selectedFields) {
      const field = region.fields.find(f => f.key === fieldKey)
      if (!field) continue // sparse field — skip this region for this key

      if (selectedModes.includes('tap-to-locate')) {
        questions.push({
          mode: 'tap-to-locate',
          regionId: region.id,
          promptField: fieldKey,
          promptValue: field.value,
          answerField: fieldKey,
          distractors: [],
        })
      }

      if (selectedModes.includes('identify-region')) {
        const distractors = generateDistractors(region, fieldKey, imageDeck.regions, field.value)
        questions.push({
          mode: 'identify-region',
          regionId: region.id,
          promptField: fieldKey,
          promptValue: field.value,
          answerField: fieldKey,
          distractors,
        })
      }
    }
  }

  return shuffle(questions)
}

/**
 * Generate exactly 3 distractor strings for an identify-region question.
 * Pulls from same field key first; pads from other keys if needed.
 *
 * KNOWN LIMITATION: cross-key padding (e.g., "Frontal Lobe" as distractor
 * for a "capital" question) allows category-recognition shortcut. Acceptable
 * for Phase 1. Quiz Config warns when a field has fewer than 4 values.
 *
 * @param {object} region         the correct region
 * @param {string} fieldKey       the field being quizzed
 * @param {object[]} allRegions   all regions in the deck
 * @param {string} correctValue   the correct answer (must be excluded)
 * @returns {string[]} exactly 3 distractor strings
 */
export function generateDistractors(region, fieldKey, allRegions, correctValue) {
  const pool = []

  // Pass 1: other regions' values for the same field key
  for (const r of allRegions) {
    if (r.id === region.id) continue
    const f = r.fields.find(f => f.key === fieldKey)
    if (f && f.value !== correctValue && !pool.includes(f.value)) {
      pool.push(f.value)
    }
  }

  // Pass 2: pad from any other field on any region
  if (pool.length < 3) {
    for (const r of allRegions) {
      for (const f of r.fields) {
        if (f.value !== correctValue && !pool.includes(f.value)) {
          pool.push(f.value)
        }
        if (pool.length >= 6) break // enough candidates
      }
      if (pool.length >= 6) break
    }
  }

  return shuffle(pool).slice(0, 3)
}

/**
 * Return the unique field keys that appear on ≥ 2 regions (quizzable).
 * Used by QuizConfigScreen to build the field selection UI.
 */
export function getQuizzableFields(imageDeck) {
  const counts = {}
  for (const region of imageDeck.regions) {
    for (const f of region.fields) {
      counts[f.key] = (counts[f.key] || 0) + 1
    }
  }
  return Object.entries(counts)
    .filter(([, count]) => count >= 2)
    .map(([key, count]) => ({ key, count }))
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
