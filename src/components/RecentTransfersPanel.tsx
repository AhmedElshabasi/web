export function RecentTransfersPanel() {
  return (
    <div className="recent-transfers-page">
      <section className="rt-hero">
        <div className="rt-hero-inner">
          <div>
            <div className="rt-kicker">Transfer intelligence</div>
            <h1>Recent transfers</h1>
            <p>
              Track every file handoff, see what got opened, and catch links that are about to die before someone pings
              you saying the download is broken.
            </p>
          </div>
          <div className="rt-live-chip">
            <span className="rt-live-dot" />
            Live session activity
          </div>
        </div>
      </section>

      <section className="rt-stats">
        <div className="rt-stat red">
          <div className="rt-stat-label">Transfers today</div>
          <div className="rt-stat-value">24</div>
          <div className="rt-stat-sub">6 more than yesterday</div>
        </div>
        <div className="rt-stat gold">
          <div className="rt-stat-label">Pending expiry</div>
          <div className="rt-stat-value">5</div>
          <div className="rt-stat-sub">Need attention in the next 12h</div>
        </div>
        <div className="rt-stat blue">
          <div className="rt-stat-label">Open rate</div>
          <div className="rt-stat-value">78%</div>
          <div className="rt-stat-sub">Recipients are actually using the links</div>
        </div>
        <div className="rt-stat green">
          <div className="rt-stat-label">Data moved</div>
          <div className="rt-stat-value">18.4 GB</div>
          <div className="rt-stat-sub">Across the last 7 days</div>
        </div>
      </section>

      <div className="rt-layout">
        <section className="card">
          <div className="card-header">
            <div className="card-title">↗ Transfer history</div>
            <div className="rt-toolbar">
              <input className="rt-search" type="text" placeholder="Search file, recipient, or note" readOnly />
              <select className="rt-filter" defaultValue="all">
                <option value="all">All statuses</option>
                <option value="opened">Opened</option>
                <option value="sent">Sent</option>
                <option value="expiring">Expiring</option>
                <option value="expired">Expired</option>
              </select>
              <select className="rt-sort" defaultValue="newest">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="largest">Largest first</option>
                <option value="most-opened">Most opened</option>
              </select>
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="rt-table-wrap">
              <table className="rt-table">
                <thead>
                  <tr>
                    <th>Transfer</th>
                    <th>Recipient</th>
                    <th>Status</th>
                    <th>When</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="rt-file">
                        <div className="rt-file-badge">PDF</div>
                        <div>
                          <div className="rt-file-name">Capstone_Final_Report.pdf</div>
                          <div className="rt-file-meta">4.2 MB • 1 file • final submission package</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="rt-user">
                        <div className="rt-avatar">ML</div>
                        <div>
                          <div className="rt-file-name">Maria Lee</div>
                          <div className="rt-user-meta">maria.lee@ucalgary.ca</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="rt-status opened">Opened 3 times</span>
                    </td>
                    <td>
                      <div className="rt-date-meta">Today, 2:14 PM</div>
                      <div className="rt-date-meta">Expires in 18h</div>
                    </td>
                    <td>
                      <div className="rt-actions">
                        <button type="button" className="rt-btn">
                          Copy link
                        </button>
                        <button type="button" className="rt-btn">
                          Extend
                        </button>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="rt-file">
                        <div className="rt-file-badge">ZIP</div>
                        <div>
                          <div className="rt-file-name">UI_Assets_Review.zip</div>
                          <div className="rt-file-meta">812 MB • 14 files • design handoff</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="rt-user">
                        <div className="rt-avatar" style={{ background: 'var(--blue)' }}>
                          AR
                        </div>
                        <div>
                          <div className="rt-file-name">Alex Raman</div>
                          <div className="rt-user-meta">alex.r@ucalgary.ca</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="rt-status sent">Sent</span>
                    </td>
                    <td>
                      <div className="rt-date-meta">Today, 11:08 AM</div>
                      <div className="rt-date-meta">Expires in 46h</div>
                    </td>
                    <td>
                      <div className="rt-actions">
                        <button type="button" className="rt-btn primary">
                          Resend
                        </button>
                        <button type="button" className="rt-btn">
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="rt-file">
                        <div className="rt-file-badge">DOCX</div>
                        <div>
                          <div className="rt-file-name">Meeting_Notes_TA.docx</div>
                          <div className="rt-file-meta">284 KB • 1 file • feedback summary</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="rt-user">
                        <div
                          className="rt-avatar"
                          style={{ background: 'var(--gold)', color: '#362700' }}
                        >
                          SK
                        </div>
                        <div>
                          <div className="rt-file-name">Sam Khan</div>
                          <div className="rt-user-meta">sam.khan@ucalgary.ca</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="rt-status expiring">Expiring soon</span>
                    </td>
                    <td>
                      <div className="rt-date-meta">Yesterday, 7:42 PM</div>
                      <div className="rt-date-meta">Expires in 2h</div>
                    </td>
                    <td>
                      <div className="rt-actions">
                        <button type="button" className="rt-btn primary">
                          Extend
                        </button>
                        <button type="button" className="rt-btn">
                          Copy link
                        </button>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div className="rt-file">
                        <div className="rt-file-badge">PPT</div>
                        <div>
                          <div className="rt-file-name">Midterm_Presentation_v3.pptx</div>
                          <div className="rt-file-meta">19.6 MB • 1 file • committee deck</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="rt-user">
                        <div className="rt-avatar" style={{ background: '#7a4ab5' }}>
                          JH
                        </div>
                        <div>
                          <div className="rt-file-name">Jayden Hall</div>
                          <div className="rt-user-meta">jayden.h@ucalgary.ca</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="rt-status expired">Expired</span>
                    </td>
                    <td>
                      <div className="rt-date-meta">Mar 25, 9:16 AM</div>
                      <div className="rt-date-meta">Expired 6h ago</div>
                    </td>
                    <td>
                      <div className="rt-actions">
                        <button type="button" className="rt-btn primary">
                          Generate new link
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside className="rt-side-stack">
          <section className="card">
            <div className="card-header">
              <div className="card-title">⚠ Needs attention</div>
            </div>
            <div className="card-body">
              <div className="rt-mini-list">
                <div className="rt-mini-item">
                  <div>
                    <div className="rt-mini-title">Meeting_Notes_TA.docx</div>
                    <div className="rt-mini-sub">
                      Recipient has not opened the link and it dies in 2 hours.
                    </div>
                  </div>
                  <div className="rt-metric">
                    <div className="rt-metric-value">2h</div>
                    <div className="rt-mini-sub">left</div>
                  </div>
                </div>
                <div className="rt-mini-item">
                  <div>
                    <div className="rt-mini-title">Midterm_Presentation_v3.pptx</div>
                    <div className="rt-mini-sub">Expired. If they still need it, resend now.</div>
                  </div>
                  <div className="rt-metric">
                    <div className="rt-metric-value">0</div>
                    <div className="rt-mini-sub">active links</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <div className="card-title">📊 Quick breakdown</div>
            </div>
            <div className="card-body">
              <div className="rt-mini-list">
                <div className="rt-mini-item">
                  <div>
                    <div className="rt-mini-title">Opened links</div>
                    <div className="rt-mini-sub">Transfers that were clicked at least once.</div>
                  </div>
                  <div className="rt-metric">
                    <div className="rt-metric-value">14</div>
                    <div className="rt-mini-sub">of 18</div>
                  </div>
                </div>
                <div className="rt-mini-item">
                  <div>
                    <div className="rt-mini-title">Largest transfer</div>
                    <div className="rt-mini-sub">UI_Assets_Review.zip moved the most data this week.</div>
                  </div>
                  <div className="rt-metric">
                    <div className="rt-metric-value">812</div>
                    <div className="rt-mini-sub">MB</div>
                  </div>
                </div>
                <div className="rt-mini-item">
                  <div>
                    <div className="rt-mini-title">Average time to open</div>
                    <div className="rt-mini-sub">How fast recipients actually respond after receiving a link.</div>
                  </div>
                  <div className="rt-metric">
                    <div className="rt-metric-value">38m</div>
                    <div className="rt-mini-sub">avg</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
