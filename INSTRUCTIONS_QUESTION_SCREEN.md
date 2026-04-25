# INSTRUCTIONS_QUESTION_SCREEN.md — Trivolta solo game loop

## Task
Build the QuestionScreen — the core solo game loop. Fetches AI-generated questions from
the solo-question Edge Function, displays them with a countdown timer, handles answer
selection, shows feedback with explanation, tracks score and streak across 10 questions,
then navigates to ResultScreen. Also build ResultScreen as a complete screen (not a placeholder).

## Verifiable objective
When complete:
- `npx tsc --noEmit` exits with 0 errors
- Tapping a category card on HomeScreen navigates to QuestionScreen with that category
- QuestionScreen fetches a question from the Edge Function and displays it
- Timer counts down from 20 seconds visually
- Tapping an answer reveals correct/wrong state and shows explanation
- After 10 questions, ResultScreen shows score, correct count, best streak
- Tapping "Play again" restarts with the same category
- Tapping "Home" returns to HomeScreen
- All 4 Maestro auth tests still pass
- `git diff HEAD > ~/trivolta_diff.txt` captures all changes

## Constraints
- Read CLAUDE.md before writing a single file
- Answers arrive pre-shuffled — do NOT re-shuffle correct_index
- Timer is client-side for solo mode (server timestamp is lobby-only per CLAUDE.md)
- Score formula: base 100 pts × time remaining multiplier × streak multiplier
  - Time multiplier: timeLeft / 20 (so answering instantly = 1.0, last second = ~0.05)
  - Streak multiplier: 1 + (streak * 0.1) — so 5 streak = 1.5x
  - Round to nearest integer
- Unanswered questions (timer expires) score 0 and break the streak
- Do not add lobby or multiplayer logic to this screen
- Use colors and spacing exclusively from lib/theme.ts
- Keep all existing testIDs intact — do not remove them
- supabase functions serve must be running before testing the question fetch

---

## Step 1 — Add score saving to api.ts

Add a new function to `mobile/lib/api.ts`:

```typescript
export async function saveScore(
  category: string,
  score: number,
  correctCount: number,
  totalQuestions: number,
  bestStreak: number
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  await supabase.from('scores').insert({
    user_id: session.user.id,
    category,
    score,
    correct_count: correctCount,
    total_questions: totalQuestions,
    best_streak: bestStreak,
  })
}
```

---

## Step 2 — Add game state types to types.ts

Add to `mobile/lib/types.ts`:

```typescript
export type AnswerState = 'unanswered' | 'correct' | 'wrong' | 'timeout'

export type GameResult = {
  category: string
  score: number
  correctCount: number
  totalQuestions: number
  bestStreak: number
}
```

---

## Step 3 — Build the QuestionScreen

Replace the contents of `mobile/app/question.tsx`:

```typescript
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, Alert
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { generateSoloQuestion, saveScore } from '../lib/api'
import { colors, radius, spacing } from '../lib/theme'
import type { QuestionResponse, AnswerState, GameResult } from '../lib/types'

const TOTAL_QUESTIONS = 10
const TIMER_SECONDS = 20
const LETTERS = ['A', 'B', 'C', 'D']

function calcScore(timeLeft: number, streak: number): number {
  const timeMultiplier = timeLeft / TIMER_SECONDS
  const streakMultiplier = 1 + streak * 0.1
  return Math.round(100 * timeMultiplier * streakMultiplier)
}

export default function QuestionScreen() {
  const { category } = useLocalSearchParams<{ category: string }>()
  const router = useRouter()

  const [question, setQuestion] = useState<QuestionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [answerState, setAnswerState] = useState<AnswerState>('unanswered')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS)

  // Game state
  const [questionNum, setQuestionNum] = useState(1)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeLeftRef = useRef(TIMER_SECONDS)
  const streakRef = useRef(0)

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleTimeout = useCallback(() => {
    stopTimer()
    setAnswerState('timeout')
    streakRef.current = 0
    setStreak(0)
  }, [stopTimer])

  const startTimer = useCallback(() => {
    timeLeftRef.current = TIMER_SECONDS
    setTimeLeft(TIMER_SECONDS)
    timerRef.current = setInterval(() => {
      timeLeftRef.current -= 0.1
      setTimeLeft(Math.max(0, timeLeftRef.current))
      if (timeLeftRef.current <= 0) {
        handleTimeout()
      }
    }, 100)
  }, [handleTimeout])

  const fetchQuestion = useCallback(async () => {
    setLoading(true)
    setError(null)
    setAnswerState('unanswered')
    setSelectedIndex(null)
    stopTimer()

    try {
      const q = await generateSoloQuestion(category ?? 'general knowledge', streakRef.current)
      setQuestion(q)
      setLoading(false)
      startTimer()
    } catch (err) {
      setLoading(false)
      setError('Failed to load question. Check your connection.')
    }
  }, [category, startTimer, stopTimer])

  useEffect(() => {
    fetchQuestion()
    return () => stopTimer()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnswer = useCallback((index: number) => {
    if (answerState !== 'unanswered') return
    stopTimer()

    const isCorrect = index === question?.correct_index
    setSelectedIndex(index)
    setAnswerState(isCorrect ? 'correct' : 'wrong')

    if (isCorrect) {
      const pts = calcScore(timeLeftRef.current, streakRef.current)
      setScore(prev => prev + pts)
      setCorrectCount(prev => prev + 1)
      streakRef.current += 1
      setStreak(streakRef.current)
      setBestStreak(prev => Math.max(prev, streakRef.current))
    } else {
      streakRef.current = 0
      setStreak(0)
    }
  }, [answerState, question, stopTimer])

  const handleNext = useCallback(async () => {
    if (questionNum >= TOTAL_QUESTIONS) {
      // Save score and navigate to results
      const result: GameResult = {
        category: category ?? 'general knowledge',
        score,
        correctCount: correctCount + (answerState === 'correct' ? 0 : 0),
        totalQuestions: TOTAL_QUESTIONS,
        bestStreak,
      }
      // Save to Supabase (non-blocking)
      saveScore(
        result.category,
        result.score,
        result.correctCount,
        result.totalQuestions,
        result.bestStreak
      ).catch(() => {}) // silent fail — don't block navigation

      router.replace({
        pathname: '/results',
        params: {
          category: result.category,
          score: String(result.score),
          correctCount: String(result.correctCount),
          totalQuestions: String(result.totalQuestions),
          bestStreak: String(result.bestStreak),
        },
      })
    } else {
      setQuestionNum(prev => prev + 1)
      fetchQuestion()
    }
  }, [questionNum, score, correctCount, bestStreak, answerState, category, router, fetchQuestion])

  const timerPercent = (timeLeft / TIMER_SECONDS) * 100
  const timerColor = timeLeft > 10 ? colors.purple : timeLeft > 5 ? colors.gold : colors.danger

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View testID="question-screen-loading" style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.purple} />
          <Text style={styles.loadingText}>Generating question…</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe}>
        <View testID="question-screen-error" style={styles.loadingContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchQuestion}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View testID="question-screen" style={styles.root}>

        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity
            testID="question-back"
            style={styles.backBtn}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.progressText}>{questionNum} / {TOTAL_QUESTIONS}</Text>
          <Text style={styles.scoreText}>{score} pts</Text>
        </View>

        {/* Timer bar */}
        <View style={styles.timerTrack}>
          <View style={[styles.timerFill, { width: `${timerPercent}%`, backgroundColor: timerColor }]} />
        </View>

        {/* Category + difficulty */}
        <View style={styles.metaRow}>
          <View style={styles.catDot} />
          <Text style={styles.catText}>{category}</Text>
          {streak >= 2 && (
            <View style={styles.streakPill}>
              <Text style={styles.streakText}>🔥 {streak}x streak</Text>
            </View>
          )}
        </View>

        {/* Question */}
        <Text style={styles.questionText}>{question?.question}</Text>

        {/* Answers */}
        <View style={styles.answerList}>
          {question?.answers.map((answer, i) => {
            const isSelected = selectedIndex === i
            const isCorrect = i === question.correct_index
            const showCorrect = answerState !== 'unanswered' && isCorrect
            const showWrong = answerState !== 'unanswered' && isSelected && !isCorrect

            return (
              <TouchableOpacity
                key={i}
                testID={`answer-${i}`}
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

        {/* Explanation + next button */}
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
                  {answerState === 'correct' ? '✓ ' : '✗ '}{question?.explanation}
                </Text>
              </View>
            )}
            <TouchableOpacity
              testID="question-next"
              style={styles.nextBtn}
              onPress={handleNext}
            >
              <Text style={styles.nextText}>
                {questionNum >= TOTAL_QUESTIONS ? 'See results' : 'Next question →'}
              </Text>
            </TouchableOpacity>
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
  errorText: { color: colors.danger, fontSize: 14, textAlign: 'center', paddingHorizontal: spacing.xxl },
  retryBtn: { backgroundColor: colors.purple, borderRadius: radius.md, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md },
  retryText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: colors.surfaceBright,
    alignItems: 'center', justifyContent: 'center',
  },
  backText: { color: colors.textSecondary, fontSize: 18, lineHeight: 22 },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.md,
  },
  catDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.purple },
  catText: { fontSize: 11, fontWeight: '600', color: colors.purpleLight, textTransform: 'capitalize' },
  streakPill: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginLeft: spacing.xs,
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
  answerCorrect: {
    backgroundColor: colors.successDim,
    borderColor: colors.success,
  },
  answerWrong: {
    backgroundColor: colors.dangerDim,
    borderColor: colors.danger,
  },
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
  explanationBox: {
    borderRadius: radius.md,
    padding: spacing.md,
  },
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
})
```

---

## Step 4 — Build the ResultScreen

Replace the contents of `mobile/app/results.tsx`:

```typescript
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { colors, radius, spacing } from '../lib/theme'

function gradeLabel(pct: number): string {
  if (pct >= 90) return 'Outstanding! 🏆'
  if (pct >= 70) return 'Excellent! 🎯'
  if (pct >= 50) return 'Good effort 👍'
  return 'Keep practicing 💪'
}

export default function ResultScreen() {
  const router = useRouter()
  const { category, score, correctCount, totalQuestions, bestStreak } =
    useLocalSearchParams<{
      category: string
      score: string
      correctCount: string
      totalQuestions: string
      bestStreak: string
    }>()

  const correct = parseInt(correctCount ?? '0')
  const total = parseInt(totalQuestions ?? '10')
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0

  return (
    <SafeAreaView style={styles.safe}>
      <View testID="results-screen" style={styles.root}>

        {/* Trophy + grade */}
        <View style={styles.hero}>
          <Text style={styles.trophy}>
            {pct >= 70 ? '🏆' : pct >= 50 ? '🎯' : '💪'}
          </Text>
          <Text style={styles.grade}>{gradeLabel(pct)}</Text>
          <Text style={styles.detail}>
            {category} · {correct}/{total} correct · {pct}% accuracy
          </Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{parseInt(score ?? '0').toLocaleString()}</Text>
            <Text style={styles.statLabel}>Score</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{bestStreak}x</Text>
            <Text style={styles.statLabel}>Best streak</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{pct}%</Text>
            <Text style={styles.statLabel}>Accuracy</Text>
          </View>
        </View>

        {/* XP bar */}
        <View style={styles.xpWrap}>
          <View style={styles.xpLabels}>
            <Text style={styles.xpLabel}>Level 1</Text>
            <Text style={styles.xpLabel}>+{Math.round(parseInt(score ?? '0') / 10)} XP earned</Text>
          </View>
          <View style={styles.xpTrack}>
            <View style={[styles.xpFill, { width: `${Math.min(pct, 100)}%` }]} />
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            testID="results-play-again"
            style={styles.primaryBtn}
            onPress={() => router.replace({
              pathname: '/question',
              params: { category },
            })}
          >
            <Text style={styles.primaryText}>Play again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="results-home"
            style={styles.ghostBtn}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.ghostText}>Back to home</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xxl },

  hero: { alignItems: 'center', paddingTop: 48, paddingBottom: spacing.xl },
  trophy: { fontSize: 56, marginBottom: spacing.md },
  grade: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
  detail: { fontSize: 12, color: colors.textMuted, textAlign: 'center', textTransform: 'capitalize' },

  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  statNum: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  statLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },

  xpWrap: { marginBottom: spacing.xl },
  xpLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  xpLabel: { fontSize: 10, color: colors.textMuted },
  xpTrack: { height: 6, backgroundColor: colors.surface, borderRadius: 3, overflow: 'hidden' },
  xpFill: { height: 6, backgroundColor: colors.purple, borderRadius: 3 },

  actions: { gap: spacing.sm },
  primaryBtn: {
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  ghostBtn: {
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ghostText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
})
```

---

## Step 5 — Wire category cards on HomeScreen to QuestionScreen

Update `mobile/app/(tabs)/index.tsx`:

In the `CATEGORIES` array and the custom category card, add navigation on press.
Import `useRouter` from `expo-router` at the top.

Replace each category card's `onPress` handler:

```typescript
// Add at top of component:
const router = useRouter()

// Update each category TouchableOpacity onPress:
onPress={() => router.push({ pathname: '/question', params: { category: cat.label } })}

// Custom category card onPress:
onPress={() => router.push({ pathname: '/custom-category' })}
```

Also update the Quick play button:
```typescript
onPress={() => {
  const random = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)]
  router.push({ pathname: '/question', params: { category: random.label } })
}}
```

---

## Step 6 — Set ANTHROPIC_API_KEY as local Supabase secret

The solo-question Edge Function requires ANTHROPIC_API_KEY to be set.
For local development, set it via the Supabase CLI:

```bash
cd /Users/mizzy/Developer/Trivolta
echo "ANTHROPIC_API_KEY=your_actual_key_here" > supabase/.env.local
```

Then restart the Edge Function server with the secret:
```bash
supabase functions serve --no-verify-jwt --env-file supabase/.env.local
```

Add `supabase/.env.local` to the root `.gitignore` if not already present.

---

## Verification

```bash
# 1. TypeScript check
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit

# 2. Start Supabase with API key
cd /Users/mizzy/Developer/Trivolta
supabase functions serve --no-verify-jwt --env-file supabase/.env.local

# 3. Start Expo in a new terminal tab
cd mobile
npx expo start --ios

# 4. Manually verify in simulator:
#    - Tap Science category on HomeScreen
#    - QuestionScreen loads with a question
#    - Timer counts down
#    - Tap an answer — see correct/wrong feedback + explanation
#    - Tap Next through 10 questions
#    - ResultScreen shows score, streak, accuracy
#    - Tap Play again — new game starts
#    - Tap Back to home — returns to HomeScreen

# 5. Maestro tests — all 4 must still pass
export PATH="$HOME/.maestro/bin:$PATH"
maestro test maestro/test_01_auth_screen_on_launch.yaml
maestro test maestro/test_02_sign_up.yaml
maestro test maestro/test_03_sign_in.yaml
maestro test maestro/test_04_sign_out.yaml

# 6. Diff
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report:
- TypeScript: PASS/FAIL
- Question loads in simulator: YES/NO
- Timer visible and counting: YES/NO
- Answer feedback works: YES/NO
- Results screen shows after 10 questions: YES/NO
- test_01 through test_04: PASS/FAIL each

Do not report success until TypeScript passes, the game loop works end to end,
and all 4 Maestro tests pass.
