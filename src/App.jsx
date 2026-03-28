import { createContext, useContext, useReducer } from 'react'
import LibraryScreen from './LibraryScreen'
import AnnotateScreen from './AnnotateScreen'
import QuizConfigScreen from './QuizConfigScreen'
import QuizSession from './QuizSession'
import QuizResult from './QuizResult'
import './App.css'

// ─── App Context ─────────────────────────────────────────────────────────────

export const AppContext = createContext(null)
export function useApp() { return useContext(AppContext) }

// ─── Screen State Machine ─────────────────────────────────────────────────────
//
// Screens:
//   { name: 'library' }
//   { name: 'annotate', imageDeckId }
//   { name: 'quiz-config', imageDeckId }
//   { name: 'quiz-session', imageDeckId, questions }
//   { name: 'quiz-result', imageDeckId, score, total, missed }

function reducer(state, action) {
  switch (action.type) {
    case 'GO_LIBRARY':
      return { name: 'library' }
    case 'GO_ANNOTATE':
      return { name: 'annotate', imageDeckId: action.imageDeckId }
    case 'GO_QUIZ_CONFIG':
      return { name: 'quiz-config', imageDeckId: action.imageDeckId }
    case 'GO_QUIZ_SESSION':
      return { name: 'quiz-session', imageDeckId: action.imageDeckId, questions: action.questions }
    case 'GO_QUIZ_RESULT':
      return { name: 'quiz-result', imageDeckId: action.imageDeckId, score: action.score, total: action.total, missed: action.missed }
    default:
      return state
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, dispatch] = useReducer(reducer, { name: 'library' })

  const nav = {
    library:     ()                              => dispatch({ type: 'GO_LIBRARY' }),
    annotate:    (imageDeckId)                    => dispatch({ type: 'GO_ANNOTATE', imageDeckId }),
    quizConfig:  (imageDeckId)                    => dispatch({ type: 'GO_QUIZ_CONFIG', imageDeckId }),
    quizSession: (imageDeckId, questions)         => dispatch({ type: 'GO_QUIZ_SESSION', imageDeckId, questions }),
    quizResult:  (imageDeckId, score, total, missed) => dispatch({ type: 'GO_QUIZ_RESULT', imageDeckId, score, total, missed }),
  }

  return (
    <AppContext.Provider value={{ screen, nav }}>
      <div id="app">
        {screen.name === 'library'      && <LibraryScreen />}
        {screen.name === 'annotate'     && <AnnotateScreen imageDeckId={screen.imageDeckId} />}
        {screen.name === 'quiz-config'  && <QuizConfigScreen imageDeckId={screen.imageDeckId} />}
        {screen.name === 'quiz-session' && <QuizSession imageDeckId={screen.imageDeckId} questions={screen.questions} />}
        {screen.name === 'quiz-result'  && <QuizResult imageDeckId={screen.imageDeckId} score={screen.score} total={screen.total} missed={screen.missed} />}
      </div>
    </AppContext.Provider>
  )
}
