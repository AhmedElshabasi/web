'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import { missingSupabaseEnvMessage } from '@/lib/supabaseEnv'
import { isUcalgaryEmail, resolveUcalgaryEmail } from '@/lib/ucalgaryEmail'

type Screen = 'login' | 'confirm'

type FieldErrors = Partial<Record<'first' | 'last' | 'email' | 'pass' | 'pass2', string>>

export function PlatformAuthClient({ supabaseConfigured }: { supabaseConfigured: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') || '/receive'
  const missingEnv = searchParams.get('missing_env') === '1'

  const [screen, setScreen] = useState<Screen>('login')
  const [authTab, setAuthTab] = useState<'login' | 'signup'>('login')
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

  const switchAuth = (tab: 'login' | 'signup') => {
    setAuthTab(tab)
    setFormError(null)
    setFieldErrors({})
  }

  const runSignIn = useCallback(async () => {
    setFormError(null)
    setFieldErrors({})
    setBusy(true)
    try {
      if (!supabaseBrowser) {
        throw new Error(missingSupabaseEnvMessage())
      }
      const email = resolveUcalgaryEmail(login.emailLocal)
      if (!isUcalgaryEmail(email)) {
        throw new Error('Use your @ucalgary.ca email only.')
      }
      if (!email || !login.password) {
        throw new Error('Enter email and password.')
      }
      const { error } = await supabaseBrowser.auth.signInWithPassword({
        email,
        password: login.password,
      })
      if (error) throw error
      router.push(nextPath)
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }, [login.emailLocal, login.password, nextPath, router])

  const runSignUp = useCallback(async () => {
    setFormError(null)
    const next: FieldErrors = {}
    if (!signup.first.trim()) next.first = 'Required'
    if (!signup.last.trim()) next.last = 'Required'
    if (!signup.emailLocal.trim()) next.email = 'Required'
    else {
      const email = resolveUcalgaryEmail(signup.emailLocal)
      if (!isUcalgaryEmail(email)) next.email = 'Must be a @ucalgary.ca address'
    }
    if (signup.pass.length < 8) next.pass = 'Minimum 8 characters'
    if (signup.pass !== signup.pass2) next.pass2 = 'Passwords do not match'
    setFieldErrors(next)
    if (Object.keys(next).length > 0) return

    if (!supabaseBrowser) {
      setFormError(missingSupabaseEnvMessage())
      return
    }
    const email = resolveUcalgaryEmail(signup.emailLocal)
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
  }, [nextPath, router, signup.emailLocal, signup.first, signup.last, signup.pass, signup.pass2])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || screen !== 'login' || busy) return
      const loginEl = document.getElementById('screen-login')
      if (!loginEl?.classList.contains('active')) return
      if (authTab === 'signup') void runSignUp()
      else void runSignIn()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [screen, authTab, busy, runSignIn, runSignUp])

  const clearFieldError = (f: keyof FieldErrors) => {
    setFieldErrors((prev) => {
      const n = { ...prev }
      delete n[f]
      return n
    })
  }

  return (
    <>
      <div id="screen-login" className={`screen${screen === 'login' ? ' active' : ''}`}>
        <div className="login-lines" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>

        <div className="login-card">
          <div className="login-logo">
            <div
              className="login-logo-icon"
              style={{ background: 'none', padding: 0, overflow: 'hidden', borderRadius: 8 }}
            >
              <img
                src="/sign-in-ref/logo-icon.png"
                alt=""
                style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }}
              />
            </div>
            <div className="login-logo-text">
              NoRedundancy
              <em>AI</em>
            </div>
          </div>

          {missingEnv || !supabaseConfigured ? (
            <div className="field-error show" role="alert" style={{ marginBottom: 16 }}>
              {missingSupabaseEnvMessage()}
            </div>
          ) : null}
          {formError ? (
            <div className="field-error show" role="alert" style={{ marginBottom: 16 }}>
              {formError}
            </div>
          ) : null}

          <div className="auth-tabs" role="tablist" aria-label="Authentication">
            <button
              type="button"
              className={`auth-tab${authTab === 'login' ? ' active' : ''}`}
              onClick={() => switchAuth('login')}
              disabled={busy}
              role="tab"
              aria-selected={authTab === 'login'}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-tab${authTab === 'signup' ? ' active' : ''}`}
              onClick={() => switchAuth('signup')}
              disabled={busy}
              role="tab"
              aria-selected={authTab === 'signup'}
            >
              Create Account
            </button>
          </div>

          <div className={`auth-form${authTab === 'login' ? ' active' : ''}`} id="auth-login">
            <h2>Welcome back</h2>
            <p>Sign in with your UCalgary account.</p>

            <div className="form-field">
              <label>UCalgary Email</label>
              <div className="email-suffix">
                <input
                  type="text"
                  id="login-email"
                  placeholder="firstname.lastname"
                  value={login.emailLocal}
                  onChange={(e) => setLogin({ ...login, emailLocal: e.target.value })}
                  autoComplete="username"
                />
              </div>
            </div>
            <div className="form-field">
              <label>Password</label>
              <input
                type="password"
                id="login-pass"
                placeholder="••••••••••"
                value={login.password}
                onChange={(e) => setLogin({ ...login, password: e.target.value })}
                autoComplete="current-password"
              />
            </div>
            <button type="button" className="login-btn" onClick={() => void runSignIn()} disabled={busy}>
              {busy ? 'Please wait…' : 'Sign In →'}
            </button>

            <div className="login-footer">
              Access restricted to @ucalgary.ca email addresses.
              <br />
              ENCI 565 — Project Management 2
            </div>
          </div>

          <div className={`auth-form${authTab === 'signup' ? ' active' : ''}`} id="auth-signup">
            <h2>Create account</h2>
            <p>Register with your UCalgary email to get started.</p>

            <div className="name-row">
              <div className="form-field">
                <label>First Name</label>
                <input
                  type="text"
                  id="signup-first"
                  placeholder="Estacio"
                  className={fieldErrors.first ? 'error' : ''}
                  value={signup.first}
                  onChange={(e) => {
                    setSignup({ ...signup, first: e.target.value })
                    clearFieldError('first')
                  }}
                  autoComplete="given-name"
                />
                <div className={`field-error${fieldErrors.first ? ' show' : ''}`} id="err-first">
                  {fieldErrors.first ?? 'Required'}
                </div>
              </div>
              <div className="form-field">
                <label>Last Name</label>
                <input
                  type="text"
                  id="signup-last"
                  placeholder="Pereira"
                  className={fieldErrors.last ? 'error' : ''}
                  value={signup.last}
                  onChange={(e) => {
                    setSignup({ ...signup, last: e.target.value })
                    clearFieldError('last')
                  }}
                  autoComplete="family-name"
                />
                <div className={`field-error${fieldErrors.last ? ' show' : ''}`} id="err-last">
                  {fieldErrors.last ?? 'Required'}
                </div>
              </div>
            </div>

            <div className="form-field">
              <label>UCalgary Email</label>
              <div className="email-suffix">
                <input
                  type="text"
                  id="signup-email"
                  placeholder="firstname.lastname"
                  className={fieldErrors.email ? 'error' : ''}
                  value={signup.emailLocal}
                  onChange={(e) => {
                    setSignup({ ...signup, emailLocal: e.target.value })
                    clearFieldError('email')
                  }}
                  autoComplete="username"
                />
              </div>
              <div className={`field-error${fieldErrors.email ? ' show' : ''}`} id="err-email">
                {fieldErrors.email ?? 'Must be a @ucalgary.ca address'}
              </div>
            </div>

            <div className="form-field">
              <label>Password</label>
              <input
                type="password"
                id="signup-pass"
                placeholder="Min. 8 characters"
                className={fieldErrors.pass ? 'error' : ''}
                value={signup.pass}
                onChange={(e) => {
                  setSignup({ ...signup, pass: e.target.value })
                  clearFieldError('pass')
                }}
                autoComplete="new-password"
              />
              <div className={`field-error${fieldErrors.pass ? ' show' : ''}`} id="err-pass">
                {fieldErrors.pass ?? 'Minimum 8 characters'}
              </div>
            </div>

            <div className="form-field">
              <label>Confirm Password</label>
              <input
                type="password"
                id="signup-pass2"
                placeholder="Re-enter password"
                className={fieldErrors.pass2 ? 'error' : ''}
                value={signup.pass2}
                onChange={(e) => {
                  setSignup({ ...signup, pass2: e.target.value })
                  clearFieldError('pass2')
                }}
                autoComplete="new-password"
              />
              <div className={`field-error${fieldErrors.pass2 ? ' show' : ''}`} id="err-pass2">
                {fieldErrors.pass2 ?? 'Passwords do not match'}
              </div>
            </div>

            <button type="button" className="login-btn" onClick={() => void runSignUp()} disabled={busy}>
              {busy ? 'Please wait…' : 'Create Account →'}
            </button>

            <div className="login-footer" style={{ marginTop: 16 }}>
              Access restricted to @ucalgary.ca email addresses.
              <br />
              ENCI 565 — Project Management 2
            </div>
          </div>
        </div>

        <div className="ucalgary-badge" style={{ top: 28, right: 28, bottom: 'auto' }}>
          <img
            src="/sign-in-ref/badge.png"
            alt="University of Calgary 60th Anniversary"
            style={{ width: 180, height: 'auto', display: 'block' }}
          />
        </div>
      </div>

      <div id="screen-confirm" className={`screen${screen === 'confirm' ? ' active' : ''}`}>
        <div className="confirm-card">
          <div className="confirm-icon" aria-hidden="true">
            ✉
          </div>
          <h2>Check your inbox</h2>
          <p>A confirmation email has been sent to:</p>
          <div className="confirm-email-display" id="confirm-email-display">
            {pendingEmail}
          </div>
          <p>
            Click the link in the email to verify your account and complete registration. Check your spam folder if you
            don&apos;t see it.
          </p>
          <br />
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,.2)' }}>
            ENCI 565 — Project Management 2 · NoRedundancy
          </p>
          <button
            type="button"
            className="confirm-back"
            onClick={() => {
              setScreen('login')
              setAuthTab('login')
            }}
          >
            ← Back to Sign In
          </button>
        </div>
      </div>
    </>
  )
}
