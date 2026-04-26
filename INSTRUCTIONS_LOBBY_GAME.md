# INSTRUCTIONS_LOBBY_GAME.md — LobbyGameScreen

## Task

Build LobbyGameScreen — the synchronous multiplayer game loop. All players see the same question at the same time, timed by a server-authoritative `starts_at` timestamp from `game_sessions`. Players answer, answers are saved to `lobby_answers`, and after all 10 questions the screen navigates to `/lobby/results`.

Key architectural rules (from CLAUDE.md):
- Timer is derived from `game_sessions.starts_at` — never from the client clock as source of truth
- Questions were pre-generated and stored in `lobby_questions` before this screen was entered
- The host advances questions by writing new rows to `game_sessions` — guests subscribe via Realtime
- Do NOT generate questions on this screen

---

## Verifiable Objective

- [ ] Screen renders question text — testID `lobby-game-question`
- [ ] 4 answer buttons render — testIDs `lobby-game-answer-0` through `lobby-game-answer-3`
- [ ] Timer bar renders and counts down from 20s using `starts_at` from `game_sessions` — testID `lobby-game-timer`
- [ ] Question progress shows `X / 10` — testID `lobby-game-progress`
- [ ] Current player score shown — testID `lobby-game-score`
- [ ] Selecting an answer saves a row to `lobby_answers` and disables all buttons
- [ ] Correct/wrong answer feedback shown after selection or timeout (matching solo question.tsx style)
- [ ] Host sees "Next question" button after answering — testID `lobby-game-next`; guest does NOT
- [ ] Host tapping "Next question" writes the next `game_sessions` row with a new `starts_at` (now + 2 seconds buffer)
- [ ] Guests auto-advance to next question via Realtime subscription on `game_sessions`
- [ ] After question 10: host taps "See results", all players navigate to `/lobby/results` with `lobbyId`
- [ ] Host advancing past question 10 updates `lobbies.status` to `finished`
- [ ] `npx tsc --noEmit` passes with 0 errors

---

## Constraints

- Timer source of truth: `starts_at` from `game_sessions`. On mount, calculate `deadline = new Date(starts_at).getTime() + 20000`. Count down using `Date.now()` against deadline every 100ms. Do NOT use `TIMER_SECONDS - elapsed` with a local start time.
- Do NOT re-generate questions — fetch them from `lobby_questions` by `lobby_id` and `question_index`
- Do NOT re-shuffle answers — they arrived pre-shuffled from `generate-questions`. Do not sort or reorder.
- Supabase RLS: only the host can update `lobbies`. Only authenticated users can insert into `lobby_answers` for their own `user_id`. Do not use service role key on the client.
- Use Realtime `postgres_changes` subscription on `game_sessions` (filter `lobby_id=eq.{lobbyId}`) for guests to detect host advancing questions. Unsubscribe on cleanup.
- `lobby_answers` insert must be idempotent-safe: wrap in try/catch, ignore duplicate key errors (user may have already answered before a re-render).
- Do NOT modify `waiting.tsx`, `api.ts` existing functions, or any screen outside `game.tsx`.
- The `isHost` param arrives as string `'1'` or `'0'` — convert with `isHostParam === '1'`.
- Score calculation: same formula as `question.tsx` — `Math.round(100 * (timeLeft / 20) * (1 + streak * 0.1))`. `timeLeft` = seconds remaining at time of answer.

---

## Steps

### Step 1 — Add lobby game API functions to `api.ts`

Append to `/Users/mizzy/Developer/Trivolta/mobile/lib/api.ts`:

```typescript
export async function fetchLobbyQuestion(
  lobbyId: string,
  questionIndex: number
): Promise<{ question: string; answers: string[]; correct_index: number; explanation: string; difficulty: string } | null> {
  const { data, error } = await supabase
    .from('lobby_questions')
    .select('question, answers, correct_index, explanation, difficulty')
    .eq('lobby_id', lobbyId)
    .eq('question_index', questionIndex)
    .single()

  if (error || !data) return null
  return data as any
}

export async function fetchGameSession(
  lobbyId: string,
  questionIndex: number
): Promise<{ starts_at: string } | null> {
  const { data, error } = await supabase
    .from('game_sessions')
    .select('starts_at')
    .eq('lobby_id', lobbyId)
    .eq('question_index', questionIndex)
    .single()

  if (error || !data) return null
  return data
}

export async function createGameSession(
  lobbyId: string,
  questionIndex: number
): Promise<void> {
  // starts_at = 2 seconds from now (buffer for guests to receive and render)
  const startsAt = new Date(Date.now() + 2000).toISOString()
  const { error } = await supabase
    .from('game_sessions')
    .insert({ lobby_id: lobbyId, question_index: questionIndex, starts_at: startsAt })

  if (error) throw new Error(error.message)
}

export async function submitLobbyAnswer(
  lobbyId: string,
  questionIndex: number,
  answerIndex: number
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  const { error } = await supabase
    .from('lobby_answers')
    .insert({
      lobby_id: lobbyId,
      user_id: session.user.id,
      question_index: questionIndex,
      answer_index: answerIndex,
    })

  // Ignore duplicate key error (23505) — answer already submitted
  if (error && !error.message.includes('duplicate') && !error.code?.includes('23505')) {
    throw new Error(error.message)
  }
}

export async function finishLobbyGame(lobbyId: string): Promise<void> {
  const { error } = await supabase
    .from('lobbies')
    .update({ status: 'finished' })
    .eq('id', lobbyId)

  if (error) throw new Error(error.message)
}
```

### Step 2 — Build `game.tsx`

Replace the entire contents of `/Users/mizzy/Developer/Trivolta/mobile/app/lobby/game.tsx`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { colors, radius, spacing } from '../../lib/theme'
import {
  fetchLobbyQuestion,
  fetchGameSession,
  createGameSession,
  submitLobbyAnswer,
  finishLobbyGame,
} from '../../lib/api'
import type { AnswerState } from '../../lib/types'

const TOTAL_QUESTIONS = 10
const TIMER_SECONDS = 20
const LETTERS = ['A', 'B', 'C', 'D']

function calcScore(timeLeft: number, streak: number): number {
  return Math.round(100 * (timeLeft / TIMER_SECONDS) * (1 + streak * 0.1))
}

type Question = {
  question: string
  answers: string[]
  correct_index: number
  explanation: string
  difficulty: string
}

export default function LobbyGameScreen() {
  const { lobbyId, isHost: isHostParam } = useLocalSearchParams<{ lobbyId: string; isHost: string }>()
  const isHost = isHostParam === '1'
  const router = useRouter()

  const [questionIndex, setQuestionIndex] = useState(0)
  const [question, setQuestion] = useState<Question | null>(null)
  const [loading, setLoading] = useState(true)
  const [answerState, setAnswerState] = useState<AnswerState>('unanswered')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const deadlineRef = useRef<number>(0)
  const streakRef = useRef(0)
  const timeLeftRef = useRef(TIMER_SECONDS)
  const answerStateRef = useRef<AnswerState>('unanswered')
  const sessionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleTimeout = useCallback(() => {
    if (answerStateRef.current !== 'unanswered') return
    stopTimer()
    answerStateRef.current = 'timeout'
    setAnswerState('timeout')
    streakRef.current = 0
    setStreak(0)
  }, [stopTimer])

  const startTimerFromDeadline = useCallback((deadline: number) => {
    stopTimer()
    deadlineRef.current = deadline
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, (deadline - Date.now()) / 1000)
      timeLeftRef.current = remaining
      setTimeLeft(remaining)
      if (remaining <= 0) {
        handleTimeout()
      }
    }, 100)
  }, [stopTimer, handleTimeout])

  const loadQuestion = useCallback(async (index: number) => {
    setLoading(true)
    setAnswerState('unanswered')
    answerStateRef.current = 'unanswered'
    setSelectedIndex(null)
    setTimeLeft(TIMER_SECONDS)
    stopTimer()

    const q = await fetchLobbyQuestion(lobbyId, index)
    if (!q) {
      setLoading(false)
      return
    }
    setQuestion(q)

    // Host creates the game_session row for this question (with starts_at)
    // Guests wait for it via Realtime — but also fetch directly after question loads
    if (isHost) {
      await createGameSession(lobbyId, index)
    }

    // All players: fetch the game_session to get starts_at
    // Retry up to 10 times (guests may need to wait for host to write it)
    let session = null
    for (let i = 0; i < 10; i++) {
      session = await fetchGameSession(lobbyId, index)
      if (session) break
      await new Promise(r => setTimeout(r, 500))
    }

    setLoading(false)
    if (session) {
      const deadline = new Date(session.starts_at).getTime() + TIMER_SECONDS * 1000
      startTimerFromDeadline(deadline)
    }
  }, [lobbyId, isHost, stopTimer, startTimerFromDeadline])

  // Initial load — host creates session for Q0
  useEffect(() => {
    loadQuestion(0)
    return () => stopTimer()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: guests listen for new game_sessions (host advancing questions)
  useEffect(() => {
    if (isHost) return

    const channel = supabase
      .channel(`game-sessions-${lobbyId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_sessions', filter: `lobby_id=eq.${lobbyId}` },
        (payload) => {
          const newIndex = (payload.new as any)?.question_index
          if (typeof newIndex === 'number') {
            setQuestionIndex(newIndex)
            loadQuestion(newIndex)
          }
        }
      )
      .subscribe()

    sessionChannelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [lobbyId, isHost]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnswer = useCallback(async (index: number) => {
    if (answerStateRef.current !== 'unanswered') return
    stopTimer()

    const isCorrect = index === question?.correct_index
    setSelectedIndex(index)
    const newState: AnswerState = isCorrect ? 'correct' : 'wrong'
    answerStateRef.current = newState
    setAnswerState(newState)

    if (isCorrect) {
      const pts = calcScore(timeLeftRef.current, streakRef.current)
      setScore(prev => prev + pts)
      streakRef.current += 1
      setStreak(streakRef.current)
    } else {
      streakRef.current = 0
      setStreak(0)
    }

    // Save answer (non-blocking, idempotent)
    submitLobbyAnswer(lobbyId, questionIndex, index).catch(() => {})
  }, [question, lobbyId, questionIndex, stopTimer])

  const handleNext = useCallback(async () => {
    const nextIndex = questionIndex + 1
    if (nextIndex >= TOTAL_QUESTIONS) {
      // Game over
      await finishLobbyGame(lobbyId)
      router.replace({ pathname: '/lobby/results', params: { lobbyId } })
    } else {
      setQuestionIndex(nextIndex)
      loadQuestion(nextIndex)
    }
  }, [questionIndex, lobbyId, router, loadQuestion])

  const timerPercent = (timeLeft / TIMER_SECONDS) * 100
  const timerColor = timeLeft > 10 ? colors.purple : timeLeft > 5 ? colors.gold : colors.danger

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.purple} />
          <Text style={styles.loadingText}>Loading question…</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!question) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Failed to load question.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.root}>

        {/* Top bar */}
        <View style={styles.topBar}>
          <Text testID="lobby-game-progress" style={styles.progressText}>
            {questionIndex + 1} / {TOTAL_QUESTIONS}
          </Text>
          <Text testID="lobby-game-score" style={styles.scoreText}>{score} pts</Text>
        </View>

        {/* Timer bar */}
        <View style={styles.timerTrack}>
          <View
            testID="lobby-game-timer"
            style={[styles.timerFill, { width: `${timerPercent}%`, backgroundColor: timerColor }]}
          />
        </View>

        {/* Streak */}
        {streak >= 2 && (
          <View style={styles.metaRow}>
            <View style={styles.streakPill}>
              <Text style={styles.streakText}>🔥 {streak}x streak</Text>
            </View>
          </View>
        )}

        {/* Question */}
        <Text testID="lobby-game-question" style={styles.questionText}>
          {question.question}
        </Text>

        {/* Answers */}
        <View style={styles.answerList}>
          {question.answers.map((answer, i) => {
            const isSelected = selectedIndex === i
            const isCorrect = i === question.correct_index
            const showCorrect = answerState !== 'unanswered' && isCorrect
            const showWrong = answerState !== 'unanswered' && isSelected && !isCorrect

            return (
              <TouchableOpacity
                key={i}
                testID={`lobby-game-answer-${i}`}
                style={[
                  styles.answerBtn,
                  showCorrect && styles.answerCorrect,
                  showWrong && styles.answerWrong,
                ]}
                onPress={() => handleAnswer(i)}
                disabled={answerState !== 'unanswered'}
                activeOpacity={0.8}
              >
                <View style={[
                  styles.answerLetter,
                  showCorrect && styles.answerLetterCorrect,
                  showWrong && styles.answerLetterWrong,
                ]}>
                  <Text style={styles.answerLetterText}>{LETTERS[i]}</Text>
                </View>
                <Text style={styles.answerText}>{answer}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Feedback + next */}
        {answerState !== 'unanswered' && (
          <View style={styles.feedbackArea}>
            {answerState === 'timeout' ? (
              <View style={styles.timeoutBox}>
                <Text style={styles.timeoutText}>⏱ Time's up — no points awarded</Text>
              </View>
            ) : (
              <View style={[
                styles.explanationBox,
                answerState === 'correct' ? styles.explanationCorrect : styles.explanationWrong,
              ]}>
                <Text style={[
                  styles.explanationText,
                  answerState === 'correct' ? styles.explanationTextCorrect : styles.explanationTextWrong,
                ]}>
                  {answerState === 'correct' ? '✓ ' : '✗ '}{question.explanation}
                </Text>
              </View>
            )}

            {isHost && (
              <TouchableOpacity
                testID="lobby-game-next"
                style={styles.nextBtn}
                onPress={handleNext}
              >
                <Text style={styles.nextText}>
                  {questionIndex + 1 >= TOTAL_QUESTIONS ? 'See results' : 'Next question →'}
                </Text>
              </TouchableOpacity>
            )}

            {!isHost && (
              <View style={styles.waitingBox}>
                <Text style={styles.waitingText}>Waiting for host…</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  loadingText: { color: colors.textSecondary, fontSize: 14 },
  errorText: { color: colors.danger, fontSize: 14 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  progressText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  scoreText: { fontSize: 13, color: colors.purpleLight, fontWeight: '700' },

  timerTrack: {
    height: 4,
    backgroundColor: colors.surface,
    marginHorizontal: spacing.xxl,
    borderRadius: 2,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  timerFill: { height: 4, borderRadius: 2 },

  metaRow: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.sm,
  },
  streakPill: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  streakText: { fontSize: 10, fontWeight: '600', color: colors.goldText },

  questionText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 24,
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },

  answerList: {
    paddingHorizontal: spacing.xxl,
    gap: spacing.sm,
  },
  answerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  answerCorrect: { backgroundColor: colors.successDim, borderColor: colors.success },
  answerWrong: { backgroundColor: colors.dangerDim, borderColor: colors.danger },
  answerLetter: {
    width: 28, height: 28, borderRadius: radius.full,
    backgroundColor: colors.surfaceBright,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  answerLetterCorrect: { backgroundColor: colors.success },
  answerLetterWrong: { backgroundColor: colors.danger },
  answerLetterText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  answerText: { fontSize: 13, color: colors.textPrimary, fontWeight: '500', flex: 1 },

  feedbackArea: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  timeoutBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  timeoutText: { fontSize: 13, color: colors.textMuted },
  explanationBox: { borderRadius: radius.md, padding: spacing.md },
  explanationCorrect: { backgroundColor: colors.successDim },
  explanationWrong: { backgroundColor: colors.dangerDim },
  explanationText: { fontSize: 12, lineHeight: 18 },
  explanationTextCorrect: { color: colors.success },
  explanationTextWrong: { color: colors.danger },

  nextBtn: {
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  nextText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },

  waitingBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  waitingText: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
})
```

### Step 3 — Add stub `/lobby/results` route

Create `/Users/mizzy/Developer/Trivolta/mobile/app/lobby/results.tsx`:

```typescript
import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../../lib/theme'

export default function LobbyResultsScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>LobbyResultsScreen — coming soon</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.textSecondary, fontSize: 15 },
})
```

### Step 4 — Update TRIVOLTA_TRACKER.md

Mark `LobbyGameScreen` as ✅ Done. Mark `Server-timestamp timer for lobby games` as ✅. Add `INSTRUCTIONS_LOBBY_GAME.md` to INSTRUCTIONS Files Written.

---

## Verification

Run in order. Do not report success until all pass.

```bash
# 1. TypeScript check
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit

# 2. Confirm files exist
ls /Users/mizzy/Developer/Trivolta/mobile/app/lobby/game.tsx
ls /Users/mizzy/Developer/Trivolta/mobile/app/lobby/results.tsx

# 3. Confirm testIDs in game.tsx
grep -c "testID" /Users/mizzy/Developer/Trivolta/mobile/app/lobby/game.tsx

# 4. Confirm server-timestamp timer (deadline-based, not elapsed-based)
grep "deadline" /Users/mizzy/Developer/Trivolta/mobile/app/lobby/game.tsx

# 5. Confirm Realtime subscription present
grep "postgres_changes" /Users/mizzy/Developer/Trivolta/mobile/app/lobby/game.tsx

# 6. Confirm removeChannel cleanup
grep "removeChannel" /Users/mizzy/Developer/Trivolta/mobile/app/lobby/game.tsx

# 7. Capture diff
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report each check result. Do not commit — Mac Claude reviews the diff first.
