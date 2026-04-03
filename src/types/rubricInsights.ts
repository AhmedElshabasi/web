/** AI holistic output stored on `rubric_insight_snapshots` and `ai_insight_runs`. */

export type InsightAttentionSeverity = 'info' | 'warning' | 'critical'

export type RubricInsightNeedsAttentionItem = {
  /** When the model echoes a known id from the manifest; may be omitted. */
  uploadId?: string | null
  fileId?: string | null
  fileLabel: string
  reason: string
  severity?: InsightAttentionSeverity | null
}

export type RubricInsightContributor = {
  label: string
  appearsToBeWorkingOn: string
  inferredFromNotesOrDocs?: string | null
}

export type RubricInsightQuickBreakdown = {
  overallCompletionPercent: number
  contributors: RubricInsightContributor[]
  synthesis: string
  gapsAndRisks: string
}
