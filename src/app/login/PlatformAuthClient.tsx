'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import { missingSupabaseEnvMessage } from '@/lib/supabaseEnv'
import { isUcalgaryEmail, resolveUcalgaryEmail } from '@/lib/ucalgaryEmail'

type Screen = 'login' | 'confirm'

type FieldErrors = Partial<Record<'first' | 'last' | 'email' | 'pass' | 'pass2', string>>

function Logo() {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="logo-title">NoRedundancy</div>
      <div className="logo-sub">UCalgary Project Intelligence</div>
    </div>
  )
}

export function PlatformAuthClient({ supabaseConfigured }: { supabaseConfigured: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') || '/receive'
  const missingEnv = searchParams.get('missing_env') === '1'

  const [screen, setScreen] = useState<Screen>('login')
  const [authTab, setAuthTab] = useState<'signin' | 'signup'>('signin')
  const [login, setLogin] = useState({ emailLocal: '', password: '' })
  const [signup, setSignup] = useState({
    first: '',
    last: '',
    emailLocal: '',
    pass: '',
    pass2: '',
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingEmail, setPendingEmail] = useState('')

  const signInEmail = useMemo(() => resolveUcalgaryEmail(login.emailLocal), [login.emailLocal])
  const signUpEmail = useMemo(() => resolveUcalgaryEmail(signup.emailLocal), [signup.emailLocal])

  const runSignIn = async () => {
    setFormError(null)
    setFieldErrors({})
    setBusy(true)
    try {
      if (!supabaseBrowser) {
        throw new Error(missingSupabaseEnvMessage())
      }
      if (!isUcalgaryEmail(signInEmail)) {
        throw new Error('Use your @ucalgary.ca email only.')
      }
      if (!signInEmail || !login.password) {
        throw new Error('Enter email and password.')
      }
      const { error } = await supabaseBrowser.auth.signInWithPassword({
        email: signInEmail,
        password: login.password,
      })
      if (error) throw error
      router.push(nextPath)
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  const validateSignup = (): boolean => {
    const next: FieldErrors = {}
    if (!signup.first.trim()) next.first = 'Required'
    if (!signup.last.trim()) next.last = 'Required'
    if (!signup.emailLocal.trim()) next.email = 'Required'
    if (signup.pass.length < 8) next.pass = 'Minimum 8 characters'
    if (signup.pass !== signup.pass2) next.pass2 = 'Passwords do not match'
    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  const runSignUp = async () => {
    setFormError(null)
    if (!validateSignup()) return
    if (!supabaseBrowser) {
      setFormError(missingSupabaseEnvMessage())
      return
    }
    const email = signUpEmail
    if (!isUcalgaryEmail(email)) {
      setFormError('Use your @ucalgary.ca email only.')
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabaseBrowser.auth.signUp({
        email,
        password: signup.pass,
        options: {
          data: {
            first_name: signup.first.trim(),
            last_name: signup.last.trim(),
          },
        },
      })
      if (error) throw error
      if (data.session) {
        router.push(nextPath)
        return
      }
      setPendingEmail(email)
      setScreen('confirm')
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Sign up failed.')
    } finally {
      setBusy(false)
    }
  }

  if (screen === 'confirm') {
    return (
      <div className="screen confirm-screen">
        <div className="card-glass" style={{ textAlign: 'center' }}>
          <div className="confirm-icon" aria-hidden="true">
            ✉
          </div>
          <h2 style={{ color: 'white', marginBottom: 10 }}>Check your email</h2>
          <p style={{ color: 'rgba(255,255,255,.45)', lineHeight: 1.6 }}>
            Your account is almost ready. Confirm the address below, then sign in.
          </p>
          <div className="confirm-email">{pendingEmail}</div>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setScreen('login')
              setAuthTab('signin')
            }}
          >
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen login-screen">
      <div className="login-lines" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} />
        ))}
      </div>
      <div className="card-glass">
        <Logo />
        <h2 style={{ color: 'white', marginBottom: 6 }}>Sign in</h2>
        <p style={{ color: 'rgba(255,255,255,.45)', marginBottom: 24 }}>
          Access your project workspace. Stop losing time to duplicate work and stale documents.
        </p>

        {missingEnv || !supabaseConfigured ? (
          <div className="env-banner" role="alert">
            {missingSupabaseEnvMessage()}
          </div>
        ) : null}

        {formError ? <div className="form-error">{formError}</div> : null}

        <div className="auth-tabs" role="tablist" aria-label="Authentication">
          <button
            type="button"
            className={`auth-tab ${authTab === 'signin' ? 'active' : ''}`}
            onClick={() => {
              setAuthTab('signin')
              setFormError(null)
              setFieldErrors({})
            }}
            disabled={busy}
            role="tab"
            aria-selected={authTab === 'signin'}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`auth-tab ${authTab === 'signup' ? 'active' : ''}`}
            onClick={() => {
              setAuthTab('signup')
              setFormError(null)
              setFieldErrors({})
            }}
            disabled={busy}
            role="tab"
            aria-selected={authTab === 'signup'}
          >
            Create account
          </button>
        </div>

        {authTab === 'signin' ? (
          <>
            <div className="form-field email-suffix">
              <label htmlFor="signin-email">Email</label>
              <input
                id="signin-email"
                value={login.emailLocal}
                onChange={(e) => setLogin({ ...login, emailLocal: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && runSignIn()}
                placeholder="first.last"
                autoComplete="username"
              />
            </div>
            <div className="form-field">
              <label htmlFor="signin-pass">Password</label>
              <input
                id="signin-pass"
                type="password"
                value={login.password}
                onChange={(e) => setLogin({ ...login, password: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && runSignIn()}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            <button type="button" className="primary-btn" onClick={runSignIn} disabled={busy}>
              {busy ? 'Please wait…' : 'Sign in'}
            </button>
            <div className="divider">
              <span>or</span>
            </div>
            <button type="button" className="secondary-btn" disabled title="Google sign-in is not configured yet">
              Continue with Google
            </button>
          </>
        ) : (
          <>
            <div className="name-row">
              <div className="form-field">
                <label htmlFor="su-first">First name</label>
                <input
                  id="su-first"
                  className={fieldErrors.first ? 'error' : ''}
                  value={signup.first}
                  onChange={(e) => setSignup({ ...signup, first: e.target.value })}
                  autoComplete="given-name"
                />
                {fieldErrors.first ? <div className="field-error">{fieldErrors.first}</div> : null}
              </div>
              <div className="form-field">
                <label htmlFor="su-last">Last name</label>
                <input
                  id="su-last"
                  className={fieldErrors.last ? 'error' : ''}
                  value={signup.last}
                  onChange={(e) => setSignup({ ...signup, last: e.target.value })}
                  autoComplete="family-name"
                />
                {fieldErrors.last ? <div className="field-error">{fieldErrors.last}</div> : null}
              </div>
            </div>
            <div className="form-field email-suffix">
              <label htmlFor="su-email">Email</label>
              <input
                id="su-email"
                className={fieldErrors.email ? 'error' : ''}
                value={signup.emailLocal}
                onChange={(e) => setSignup({ ...signup, emailLocal: e.target.value })}
                placeholder="first.last"
                autoComplete="username"
              />
              {fieldErrors.email ? <div className="field-error">{fieldErrors.email}</div> : null}
            </div>
            <div className="form-field">
              <label htmlFor="su-pass">Password</label>
              <input
                id="su-pass"
                type="password"
                className={fieldErrors.pass ? 'error' : ''}
                value={signup.pass}
                onChange={(e) => setSignup({ ...signup, pass: e.target.value })}
                autoComplete="new-password"
              />
              {fieldErrors.pass ? <div className="field-error">{fieldErrors.pass}</div> : null}
            </div>
            <div className="form-field">
              <label htmlFor="su-pass2">Confirm password</label>
              <input
                id="su-pass2"
                type="password"
                className={fieldErrors.pass2 ? 'error' : ''}
                value={signup.pass2}
                onChange={(e) => setSignup({ ...signup, pass2: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && runSignUp()}
                autoComplete="new-password"
              />
              {fieldErrors.pass2 ? <div className="field-error">{fieldErrors.pass2}</div> : null}
            </div>
            <button type="button" className="primary-btn" onClick={runSignUp} disabled={busy}>
              {busy ? 'Please wait…' : 'Create account'}
            </button>
          </>
        )}

        <div className="footer-note">
          Built for UCalgary student project teams. Versioning, tasks, alerts, and AI assistance in one place.
        </div>
      </div>
    </div>
  )
}
