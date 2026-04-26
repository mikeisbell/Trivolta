# INSTRUCTIONS_CUSTOM_CATEGORY_SCREEN.md — Trivolta custom category screen

## Task
Build the CustomCategoryScreen — Trivolta's biggest differentiator. Users can type any
topic and the AI generates a quiz on it instantly. Also shows trending categories pulled
from recent popular plays. Tapping any topic (typed or trending) navigates to
QuestionScreen with that category.

## Verifiable objective
When complete:
- `npx tsc --noEmit` exits with 0 errors
- Tapping "Any topic" category card on HomeScreen navigates to CustomCategoryScreen
- User can type any topic in the input field
- Tapping "Go" or pressing submit navigates to QuestionScreen with the typed topic
- Trending categories are displayed and tappable
- Example pill prompts are displayed and tappable — tapping one fills the input
- All 4 Maestro auth tests still pass
- `git diff HEAD > ~/trivolta_diff.txt` captures all changes

## Constraints
- Read CLAUDE.md before writing a single file
- Use colors and spacing exclusively from lib/theme.ts
- Trending categories are hardcoded for now — no Supabase query yet
- Input must trim whitespace and reject empty submissions
- Do not add a new tab — this screen is pushed onto the Stack navigator
- Keep the existing testIDs on all other screens intact
- Add testIDs to all interactive elements on this screen

---

## Step 1 — Replace CustomCategoryScreen

Replace the contents of `mobile/app/custom-category.tsx`:

```typescript
import { useState, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, KeyboardAvoidingView, Platform
} from 'react-native'
import { useRouter } from 'expo-router'
import { colors, radius, spacing } from '../lib/theme'

const TRENDING = [
  { id: 'olympics', label: 'Olympics Paris 2024', emoji: '🏅', plays: '12.4k' },
  { id: 'formula1', label: 'Formula 1 — 2024 season', emoji: '🏎️', plays: '9.1k' },
  { id: 'taylor_swift', label: 'Taylor Swift eras', emoji: '🎤', plays: '8.3k' },
  { id: 'marvel', label: 'Marvel Cinematic Universe', emoji: '🦸', plays: '7.2k' },
  { id: 'hip_hop_90s', label: '90s hip hop deep cuts', emoji: '🎵', plays: '5.7k' },
  { id: 'ancient_egypt', label: 'Ancient Egypt', emoji: '🏺', plays: '4.9k' },
  { id: 'premier_league', label: 'Premier League 2024', emoji: '⚽', plays: '4.1k' },
  { id: 'breaking_bad', label: 'Breaking Bad', emoji: '🧪', plays: '3.8k' },
] as const

const EXAMPLE_PROMPTS = [
  'Seinfeld episodes',
  'NASA missions',
  'World War II battles',
  'Disney Pixar films',
  'African capitals',
  'The Beatles discography',
]

export default function CustomCategoryScreen() {
  const router = useRouter()
  const [input, setInput] = useState('')
  const inputRef = useRef<TextInput>(null)

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    router.push({ pathname: '/question', params: { category: trimmed } })
  }

  const handleTrending = (label: string) => {
    router.push({ pathname: '/question', params: { category: label } })
  }

  const handlePrompt = (prompt: string) => {
    setInput(prompt)
    inputRef.current?.focus()
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            testID="custom-category-back"
            style={styles.backBtn}
            onPress={() => router.back()}
          >
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Any topic, instantly</Text>
            <Text style={styles.headerSub}>AI generates your quiz in seconds</Text>
          </View>
          <View style={styles.backBtn} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Input box */}
          <View style={styles.inputCard}>
            <Text style={styles.inputLabel}>CUSTOM CATEGORY</Text>
            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                testID="custom-category-input"
                style={styles.input}
                placeholder='Try "90s Nickelodeon cartoons"…'
                placeholderTextColor={colors.textHint}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={handleSubmit}
                returnKeyType="go"
                autoCorrect={false}
                autoCapitalize="none"
              />
              <TouchableOpacity
                testID="custom-category-submit"
                style={[styles.goBtn, !input.trim() && styles.goBtnDisabled]}
                onPress={handleSubmit}
                disabled={!input.trim()}
              >
                <Text style={styles.goBtnText}>Go →</Text>
              </TouchableOpacity>
            </View>

            {/* Example prompts */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.promptsRow}
            >
              {EXAMPLE_PROMPTS.map((prompt) => (
                <TouchableOpacity
                  key={prompt}
                  testID={`custom-category-prompt-${prompt.replace(/\s+/g, '-').toLowerCase()}`}
                  style={styles.promptPill}
                  onPress={() => handlePrompt(prompt)}
                >
                  <Text style={styles.promptText}>{prompt}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Trending section */}
          <View style={styles.trendingSection}>
            <Text style={styles.sectionLabel}>TRENDING NOW</Text>
            {TRENDING.map((item) => (
              <TouchableOpacity
                key={item.id}
                testID={`custom-category-trending-${item.id}`}
                style={styles.trendingRow}
                onPress={() => handleTrending(item.label)}
                activeOpacity={0.75}
              >
                <View style={styles.trendingIcon}>
                  <Text style={styles.trendingEmoji}>{item.emoji}</Text>
                </View>
                <View style={styles.trendingInfo}>
                  <Text style={styles.trendingLabel}>{item.label}</Text>
                  <Text style={styles.trendingMeta}>{item.plays} plays today · AI-generated</Text>
                </View>
                <Text style={styles.trendingChevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: colors.textSecondary, fontSize: 20, lineHeight: 24 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  headerSub: { fontSize: 11, color: colors.textMuted, marginTop: 1 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.xxl, paddingBottom: 32 },

  inputCard: {
    backgroundColor: colors.purpleDim,
    borderWidth: 0.5,
    borderColor: colors.purpleBorder,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  inputLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.purpleLight,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceBright,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.textPrimary,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  goBtn: {
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  goBtnDisabled: { opacity: 0.4 },
  goBtnText: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },

  promptsRow: { gap: spacing.sm },
  promptPill: {
    backgroundColor: 'rgba(167,139,250,0.12)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  promptText: { fontSize: 11, fontWeight: '500', color: colors.purpleLight },

  trendingSection: { gap: spacing.sm },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.7,
    marginBottom: spacing.xs,
  },
  trendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  trendingIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceBright,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  trendingEmoji: { fontSize: 20 },
  trendingInfo: { flex: 1 },
  trendingLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  trendingMeta: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  trendingChevron: { fontSize: 18, color: colors.textHint },
})
```

---

## Step 2 — Verify HomeScreen already wires to CustomCategoryScreen

Confirm that `mobile/app/(tabs)/index.tsx` already has:
```typescript
onPress={() => router.push({ pathname: '/custom-category' })}
```
on the custom/AI category card. If not, add it.

---

## Step 3 — Add Maestro test for custom category

Create `mobile/maestro/test_05_custom_category.yaml`:

```yaml
appId: com.mikeisbell.trivolta
---
# test_05: Custom category screen — type a topic and start a quiz

- clearState
- launchApp:
    clearState: true

# Sign in first
- assertVisible:
    id: "auth-email-input"
- tapOn:
    id: "auth-email-input"
- inputText: "signup_test@trivolta-test.com"
- tapOn:
    id: "auth-password-input"
- inputText: "TestPassword123!"
- tapOn:
    id: "auth-submit-button"
- tapOn: "Not Now"
- assertVisible:
    id: "home-screen"
    timeout: 15000

# Tap the Any topic category card
- tapOn:
    id: "home-category-custom"

# Custom category screen should appear
- assertVisible:
    id: "custom-category-input"
    timeout: 5000

# Tap an example prompt pill
- tapOn:
    id: "custom-category-prompt-nasa-missions"

# Input should be filled
- assertVisible:
    text: "NASA missions"

# Tap Go to start quiz
- tapOn:
    id: "custom-category-submit"

# Question screen should load
- assertVisible:
    id: "question-screen"
    timeout: 15000
```

Add the new test script to `mobile/package.json` scripts:
```json
"test:e2e:05": "maestro test maestro/test_05_custom_category.yaml"
```

---

## Verification

```bash
# 1. TypeScript
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit

# 2. Launch and visually confirm
npx expo start --ios
# Confirm:
# - Tapping "Any topic" card on HomeScreen opens CustomCategoryScreen
# - Input field accepts text
# - Tapping a prompt pill fills the input
# - Tapping Go navigates to QuestionScreen with that topic
# - Trending rows are tappable and navigate to QuestionScreen

# 3. All 5 Maestro tests
export PATH="$HOME/.maestro/bin:$PATH"
maestro test maestro/test_01_auth_screen_on_launch.yaml
maestro test maestro/test_02_sign_up.yaml
maestro test maestro/test_03_sign_in.yaml
maestro test maestro/test_04_sign_out.yaml
maestro test maestro/test_05_custom_category.yaml

# 4. Diff
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Report:
- TypeScript: PASS/FAIL
- Visual: custom category screen visible, input works, trending tappable
- test_01 through test_05: PASS/FAIL each

Do not report success until TypeScript passes and all 5 Maestro tests pass.
