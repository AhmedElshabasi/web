const UCALGARY_DOMAIN = '@ucalgary.ca'

/** Turn "first.last" or full address into a normalized email string (lowercased). */
export function resolveUcalgaryEmail(localPartOrFull: string): string {
  const raw = localPartOrFull.trim()
  if (!raw) return ''
  if (raw.includes('@')) return raw.toLowerCase()
  return `${raw.toLowerCase()}${UCALGARY_DOMAIN}`
}

/** Require institutional email (exact domain @ucalgary.ca, case-insensitive). */
export function isUcalgaryEmail(resolvedEmail: string): boolean {
  const e = resolvedEmail.trim().toLowerCase()
  return e.includes('@') && e.endsWith(UCALGARY_DOMAIN)
}
