import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Modal,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { usePathname } from 'expo-router'
import Constants from 'expo-constants'
import { useAuth } from '../lib/auth'
import { submitFeedback } from '../lib/api'
import { colors, radius, spacing } from '../lib/theme'

type FeedbackContextType = {
  openFeedback: (seedBody?: string) => void
}

const FeedbackContext = createContext<FeedbackContextType | null>(null)

export function useFeedback(): FeedbackContextType {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useFeedback must be used within FeedbackProvider')
  return ctx
}

function deriveScreen(pathname: string | null): string {
  if (!pathname) return 'home'
  let s = pathname.split('?')[0]
  if (s.startsWith('/')) s = s.slice(1)
  if (s.length === 0) s = 'home'
  s = s
    .split('/')
    .filter((seg) => !(seg.startsWith('[') && seg.endsWith(']')))
    .join('/')
  s = s.toLowerCase()
  if (s.length > 120) s = s.slice(0, 120)
  return s
}

function mapPlatform(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios'
  if (Platform.OS === 'android') return 'android'
  return 'web'
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()

  const [modalOpen, setModalOpen] = useState(false)
  const [body, setBody] = useState('')
  const [includeState, setIncludeState] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [toastVisible, setToastVisible] = useState(false)
  const lastRouteRef = useRef<string | null>(null)
  const previousRouteRef = useRef<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (pathname && pathname !== lastRouteRef.current) {
      previousRouteRef.current = lastRouteRef.current
      lastRouteRef.current = pathname
    }
  }, [pathname])

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  const openFeedback = useCallback((seedBody?: string) => {
    setBody(seedBody ?? '')
    setIncludeState(true)
    setErrorMsg(null)
    setSubmitting(false)
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setBody('')
    setErrorMsg(null)
    setSubmitting(false)
  }, [])

  const showToast = useCallback(() => {
    setToastVisible(true)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastVisible(false), 2500)
  }, [])

  const handleSend = useCallback(async () => {
    const trimmed = body.trim()
    if (trimmed.length === 0 || submitting) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      const screen = deriveScreen(pathname)
      const route_path = pathname ?? null
      const platform = mapPlatform()
      const app_version = Constants.expoConfig?.version ?? null

      const payload: {
        screen: string
        route_path: string | null
        platform: 'ios' | 'android' | 'web'
        app_version: string | null
        body: string
        state_snapshot?: Record<string, unknown>
      } = {
        screen,
        route_path,
        platform,
        app_version,
        body: trimmed,
      }

      if (includeState) {
        payload.state_snapshot = {
          user_id: session?.user?.id ?? null,
          route_params: {},
          timestamp_iso: new Date().toISOString(),
          locale:
            (typeof Intl !== 'undefined' && Intl.DateTimeFormat
              ? Intl.DateTimeFormat().resolvedOptions().locale
              : null) ?? null,
          last_route_visited_before_open: previousRouteRef.current,
        }
      }

      await submitFeedback(payload)
      closeModal()
      showToast()
    } catch (_err) {
      setErrorMsg("Couldn't send. Try again.")
      setSubmitting(false)
    }
  }, [body, submitting, pathname, includeState, session, closeModal, showToast])

  const fabHidden =
    loading ||
    !session ||
    pathname === '/auth' ||
    pathname?.startsWith('/auth')

  const ctxValue = useMemo(() => ({ openFeedback }), [openFeedback])

  const sendDisabled = submitting || body.trim().length === 0

  return (
    <FeedbackContext.Provider value={ctxValue}>
      {children}

      {!fabHidden && (
        <TouchableOpacity
          accessibilityLabel="Send feedback"
          testID="feedback-fab"
          onPress={() => openFeedback()}
          activeOpacity={0.85}
          style={[
            styles.fab,
            {
              right: spacing.lg + insets.right,
              bottom: spacing.xl + insets.bottom,
            },
          ]}
        >
          <Text style={styles.fabGlyph}>✎</Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={modalOpen}
        animationType="fade"
        transparent
        onRequestClose={closeModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Send feedback</Text>

            <TextInput
              testID="feedback-body-input"
              style={styles.input}
              placeholder="What's on your mind?"
              placeholderTextColor={colors.textMuted}
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={4000}
              editable={!submitting}
              textAlignVertical="top"
            />

            <Text style={styles.helper}>Visible to the Trivolta team only.</Text>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Include screen state</Text>
              <Switch
                testID="feedback-include-state"
                value={includeState}
                onValueChange={setIncludeState}
                disabled={submitting}
              />
            </View>

            {errorMsg ? (
              <Text testID="feedback-error" style={styles.errorText}>
                {errorMsg}
              </Text>
            ) : null}

            <View style={styles.buttonRow}>
              <TouchableOpacity
                testID="feedback-cancel"
                onPress={closeModal}
                disabled={submitting}
                style={[styles.btn, styles.btnSecondary]}
                activeOpacity={0.8}
              >
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="feedback-send"
                onPress={handleSend}
                disabled={sendDisabled}
                style={[styles.btn, sendDisabled ? styles.btnPrimaryDisabled : styles.btnPrimary]}
                activeOpacity={0.8}
              >
                <Text style={styles.btnPrimaryText}>{submitting ? 'Sending…' : 'Send'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {toastVisible && (
        <View
          testID="feedback-toast"
          pointerEvents="none"
          style={[styles.toast, { top: insets.top + spacing.md }]}
        >
          <Text style={styles.toastText}>Thanks — feedback received.</Text>
        </View>
      )}
    </FeedbackContext.Provider>
  )
}

export default FeedbackProvider

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 1,
    borderColor: colors.purpleBorder,
  },
  fabGlyph: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: colors.backgroundDeep,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderPurple,
    padding: spacing.xl,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  input: {
    minHeight: 120,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: 14,
  },
  helper: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  switchLabel: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    marginTop: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  btn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    minWidth: 96,
    alignItems: 'center',
  },
  btnSecondary: {
    backgroundColor: colors.surfaceBright,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  btnPrimary: {
    backgroundColor: colors.purple,
  },
  btnPrimaryDisabled: {
    backgroundColor: colors.purpleDim,
  },
  btnPrimaryText: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.purpleDeep,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.purpleBorder,
    alignItems: 'center',
  },
  toastText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
})
