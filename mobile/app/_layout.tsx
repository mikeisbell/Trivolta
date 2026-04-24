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
      <Stack.Screen name="index" />
      <Stack.Screen name="question" />
      <Stack.Screen name="results" />
      <Stack.Screen name="leaderboard" />
      <Stack.Screen name="profile" />
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
      <RootLayoutNav>
      </RootLayoutNav>
    </AuthProvider>
  )
}
