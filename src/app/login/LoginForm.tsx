"use client";

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import { missingSupabaseEnvMessage } from '@/lib/supabaseEnv'
import { isUcalgaryEmail, resolveUcalgaryEmail } from '@/lib/ucalgaryEmail'
import styles from './ucalgary-login.module.css'

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') || '/receive'

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [emailLocal, setEmailLocal] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const email = resolveUcalgaryEmail(emailLocal)

  const submit = async () => {
    setError(null)
    setBusy(true)

    try {
      if (!supabaseBrowser) {
        throw new Error(missingSupabaseEnvMessage())
      }
      if (!isUcalgaryEmail(email)) {
        throw new Error('Use your @ucalgary.ca email only.')
      }
      if (mode === 'signup') {
        const fn = firstName.trim()
        const ln = lastName.trim()
        if (!fn || !ln) {
          throw new Error('Enter your first and last name.')
        }
        const { error: signUpError } = await supabaseBrowser.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: fn,
              last_name: ln,
            },
          },
        })
        if (signUpError) throw signUpError
        // If email confirmations are disabled, user will be signed in immediately.
        router.push(nextPath)
        return
      }

      const { error: signInError } = await supabaseBrowser.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) throw signInError
      router.push(nextPath)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Authentication failed.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Authentication mode">
        <button
          type="button"
          className={`${styles.tab} ${mode === 'signin' ? styles.activeTab : ''}`}
          onClick={() => setMode('signin')}
          disabled={busy}
          role="tab"
          aria-selected={mode === 'signin'}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`${styles.tab} ${mode === 'signup' ? styles.activeTab : ''}`}
          onClick={() => setMode('signup')}
          disabled={busy}
          role="tab"
          aria-selected={mode === 'signup'}
        >
          Create account
        </button>
      </div>

      {mode === 'signup' ? (
        <div className={styles.nameRow}>
          <div className={styles.field}>
            <label htmlFor="firstName">First name</label>
            <input
              id="firstName"
              className={styles.inputPlain}
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Given name"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="lastName">Last name</label>
            <input
              id="lastName"
              className={styles.inputPlain}
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Family name"
            />
          </div>
        </div>
      ) : null}

      <div className={styles.field}>
        <label htmlFor="emailLocal">Email</label>
        <div className={styles.emailSuffix}>
          <input
            id="emailLocal"
            className={styles.input}
            placeholder="first.last"
            type="text"
            autoComplete="username"
            value={emailLocal}
            onChange={(e) => setEmailLocal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            aria-invalid={!!error}
          />
        </div>
        <div className={styles.hint}>
          Must be <span className={styles.mono}>@ucalgary.ca</span> — signing in as{' '}
          <span className={styles.mono}>{email || '…@ucalgary.ca'}</span>
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          className={styles.input}
          placeholder="Your password"
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          aria-invalid={!!error}
        />
      </div>

      {error ? <div className={styles.errorMsg}>{error}</div> : null}

      <button
        className={styles.primaryBtn}
        onClick={submit}
        disabled={
          busy ||
          !email ||
          !password ||
          (mode === 'signup' && (!firstName.trim() || !lastName.trim()))
        }
        type="button"
      >
        {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>

      <div className={styles.divider} aria-hidden="true">
        <span />
        <span>or</span>
        <span />
      </div>

      <button
        type="button"
        className={styles.secondaryBtn}
        onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
        disabled={busy}
      >
        {mode === 'signin' ? 'Need an account? Create one' : 'Have an account? Sign in'}
      </button>
    </>
  )
}

