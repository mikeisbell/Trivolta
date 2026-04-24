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
