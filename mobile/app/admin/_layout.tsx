import { useEffect } from 'react'
import { ActivityIndicator, View, StyleSheet } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useAuth } from '../../lib/auth'
import { colors } from '../../lib/theme'

export default function AdminLayout() {
  const { session, isAdmin, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!session) {
      router.replace('/auth')
    } else if (!isAdmin) {
      router.replace('/(tabs)')
    }
  }, [session, isAdmin, loading])

  if (loading || !session || !isAdmin) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.purpleLight} />
      </View>
    )
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary, fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
        title: 'Admin',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Admin' }} />
      <Stack.Screen name="facts/index" options={{ title: 'Facts' }} />
      <Stack.Screen name="facts/queue" options={{ title: 'Review Queue' }} />
      <Stack.Screen name="facts/[id]" options={{ title: 'Fact' }} />
      <Stack.Screen name="facts/import" options={{ title: 'Import' }} />
      <Stack.Screen name="facts/auto-seed" options={{ title: 'Auto-seed' }} />
      <Stack.Screen name="facts/needs-review" options={{ title: 'Needs Review' }} />
      <Stack.Screen name="facts/spot-check" options={{ title: 'Spot Check' }} />
      <Stack.Screen name="sources/cite" options={{ title: 'Source Citation' }} />
      <Stack.Screen name="distractors/generate" options={{ title: 'Distractor Generation' }} />
      <Stack.Screen name="reports/index" options={{ title: 'Reports' }} />
      <Stack.Screen name="feedback/index" options={{ title: 'Feedback' }} />
      <Stack.Screen name="coverage/index" options={{ title: 'Coverage' }} />
      <Stack.Screen name="telemetry" options={{ title: 'Telemetry' }} />
    </Stack>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
