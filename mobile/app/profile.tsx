import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { useAuth } from '../lib/auth'

export default function ProfileScreen() {
  const { user, signOut } = useAuth()

  const handleSignOut = async () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut()
          } catch (err: any) {
            Alert.alert('Error', err.message)
          }
        },
      },
    ])
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>ProfileScreen</Text>
      <Text style={styles.email}>{user?.email}</Text>
      <TouchableOpacity style={styles.signOut} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111118', alignItems: 'center', justifyContent: 'center', gap: 16 },
  label: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  email: { color: '#fff', fontSize: 15 },
  signOut: { backgroundColor: 'rgba(226,75,74,0.15)', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, borderWidth: 0.5, borderColor: '#E24B4A' },
  signOutText: { color: '#E24B4A', fontWeight: '700' },
})
