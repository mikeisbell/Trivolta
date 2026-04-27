import { useState, useRef, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, KeyboardAvoidingView, Platform
} from 'react-native'
import { useRouter } from 'expo-router'
import { colors, radius, spacing } from '../lib/theme'
import { supabase } from '../lib/supabase'

type TrendingItem = { id: string; label: string; emoji: string; plays: string }

const TRENDING: TrendingItem[] = [
  { id: 'olympics', label: 'Olympics Paris 2024', emoji: '🏅', plays: '12.4k' },
  { id: 'formula1', label: 'Formula 1 — 2024 season', emoji: '🏎️', plays: '9.1k' },
  { id: 'taylor_swift', label: 'Taylor Swift eras', emoji: '🎤', plays: '8.3k' },
  { id: 'marvel', label: 'Marvel Cinematic Universe', emoji: '🦸', plays: '7.2k' },
  { id: 'hip_hop_90s', label: '90s hip hop deep cuts', emoji: '🎵', plays: '5.7k' },
  { id: 'ancient_egypt', label: 'Ancient Egypt', emoji: '🏺', plays: '4.9k' },
  { id: 'premier_league', label: 'Premier League 2024', emoji: '⚽', plays: '4.1k' },
  { id: 'breaking_bad', label: 'Breaking Bad', emoji: '🧪', plays: '3.8k' },
]

const CATEGORY_EMOJI: Record<string, string> = {
  'science': '🔬',
  'pop culture': '🎬',
  'history': '🏛️',
  'any topic': '✨',
  'olympics paris 2024': '🏅',
  'formula 1 — 2024 season': '🏎️',
  'taylor swift eras': '🎤',
  'marvel cinematic universe': '🦸',
  '90s hip hop deep cuts': '🎵',
  'ancient egypt': '🏺',
  'premier league 2024': '⚽',
  'breaking bad': '🧪',
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '_').slice(0, 20)
}

function emojiFor(label: string): string {
  return CATEGORY_EMOJI[label.toLowerCase()] ?? '🎯'
}

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
  const [trendingCategories, setTrendingCategories] = useState<TrendingItem[]>(TRENDING)
  const inputRef = useRef<TextInput>(null)

  useEffect(() => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    supabase
      .from('scores')
      .select('category')
      .gte('played_at', since)
      .then(({ data, error }) => {
        if (error || !data) return
        const counts = new Map<string, number>()
        for (const row of data as Array<{ category: string }>) {
          counts.set(row.category, (counts.get(row.category) ?? 0) + 1)
        }
        const ranked = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([label, count]) => ({
            id: slugify(label),
            label,
            emoji: emojiFor(label),
            plays: String(count),
          }))
        if (ranked.length >= 4) setTrendingCategories(ranked)
      })
  }, [])

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
            {trendingCategories.map((item) => (
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
