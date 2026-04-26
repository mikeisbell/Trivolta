import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../../lib/theme'

export default function LobbyResultsScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>LobbyResultsScreen — coming soon</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.textSecondary, fontSize: 15 },
})
