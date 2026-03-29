export function ActivityLogPanel() {
  return (
    <div className="activity-log-page">
      <section className="al-hero">
        <div className="al-hero-inner">
          <div>
            <div className="al-kicker">Workspace monitoring</div>
            <h1>Activity Log</h1>
            <p>
              Track meaningful actions across uploads, transfers, and access. This is where you catch what happened,
              who touched what, and whether it matters.
            </p>
          </div>
          <div className="al-live-chip">
            <span className="al-live-dot" />
            Live audit trail
          </div>
        </div>
      </section>

      <section className="al-stats">
        <div className="al-stat red">
          <div className="al-stat-label">Events today</div>
          <div className="al-stat-value">146</div>
          <div className="al-stat-sub">Across uploads, opens, and shares</div>
        </div>
        <div className="al-stat gold">
          <div className="al-stat-label">Flagged</div>
          <div className="al-stat-value">7</div>
          <div className="al-stat-sub">Need review or follow-up</div>
        </div>
        <div className="al-stat blue">
          <div className="al-stat-label">Users active</div>
          <div className="al-stat-value">19</div>
          <div className="al-stat-sub">Touched the workspace today</div>
        </div>
        <div className="al-stat green">
          <div className="al-stat-label">Blocked attempts</div>
          <div className="al-stat-value">8</div>
          <div className="al-stat-sub">Stopped before access</div>
        </div>
      </section>

      <div className="al-layout">
        <section className="card">
          <div className="card-header">
            <div className="card-title">🕘 Timeline</div>
            <div className="al-toolbar">
              <input className="al-search" type="text" placeholder="Search file, user, or action" readOnly />
              <select className="al-filter" defaultValue="all-events">
                <option value="all-events">All events</option>
                <option value="uploads">Uploads</option>
                <option value="shares">Shares</option>
                <option value="opens">Opens</option>
                <option value="expired">Expired links</option>
                <option value="failed">Failed access</option>
              </select>
              <select className="al-filter" defaultValue="all-sev">
                <option value="all-sev">All severity</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div className="card-body">
            <div className="activity-timeline">
              <div className="activity-item">
                <div className="activity-icon info">↗</div>
                <div className="activity-content">
                  <div className="activity-top">
                    <div>
                      <div className="activity-title">Share link created</div>
                      <div className="activity-meta">Maria Lee • Capstone_Final_Report.pdf • 2:14 PM</div>
                    </div>
                    <span className="activity-badge info">Info</span>
                  </div>
                  <div className="activity-desc">Created link for the capstone report.</div>
                </div>
              </div>
              <div className="activity-item">
                <div className="activity-icon success">↓</div>
                <div className="activity-content">
                  <div className="activity-top">
                    <div>
                      <div className="activity-title">File opened</div>
                      <div className="activity-meta">Alex Raman • UI_Assets_Review.zip • 11:31 AM</div>
                    </div>
                    <span className="activity-badge success">Opened</span>
                  </div>
                  <div className="activity-desc">UI assets file accessed successfully.</div>
                </div>
              </div>
              <div className="activity-item">
                <div className="activity-icon warn">!</div>
                <div className="activity-content">
                  <div className="activity-top">
                    <div>
                      <div className="activity-title">Link expiring soon</div>
                      <div className="activity-meta">Sam Khan • Meeting_Notes_TA.docx • 9:42 AM</div>
                    </div>
                    <span className="activity-badge warn">Warning</span>
                  </div>
                  <div className="activity-desc">File not opened yet. Expires in 2 hours.</div>
                </div>
              </div>
              <div className="activity-item">
                <div className="activity-icon danger">×</div>
                <div className="activity-content">
                  <div className="activity-top">
                    <div>
                      <div className="activity-title">Failed access</div>
                      <div className="activity-meta">Unknown • Midterm_Presentation_v3.pptx • 8:07 AM</div>
                    </div>
                    <span className="activity-badge danger">Critical</span>
                  </div>
                  <div className="activity-desc">Attempted to access expired link.</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="al-side-stack">
          <section className="card">
            <div className="card-header">
              <div className="card-title">⚠ Flagged Activity</div>
            </div>
            <div className="card-body">
              <div className="al-mini-list">
                <div className="al-mini-item">
                  <div>
                    <div className="al-mini-title">Expired link access</div>
                    <div className="al-mini-sub">Midterm_Presentation_v3.pptx was requested after expiry.</div>
                  </div>
                  <span className="al-mini-tag danger">Critical</span>
                </div>
                <div className="al-mini-item">
                  <div>
                    <div className="al-mini-title">Not opened before expiry</div>
                    <div className="al-mini-sub">Meeting_Notes_TA.docx still has no recipient activity.</div>
                  </div>
                  <span className="al-mini-tag warn">Review</span>
                </div>
                <div className="al-mini-item">
                  <div>
                    <div className="al-mini-title">Multiple opens</div>
                    <div className="al-mini-sub">Capstone_Final_Report.pdf has been opened 3 times today.</div>
                  </div>
                  <span className="al-mini-tag info">Track</span>
                </div>
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <div className="card-title">📌 Event Breakdown</div>
            </div>
            <div className="card-body">
              <div className="al-breakdown">
                <div className="al-break-row">
                  <span>Uploads</span>
                  <strong>28</strong>
                </div>
                <div className="al-break-row">
                  <span>Shares</span>
                  <strong>24</strong>
                </div>
                <div className="al-break-row">
                  <span>Opens</span>
                  <strong>67</strong>
                </div>
                <div className="al-break-row">
                  <span>Expiries</span>
                  <strong>19</strong>
                </div>
                <div className="al-break-row">
                  <span>Blocked</span>
                  <strong>8</strong>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
