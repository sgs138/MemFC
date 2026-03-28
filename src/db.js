import { openDB } from 'idb'

// Schema version — increment when data model changes, add migration in upgrade()
// v1: imageSets + imageSetMeta (legacy store names)
// v2: renamed to imageDecks + imageDeckMeta; migrates all v1 data
const DB_VERSION = 2
const DB_NAME = 'memfc'

let _db = null

async function getDB() {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('imageDecks', { keyPath: 'id' })
        db.createObjectStore('imageDeckMeta', { keyPath: 'id' })
      }
      if (oldVersion === 1) {
        // Rename stores: imageSets → imageDecks, imageSetMeta → imageDeckMeta
        const imageDecks    = db.createObjectStore('imageDecks',    { keyPath: 'id' })
        const imageDeckMeta = db.createObjectStore('imageDeckMeta', { keyPath: 'id' })
        return (async () => {
          const [allSets, allMeta] = await Promise.all([
            tx.objectStore('imageSets').getAll(),
            tx.objectStore('imageSetMeta').getAll(),
          ])
          await Promise.all([
            ...allSets.map(s  => imageDecks.put(s)),
            ...allMeta.map(m => imageDeckMeta.put(m)),
          ])
          db.deleteObjectStore('imageSets')
          db.deleteObjectStore('imageSetMeta')
        })()
      }
    },
  })
  return _db
}

function buildMeta(imageDeck) {
  const fieldKeys = [
    ...new Set(imageDeck.regions.flatMap(r => r.fields.map(f => f.key))),
  ]
  return {
    id: imageDeck.id,
    name: imageDeck.name,
    regionCount: imageDeck.regions.length,
    fieldKeys,
    lastQuizzedAt: imageDeck.lastQuizzedAt,
  }
}

export async function getAllMeta() {
  const db = await getDB()
  return db.getAll('imageDeckMeta')
}

export async function getImageDeck(id) {
  const db = await getDB()
  return db.get('imageDecks', id)
}

export async function putImageDeck(imageDeck) {
  const db = await getDB()
  try {
    const tx = db.transaction(['imageDecks', 'imageDeckMeta'], 'readwrite')
    tx.objectStore('imageDecks').put(imageDeck)
    tx.objectStore('imageDeckMeta').put(buildMeta(imageDeck))
    await tx.done
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      throw new Error('STORAGE_FULL')
    }
    throw err
  }
}

export async function updateLastQuizzedAt(id) {
  const db = await getDB()
  const tx = db.transaction(['imageDecks', 'imageDeckMeta'], 'readwrite')
  const [imageDeck, meta] = await Promise.all([
    tx.objectStore('imageDecks').get(id),
    tx.objectStore('imageDeckMeta').get(id),
  ])
  const ts = Date.now()
  if (imageDeck) tx.objectStore('imageDecks').put({ ...imageDeck, lastQuizzedAt: ts })
  if (meta)      tx.objectStore('imageDeckMeta').put({ ...meta, lastQuizzedAt: ts })
  await tx.done
}

export async function deleteImageDeck(id) {
  const db = await getDB()
  const tx = db.transaction(['imageDecks', 'imageDeckMeta'], 'readwrite')
  tx.objectStore('imageDecks').delete(id)
  tx.objectStore('imageDeckMeta').delete(id)
  await tx.done
}
