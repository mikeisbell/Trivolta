# INSTRUCTIONS_AUTH.md — Trivolta authentication

## Task
Implement authentication: sign up, sign in, sign out, and automatic profile creation.
Gate the app so unauthenticated users land on the auth screen, authenticated users land on HomeScreen.

## Verifiable objective
When complete:
- `npx tsc --noEmit` exits with 0 errors
- App launches in iOS Simulator showing the auth screen
- A new user can sign up with email + password and be taken to HomeScreen
- A returning user can sign in and be taken to HomeScreen
- Signing out returns the user to the auth screen
- A profile row is automatically created in `public.profiles` on first sign up
- `git diff HEAD > /tmp/trivolta_diff.txt` captures all changes

## Constraints
- Read CLAUDE.md before writing a single file
- Use Supabase Auth — no custom auth logic
- No third-party auth libraries
- Auth state must persist across app restarts (AsyncStorage already configured in supabase.ts)
- Username is required at sign up — do not allow blank usernames
- Keep auth UI simple — email, password, username (sign up only). No social login yet.
- Do not modify any existing screen files other than `_layout.tsx`

---

## Step 1 — Add auth context

Create `mobile/lib/auth.tsx`:

```typescript
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

type AuthContextType = {
  session: Session | null
  user: User | null
  loading: boolean
  signUp: (email: string, password: string, username: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signUp = async (email: string, password: string, username: string) => {
    if (!username.trim()) throw new Error('Username is required')

    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    if (!data.user) throw new Error('Sign up failed')

    // Create profile row
    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      username: username.trim(),
    })
    if (profileError) throw profileError
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return (
    <AuthContext.Provider value={{ session, user, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
```

---

## Step 2 — Create the auth screen

Create `mobile/app/auth.tsx`:

```typescript
import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator
} from 'react-native'
import { useAuth } from '../lib/auth'

export default function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Email and password are required')
      return
    }
    if (mode === 'signup' && !username.trim()) {
      Alert.alert('Error', 'Username is required')
      return
    }

    setLoading(true)
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password)
      } else {
        await signUp(email.trim(), password, username.trim())
      }
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Trivolta</Text>
        <Text style={styles.subtitle}>
          {mode === 'signin' ? 'Sign in to play' : 'Create your account'}
        </Text>

        {mode === 'signup' && (
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor="#666"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={styles.button}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switchMode}
          onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          <Text style={styles.switchText}>
            {mode === 'signin'
              ? "Don't have an account? Sign up"
              : 'Already have an account? Sign in'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111118',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#fff',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  button: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  switchMode: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  switchText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
})
```

---

## Step 3 — Update root layout to handle auth routing

Replace the contents of `mobile/app/_layout.tsx`:

```typescript
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
```

---

## Step 4 — Add sign out to ProfileScreen

Replace the contents of `mobile/app/profile.tsx`:

```typescript
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
```

---

## Step 5 — Add profile trigger to Supabase migration

Create `supabase/migrations/20240101000001_profile_trigger.sql`:

```sql
-- Automatically create a profile row when a new auth user is created
-- Note: username defaults to empty string here — the mobile app sets it at sign up
-- via direct insert. This trigger is a safety net for other auth flows.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, '')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

---

## Verification

Run in order. Fix any failure before proceeding:

```bash
# 1. TypeScript check
cd /Users/mizzy/Developer/Trivolta/mobile
npx tsc --noEmit

# 2. Start local Supabase (if not already running)
cd /Users/mizzy/Developer/Trivolta
supabase start

# 3. Apply new migration
supabase db reset

# 4. Start the app and confirm auth screen appears
cd mobile
npx expo start --ios

# 5. Capture diff
cd /Users/mizzy/Developer/Trivolta
git diff HEAD > ~/trivolta_diff.txt
echo "Lines changed: $(wc -l < ~/trivolta_diff.txt)"
```

Manually verify in the iOS Simulator:
- [ ] Auth screen appears on first launch
- [ ] Sign up with a new email creates a user and navigates to HomeScreen
- [ ] Sign out returns to auth screen
- [ ] Sign in with the same email returns to HomeScreen

Report TypeScript result and manual verification checklist. Do not report success until tsc passes and all four manual checks pass.
