# INSTRUCTIONS_HOME_SCREEN.md — Trivolta HomeScreen v2

## Task
Build the Trivolta HomeScreen and tab navigator with a premium dark purple aesthetic.
Includes greeting header, hero daily challenge card, 2x2 category grid, bottom tab bar.
Also sets up the tab group structure for all main screens.

## Verifiable objective
When complete:
- `npx tsc --noEmit` exits with 0 errors
- HomeScreen renders in iOS Simulator with:
  - Deep purple/near-black background (#180029)
  - Greeting header with avatar and coin balance
  - Hero daily challenge card
  - 2x2 category grid with hot/new/AI badges
  - Bottom tab bar: Home, Play, Ranks, Profile
- Tapping Profile tab navigates to ProfileScreen
- testID="home-screen" remains on the root View
- All 4 Maestro auth tests still pass
- `git diff HEAD > ~/trivolta_diff.txt` captures all changes

## Constraints
- Read CLAUDE.md before writing a single file
- All colours defined in theme.ts — no inline hex strings in JSX
- Background: #180029, surface cards: rgba(255,255,255,0.05)
- Purple accent: #7c3aed, purple light: #a78bfa, purple dim: rgba(124,58,237,0.15)
- Do not add navigation logic to category cards or quick play — visual only with testIDs
- Keep testID="home-screen" on root View
- Do not modify auth.tsx, supabase.ts, api.ts, or any Edge Function

---

## Step 1 — Update shared theme constants

Replace the contents of `mobile/lib/theme.ts`:

```typescript
export const colors = {
  background: '#180029',
  backgroundDeep: '#12001f',
  surface: 'rgba(255,255,255,0.05)',
  surfaceBright: 'rgba(255,255,255,0.08)',
  purple: '#7c3aed',
  purpleLight: '#a78bfa',
  purplePale: '#c4b5fd',
  purpleDim: 'rgba(124,58,237,0.15)',
  purpleBorder: 'rgba(124,58,237,0.3)',
  gold: '#f59e0b',
  goldDim: 'rgba(245,158,11,0.15)',
  goldText: '#fcd34d',
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255,255,255,0.6)',
  textMuted: 'rgba(255,255,255,0.35)',
  textHint: 'rgba(255,255,255,0.25)',
  border: 'rgba(255,255,255,0.08)',
  borderPurple: 'rgba(167,139,250,0.2)',
  success: '#1D9E75',
  successDim: 'rgba(29,158,117,0.15)',
  danger: '#E24B4A',
  dangerDim: 'rgba(226,75,74,0.12)',
}

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 18,
  xxl: 24,
  full: 999,
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
}
```

---

## Step 2 — Set up tab group directory structure

Create directory `mobile/app/(tabs)/`

Move these files into the new directory:
- `mobile/app/index.tsx` → `mobile/app/(tabs)/index.tsx`
- `mobile/app/leaderboard.tsx` → `mobile/app/(tabs)/leaderboard.tsx`
- `mobile/app/profile.tsx` → `mobile/app/(tabs)/profile.tsx`

After moving, update import paths in each file:
- Any `'../lib/...'` imports become `'../../lib/...'`
- Any `'../app/...'` imports become `'../../app/...'`

---

## Step 3 — Create tab layout

Create `mobile/app/(tabs)/_layout.tsx`:

```typescript
import { Tabs } from 'expo-router'
import { colors } from '../../lib/theme'

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.backgroundDeep,
          borderTopColor: 'rgba(167,139,250,0.12)',
          borderTopWidth: 0.5,
          paddingBottom: 10,
          paddingTop: 8,
          height: 68,
        },
        tabBarActiveTintColor: colors.purpleLight,
        tabBarInactiveTintColor: colors.textHint,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarTestID: 'tab-home',
        }}
      />
      <Tabs.Screen
        name="play"
        options={{
          title: 'Play',
          tabBarTestID: 'tab-play',
          href: null,
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: 'Ranks',
          tabBarTestID: 'tab-ranks',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarTestID: 'tab-profile',
        }}
      />
    </Tabs>
  )
}
```

Create placeholder `mobile/app/(tabs)/play.tsx`:

```typescript
import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../../lib/theme'

export default function PlayScreen() {
  return (
    <View testID="play-screen" style={styles.container}>
      <Text style={styles.label}>PlayScreen</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.textMuted, fontSize: 13 },
})
```

---

## Step 4 — Update root layout for tab group

Replace the contents of `mobile/app/_layout.tsx`:

```typescript
import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { AuthProvider, useAuth } from '../lib/auth'

function RootLayoutNav() {
  const { session, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    const inAuthGroup = segments[0] === 'auth'
    if (!session && !inAuthGroup) {
      router.replace('/auth')
    } else if (session && inAuthGroup) {
      router.replace('/')
    }
  }, [session, loading, segments])

  if (loading) return null

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="auth" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="question" />
      <Stack.Screen name="results" />
      <Stack.Screen name="custom-category" />
      <Stack.Screen name="lobby/create" />
      <Stack.Screen name="lobby/join" />
      <Stack.Screen name="lobby/waiting" />
      <Stack.Screen name="lobby/game" />
      <Stack.Screen name="lobby/results" />
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  )
}
```

---

## Step 5 — Build the HomeScreen

Replace the contents of `mobile/app/(tabs)/index.tsx`:

```typescript
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView
} from 'react-native'
import { useAuth } from '../../lib/auth'
import { colors, radius, spacing } from '../../lib/theme'

const CATEGORIES = [
  { id: 'science', label: 'Science', emoji: '🔬', count: '800+', badge: 'Hot', badgeType: 'hot' },
  { id: 'pop_culture', label: 'Pop culture', emoji: '🎬', count: '1K+', badge: 'New', badgeType: 'new' },
  { id: 'history', label: 'History', emoji: '🏛️', count: '600+', badge: '', badgeType: '' },
  { id: 'custom', label: 'Any topic', emoji: '✨', count: 'Ask anything', badge: 'AI', badgeType: 'ai' },
] as const

export default function HomeScreen() {
  const { user } = useAuth()
  const initials = user?.email?.slice(0, 2).toUpperCase() ?? 'ME'

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
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <Text style={styles.greeting}>
                Hello, <Text style={styles.greetingName}>{user?.email?.split('@')[0] ?? 'player'}</Text>
              </Text>
            </View>
            <View style={styles.coinBadge}>
              <View style={styles.coinCircle}>
                <Text style={styles.coinIcon}>$</Text>
              </View>
              <Text style={styles.coinValue}>1.23k</Text>
            </View>
          </View>

          {/* Hero daily challenge card */}
          <TouchableOpacity
            testID="home-daily-challenge"
            style={styles.heroCard}
            activeOpacity={0.85}
          >
            <Text style={styles.heroLabel}>DAILY CHALLENGE</Text>
            <Text style={styles.heroTitle}>Mixed trivia</Text>
            <Text style={styles.heroSub}>10 questions · Ends in 14h 22m</Text>
            <View style={styles.heroRow}>
              <View style={styles.heroPills}>
                <View style={[styles.heroPill, styles.heroPillGold]}>
                  <Text style={styles.heroPillGoldText}>+500 XP</Text>
                </View>
                <View style={styles.heroPill}>
                  <Text style={styles.heroPillText}>Rank pts</Text>
                </View>
              </View>
              <View style={styles.heroPlayBtn}>
                <Text style={styles.heroPlayText}>Play →</Text>
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

          {/* Quick play */}
          <TouchableOpacity
            testID="home-quick-play"
            style={styles.quickPlay}
            activeOpacity={0.85}
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
  coinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.goldDim,
    borderWidth: 0.5,
    borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  coinCircle: {
    width: 16,
    height: 16,
    borderRadius: radius.full,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinIcon: { fontSize: 9, fontWeight: '800', color: '#78350f' },
  coinValue: { fontSize: 12, fontWeight: '700', color: colors.goldText },

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
```

---

## Step 6 — Update leaderboard.tsx and profile.tsx import paths

Update `mobile/app/(tabs)/leaderboard.tsx`:

```typescript
import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../../lib/theme'

export default function LeaderboardScreen() {
  return (
    <View testID="leaderboard-screen" style={styles.container}>
      <Text style={styles.label}>LeaderboardScreen</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.textMuted, fontSize: 13 },
})
```

Update `mobile/app/(tabs)/profile.tsx` — change import path only:
- `'../lib/auth'` → `'../../lib/auth'`

---

## Step 7 — Update Maestro test_04 for tab navigator

The profile screen is now reached via the tab bar, not a navigation button.
Update `mobile/maestro/test_04_sign_out.yaml`:

Replace the section that navigates to profile and signs out with:

```yaml
# Navigate to Profile via tab bar
- tapOn:
    id: "tab-profile"

# Tap sign out button
- tapOn:
    id: "profile-signout-button"

# Confirm the alert
- tapOn: "Confirm"
```

Remove any `tapOn: id: "home-profile-button"` lines — that element no longer exists.

---

## Verification

```bash
# 1. TypeScript
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit

# 2. Launch and visually confirm
npx expo start --ios

# 3. Maestro tests — all 4 must still pass
export PATH="$HOME/.maestro/bin:$PATH"
maestro test maestro/test_01_auth_screen_on_launch.yaml
maestro test maestro/test_02_sign_up.yaml
maestro test maestro/test_03_sign_in.yaml
maestro test maestro/test_04_sign_out.yaml

# 4. Diff
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report:
- TypeScript: PASS/FAIL
- Visual: screenshot of HomeScreen in simulator
- test_01 through test_04: PASS/FAIL each

Do not report success until TypeScript passes and all 4 Maestro tests pass.
