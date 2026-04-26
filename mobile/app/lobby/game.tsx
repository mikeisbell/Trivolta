import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../../lib/theme'

export default function LobbyGameScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>LobbyGameScreen — coming soon</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.textSecondary, fontSize: 15 },
})
