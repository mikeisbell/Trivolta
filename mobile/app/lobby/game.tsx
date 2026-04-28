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
import { calcScore } from '../../lib/scoring'
import type { AnswerState } from '../../lib/types'

const TOTAL_QUESTIONS = 10
const TIMER_SECONDS = 20
const LETTERS = ['A', 'B', 'C', 'D']
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const isValidLobbyId = typeof lobbyId === 'string' && UUID_REGEX.test(lobbyId)

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

    let pts = 0
    if (isCorrect) {
      pts = calcScore(timeLeftRef.current, streakRef.current, TIMER_SECONDS)
      setScore(prev => prev + pts)
      streakRef.current += 1
      setStreak(streakRef.current)
    } else {
      streakRef.current = 0
      setStreak(0)
    }

    // Save answer (non-blocking, idempotent)
    submitLobbyAnswer(lobbyId, questionIndex, index, pts).catch(() => {})
  }, [question, lobbyId, questionIndex, stopTimer])

  const handleNext = useCallback(async () => {
    if (!isHost) return
    const nextIndex = questionIndex + 1
    if (nextIndex >= TOTAL_QUESTIONS) {
      // Game over — host marks lobby finished
      await finishLobbyGame(lobbyId)
      router.replace({ pathname: '/lobby/results', params: { lobbyId } })
    } else {
      setQuestionIndex(nextIndex)
      loadQuestion(nextIndex)
    }
  }, [isHost, questionIndex, lobbyId, router, loadQuestion])

  const timerPercent = (timeLeft / TIMER_SECONDS) * 100
  const timerColor = timeLeft > 10 ? colors.purple : timeLeft > 5 ? colors.gold : colors.danger

  if (!isValidLobbyId) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Invalid lobby link.</Text>
        </View>
      </SafeAreaView>
    )
  }

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
          <TouchableOpacity
            testID="lobby-game-retry"
            style={styles.retryBtn}
            onPress={() => loadQuestion(questionIndex)}
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
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
  retryBtn: {
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  retryText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },

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
