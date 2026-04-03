/** Fired when workspace data that affects Activity Log (or similar) may have changed. */
export const WORKSPACE_ACTIVITY_EVENT = 'nr-workspace-activity'

export function emitWorkspaceActivity(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WORKSPACE_ACTIVITY_EVENT))
}
