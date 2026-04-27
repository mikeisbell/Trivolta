import { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView
} from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../lib/auth'
import { fetchDailyChallenge } from '../../lib/api'
import type { DailyChallenge } from '../../lib/types'
import { colors, radius, spacing } from '../../lib/theme'

const CATEGORIES = [
  { id: 'science', label: 'Science', emoji: '🔬', count: '800+', badge: 'Hot', badgeType: 'hot' },
  { id: 'pop_culture', label: 'Pop culture', emoji: '🎬', count: '1K+', badge: 'New', badgeType: 'new' },
  { id: 'history', label: 'History', emoji: '🏛️', count: '600+', badge: '', badgeType: '' },
  { id: 'custom', label: 'Any topic', emoji: '✨', count: 'Ask anything', badge: 'AI', badgeType: 'ai' },
] as const

const PLAYABLE_CATEGORIES = CATEGORIES.filter((cat) => cat.id !== 'custom')

function timeUntilMidnightUTC(): string {
  const now = new Date()
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const diff = midnight.getTime() - now.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}m`
}

export default function HomeScreen() {
  const { user } = useAuth()
  const router = useRouter()
  const initials = user?.email?.slice(0, 2).toUpperCase() ?? 'ME'
  const [dailyChallenge, setDailyChallenge] = useState<DailyChallenge | null>(null)

  useEffect(() => {
    fetchDailyChallenge().then(setDailyChallenge)
  }, [])

  return (
    <SafeAreaView style={styles.safe}>
      <View testID="home-screen" style={styles.root}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Greeting header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <TouchableOpacity
                testID="home-avatar"
                style={styles.avatar}
                onPress={() => router.navigate('/(tabs)/profile')}
              >
                <Text style={styles.avatarText}>{initials}</Text>
              </TouchableOpacity>
              <Text style={styles.greeting}>
                Hello, <Text style={styles.greetingName}>{user?.email?.split('@')[0] ?? 'player'}</Text>
              </Text>
            </View>
          </View>

          {/* Hero daily challenge card */}
          <TouchableOpacity
            testID="home-daily-challenge"
            style={styles.heroCard}
            activeOpacity={dailyChallenge?.completed ? 1 : 0.85}
            onPress={() => {
              if (dailyChallenge?.completed || !dailyChallenge) return
              router.push({ pathname: '/question', params: { category: dailyChallenge.category, challengeId: dailyChallenge.id } })
            }}
          >
            <Text style={styles.heroLabel}>DAILY CHALLENGE</Text>
            <Text style={styles.heroTitle}>{dailyChallenge?.category ?? 'Mixed trivia'}</Text>
            <Text style={styles.heroSub}>{'10 questions · Ends in ' + timeUntilMidnightUTC()}</Text>
            <View style={styles.heroRow}>
              <View style={styles.heroPills}>
                <View style={[styles.heroPill, styles.heroPillGold]}>
                  <Text style={styles.heroPillGoldText}>+500 XP</Text>
                </View>
                <TouchableOpacity
                  testID="tab-ranks"
                  style={styles.heroPill}
                  onPress={() => router.navigate('/(tabs)/leaderboard')}
                >
                  <Text style={styles.heroPillText}>Rank pts</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.heroPlayBtn}>
                <Text style={styles.heroPlayText}>
                  {dailyChallenge?.completed ? 'Completed ✓' : 'Play →'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Categories */}
          <View style={styles.catSection}>
            <View style={styles.secHead}>
              <Text style={styles.secTitle}>Categories</Text>
              <Text style={styles.secMore}>See all</Text>
            </View>
            <View style={styles.catGrid}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  testID={`home-category-${cat.id}`}
                  style={[
                    styles.catCard,
                    cat.badgeType === 'ai' && styles.catCardAI,
                  ]}
                  activeOpacity={0.8}
                  onPress={() => cat.id === 'custom'
                    ? router.push({ pathname: '/custom-category' })
                    : router.push({ pathname: '/question', params: { category: cat.label } })
                  }
                >
                  <View style={styles.catTop}>
                    <Text style={styles.catEmoji}>{cat.emoji}</Text>
                    {cat.badge !== '' && (
                      <View style={[
                        styles.catBadge,
                        cat.badgeType === 'hot' && styles.catBadgeHot,
                        cat.badgeType === 'ai' && styles.catBadgeAI,
                      ]}>
                        <Text style={[
                          styles.catBadgeText,
                          cat.badgeType === 'hot' && styles.catBadgeHotText,
                          cat.badgeType === 'ai' && styles.catBadgeAIText,
                        ]}>{cat.badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[
                    styles.catName,
                    cat.badgeType === 'ai' && styles.catNameAI,
                  ]}>{cat.label}</Text>
                  <Text style={styles.catCount}>{cat.count} {cat.id !== 'custom' ? 'questions' : ''}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Play with friends */}
          <TouchableOpacity
            testID="home-play-lobby"
            accessible={true}
            accessibilityLabel="Play with friends"
            style={styles.playLobbyBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/(tabs)/play')}
          >
            <Text style={styles.playLobbyText}>Play with friends</Text>
          </TouchableOpacity>

          {/* Quick play */}
          <TouchableOpacity
            testID="home-quick-play"
            style={styles.quickPlay}
            activeOpacity={0.85}
            onPress={() => {
              const random = PLAYABLE_CATEGORIES[Math.floor(Math.random() * PLAYABLE_CATEGORIES.length)]
              router.push({ pathname: '/question', params: { category: random.label } })
            }}
          >
            <Text style={styles.quickPlayText}>Quick play — random category</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: { flex: 1 },
  content: { paddingBottom: 24 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.purple,
    backgroundColor: '#4c1d95',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.purplePale,
  },
  greeting: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  greetingName: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  heroCard: {
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
    backgroundColor: '#2e0052',
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 0.5,
    borderColor: colors.borderPurple,
  },
  heroLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.purpleLight,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  heroSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroPills: { flexDirection: 'row', gap: spacing.sm },
  heroPill: {
    backgroundColor: colors.surfaceBright,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  heroPillGold: {
    backgroundColor: colors.goldDim,
  },
  heroPillText: { fontSize: 10, fontWeight: '600', color: colors.textSecondary },
  heroPillGoldText: { fontSize: 10, fontWeight: '600', color: colors.goldText },
  heroPlayBtn: {
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  heroPlayText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },

  catSection: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
  secHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  secTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  secMore: { fontSize: 11, color: colors.purpleLight },
  catGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  catCard: {
    width: '47.5%',
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  catCardAI: {
    borderColor: colors.purpleBorder,
    backgroundColor: colors.purpleDim,
  },
  catTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  catEmoji: { fontSize: 22 },
  catBadge: {
    backgroundColor: colors.surfaceBright,
    borderRadius: radius.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  catBadgeHot: { backgroundColor: 'rgba(239,68,68,0.2)' },
  catBadgeAI: { backgroundColor: colors.purpleDim },
  catBadgeText: { fontSize: 8, fontWeight: '700', color: colors.textMuted },
  catBadgeHotText: { color: '#fca5a5' },
  catBadgeAIText: { color: colors.purpleLight },
  catName: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  catNameAI: { color: colors.purplePale },
  catCount: { fontSize: 10, color: colors.textMuted, marginTop: 2 },

  playLobbyBtn: {
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  playLobbyText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },

  quickPlay: {
    marginHorizontal: spacing.xxl,
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  quickPlayText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
})
