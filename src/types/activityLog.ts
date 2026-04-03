import type { RubricInsightNeedsAttentionItem, RubricInsightQuickBreakdown } from '@/types/rubricInsights'

export type ActivityTimelineKind = 'insight' | 'note' | 'file_deleted'

export type ActivityTimelineItem = {
  id: string
  kind: ActivityTimelineKind
  at: string
  title: string
  meta: string
  description: string
  badge: 'info' | 'success' | 'warn' | 'danger'
}

export type NoteNeedsAttentionItem = {
  noteId: string
  uploadId: string
  uploadLabel: string
  authorEmail: string | null
  bodyPreview: string
  priority: 'high' | 'urgent'
  createdAt: string | null
}

export type ActivityLogPayload = {
  timeline: ActivityTimelineItem[]
  needsAttention: {
    fromAi: RubricInsightNeedsAttentionItem[]
    fromNotes: NoteNeedsAttentionItem[]
  }
  quickBreakdown: RubricInsightQuickBreakdown | null
  snapshotUpdatedAt: string | null
  overallCompletionPercent: number | null
}
