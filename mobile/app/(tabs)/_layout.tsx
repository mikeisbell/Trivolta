import { Tabs } from 'expo-router'
import { colors } from '../../lib/theme'

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.backgroundDeep,
          borderTopColor: 'rgba(167,139,250,0.12)',
          borderTopWidth: 0.5,
          paddingBottom: 10,
          paddingTop: 8,
          height: 68,
        },
        tabBarActiveTintColor: colors.purpleLight,
        tabBarInactiveTintColor: colors.textHint,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home' }}
      />
      <Tabs.Screen
        name="play"
        options={{ title: 'Play', href: null } as any}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{ title: 'Ranks' }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarButtonTestID: 'tab-profile',
        }}
      />
    </Tabs>
  )
}
