import { View, Text, StyleSheet } from 'react-native'
import { colors, radius, spacing } from '../../../lib/theme'

export default function AdminSourcesCiteScreen() {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>Source citation</Text>
        <Text style={styles.body}>
          AI proposes 2–3 source URLs per pending fact. Backend mechanically validates URL reachability and excerpt match before any human approval.
        </Text>
        <Text style={styles.tag}>Coming in Phase 2.6.2</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: spacing.sm },
  body: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.lg },
  tag: { color: colors.purpleLight, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
})
