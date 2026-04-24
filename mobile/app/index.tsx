import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'

export default function HomeScreen() {
  const router = useRouter()
  return (
    <View testID="home-screen" style={styles.container}>
      <Text style={styles.title}>HomeScreen</Text>
      <TouchableOpacity testID="home-profile-button" style={styles.button} onPress={() => router.push('/profile')}>
        <Text style={styles.buttonText}>Profile</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { fontSize: 24 },
  button: { padding: 16, backgroundColor: '#7c3aed', borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 16 },
})
