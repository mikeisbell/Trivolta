import { useEffect, useRef, useState, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, Alert
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { generateSoloQuestion, saveScore, saveDailyChallengeCompletion } from '../lib/api'
import { getHistory, addToHistory } from '../lib/gameHistory'
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
  const { category, challengeId } = useLocalSearchParams<{ category: string; challengeId?: string }>()
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
      const q = await generateSoloQuestion(category ?? 'general knowledge', streakRef.current, getHistory(category ?? ''))
      addToHistory(category ?? '', q.question)
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
      saveScore(
        result.category,
        result.score,
        result.correctCount,
        result.totalQuestions,
        result.bestStreak
      ).catch(() => {})

      if (challengeId) {
        saveDailyChallengeCompletion(
          challengeId,
          result.score,
          result.correctCount,
          result.totalQuestions,
          result.bestStreak
        ).catch(() => {})
      }

      router.replace({
        pathname: '/results',
        params: {
          category: result.category,
          score: String(result.score),
          correctCount: String(result.correctCount),
          totalQuestions: String(result.totalQuestions),
          bestStreak: String(result.bestStreak),
          isChallenge: challengeId ? '1' : '0',
        },
      })
    } else {
      setQuestionNum(prev => prev + 1)
      fetchQuestion()
    }
  }, [questionNum, score, correctCount, bestStreak, answerState, category, challengeId, router, fetchQuestion])

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
