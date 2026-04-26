import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native'
import { useRouter } from 'expo-router'
import { colors, radius, spacing } from '../../lib/theme'

export default function PlayScreen() {
  const router = useRouter()

  return (
    <SafeAreaView style={styles.safe}>
      <View testID="play-screen" style={styles.root}>
        <Text style={styles.title}>Play with friends</Text>
        <Text style={styles.sub}>Create a lobby and invite up to 7 friends, or join one with a room code.</Text>

        <TouchableOpacity
          testID="play-create-lobby"
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/lobby/create')}
        >
          <Text style={styles.primaryBtnText}>🎮  Create a lobby</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="play-join-lobby"
          style={styles.secondaryBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/lobby/join')}
        >
          <Text style={styles.secondaryBtnText}>🔑  Join a lobby</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xxl,
    paddingTop: 64,
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  sub: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 48,
    maxWidth: 280,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: colors.purple,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  secondaryBtn: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textSecondary,
  },
})
