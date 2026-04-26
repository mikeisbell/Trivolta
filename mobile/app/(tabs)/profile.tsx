import { useEffect, useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Alert, ActivityIndicator
} from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../lib/auth'
import { fetchUserStats } from '../../lib/api'
import { colors, radius, spacing } from '../../lib/theme'
import type { UserStats } from '../../lib/types'

const XP_PER_LEVEL = 1000

function getLevel(totalScore: number): number {
  return Math.floor(totalScore / XP_PER_LEVEL) + 1
}

function getTierTitle(level: number): string {
  if (level <= 2) return 'Trivia Rookie'
  if (level <= 4) return 'Quiz Enthusiast'
  if (level <= 7) return 'Knowledge Seeker'
  if (level <= 10) return 'Trivia Expert'
  return 'Quiz Master'
}

function getXPProgress(totalScore: number): { current: number; max: number; percent: number } {
  const current = totalScore % XP_PER_LEVEL
  return { current, max: XP_PER_LEVEL, percent: current / XP_PER_LEVEL }
}

type Achievement = {
  id: string
  icon: string
  name: string
  description: string
  unlocked: boolean
}

function getAchievements(stats: UserStats): Achievement[] {
  return [
    {
      id: 'first_game',
      icon: '🎮',
      name: 'First game',
      description: 'Play your first game',
      unlocked: stats.gamesPlayed >= 1,
    },
    {
      id: 'streak_3',
      icon: '🔥',
      name: 'On fire',
      description: '3x answer streak',
      unlocked: stats.bestStreak >= 3,
    },
    {
      id: 'games_10',
      icon: '🎯',
      name: 'Dedicated',
      description: 'Play 10 games',
      unlocked: stats.gamesPlayed >= 10,
    },
    {
      id: 'streak_7',
      icon: '⚡',
      name: 'Lightning',
      description: '7x answer streak',
      unlocked: stats.bestStreak >= 7,
    },
    {
      id: 'score_1000',
      icon: '🏆',
      name: 'Milestone',
      description: 'Score 1,000 points',
      unlocked: stats.totalScore >= 1000,
    },
    {
      id: 'accuracy_80',
      icon: '🧠',
      name: 'Sharp mind',
      description: '80%+ accuracy',
      unlocked: stats.accuracy >= 80,
    },
    {
      id: 'games_50',
      icon: '👑',
      name: 'Veteran',
      description: 'Play 50 games',
      unlocked: stats.gamesPlayed >= 50,
    },
    {
      id: 'top_10',
      icon: '🌟',
      name: 'Top 10',
      description: 'Reach global top 10',
      unlocked: stats.rank !== null && stats.rank <= 10,
    },
  ]
}

export default function ProfileScreen() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [stats, setStats] = useState<UserStats | null>(null)
  const [loading, setLoading] = useState(true)

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? 'ME'

  useEffect(() => {
    fetchUserStats().then(data => {
      setStats(data)
      setLoading(false)
    })
  }, [])

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut()
          } catch (err: any) {
            Alert.alert('Error', err.message)
          }
        },
      },
    ])
  }

  const level = stats ? getLevel(stats.totalScore) : 1
  const tier = getTierTitle(level)
  const xp = stats ? getXPProgress(stats.totalScore) : { current: 0, max: XP_PER_LEVEL, percent: 0 }
  const achievements = stats ? getAchievements(stats) : []

  return (
    <SafeAreaView style={styles.safe}>
      <View testID="profile-screen" style={styles.root}>

        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity
            testID="profile-back"
            onPress={() => router.navigate('/')}
            style={styles.backBtn}
          >
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Profile</Text>
          <TouchableOpacity
            testID="profile-signout-button"
            onPress={handleSignOut}
            style={styles.signOutBtn}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.purple} />
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Hero section */}
            <View style={styles.hero}>
              {stats?.rank && (
                <Text style={styles.rankText}>
                  #{stats.rank} position
                </Text>
              )}

              {/* Avatar */}
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>

              {/* Name + tier */}
              <Text style={styles.username}>
                {stats?.profile.username ?? user?.email?.split('@')[0] ?? 'Player'}
              </Text>
              <Text style={styles.tier}>{tier}</Text>

              {/* Total score */}
              <Text style={styles.totalScore}>
                {stats?.totalScore.toLocaleString() ?? '0'} pts
              </Text>
              <Text style={styles.totalScoreLabel}>total score</Text>
            </View>

            {/* XP bar */}
            <View style={styles.xpSection}>
              <View style={styles.xpLabels}>
                <Text style={styles.xpLabel}>Level {level}</Text>
                <Text style={styles.xpLabel}>{xp.current} / {xp.max} XP</Text>
              </View>
              <View style={styles.xpTrack}>
                <View style={[styles.xpFill, { width: `${xp.percent * 100}%` }]} />
              </View>
              <Text style={styles.xpNext}>
                {xp.max - xp.current} XP to Level {level + 1}
              </Text>
            </View>

            {/* Stats row */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{stats?.gamesPlayed ?? 0}</Text>
                <Text style={styles.statLabel}>Games</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{stats?.bestStreak ?? 0}x</Text>
                <Text style={styles.statLabel}>Best streak</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{stats?.accuracy ?? 0}%</Text>
                <Text style={styles.statLabel}>Accuracy</Text>
              </View>
            </View>

            {/* Achievements */}
            <View style={styles.achievementsSection}>
              <Text style={styles.sectionLabel}>ACHIEVEMENTS</Text>
              <View style={styles.achievementGrid}>
                {achievements.map(ach => (
                  <View
                    key={ach.id}
                    testID={`achievement-${ach.id}`}
                    style={[styles.achCard, !ach.unlocked && styles.achCardLocked]}
                  >
                    <Text style={styles.achIcon}>{ach.icon}</Text>
                    <Text style={[styles.achName, !ach.unlocked && styles.achNameLocked]}>
                      {ach.name}
                    </Text>
                    <Text style={styles.achDesc}>{ach.description}</Text>
                    {ach.unlocked && (
                      <View style={styles.achUnlockedBadge}>
                        <Text style={styles.achUnlockedText}>✓</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  backBtn: {
    paddingRight: spacing.sm,
  },
  backText: {
    fontSize: 28,
    color: colors.purpleLight,
    lineHeight: 28,
  },
  screenTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  signOutBtn: {
    backgroundColor: colors.dangerDim,
    borderWidth: 0.5,
    borderColor: colors.danger,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  signOutText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },

  hero: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  rankText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.purpleLight,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.purple,
    backgroundColor: colors.purpleDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.purplePale,
  },
  username: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  tier: {
    fontSize: 12,
    color: colors.purpleLight,
    marginBottom: spacing.md,
  },
  totalScore: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.purpleLight,
    marginBottom: 2,
  },
  totalScoreLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },

  xpSection: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
  xpLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  xpLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  xpTrack: {
    height: 6,
    backgroundColor: colors.surface,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  xpFill: {
    height: 6,
    backgroundColor: colors.purple,
    borderRadius: 3,
  },
  xpNext: {
    fontSize: 10,
    color: colors.textHint,
    textAlign: 'right',
  },

  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  statNum: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },

  achievementsSection: {
    paddingHorizontal: spacing.xxl,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.7,
    marginBottom: spacing.md,
  },
  achievementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  achCard: {
    width: '47.5%',
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
    position: 'relative',
  },
  achCardLocked: {
    opacity: 0.35,
  },
  achIcon: {
    fontSize: 24,
    marginBottom: spacing.xs,
  },
  achName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 2,
  },
  achNameLocked: {
    color: colors.textSecondary,
  },
  achDesc: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 14,
  },
  achUnlockedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: radius.full,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  achUnlockedText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.textPrimary,
  },
})
