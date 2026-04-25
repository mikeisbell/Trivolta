import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { createClient, Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { clearSessionHistory } from './gameHistory'

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
    if (!data.user || !data.session) throw new Error('Sign up failed')

    const authedClient = createClient(
      process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${data.session.access_token}` } } }
    )

    const { error: profileError } = await authedClient.from('profiles').upsert({
      id: data.user.id,
      username: username.trim(),
    }, { onConflict: 'id' })
    if (profileError) throw new Error('Failed to create your profile. Please try again.')
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signOut = async () => {
    clearSessionHistory()
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
