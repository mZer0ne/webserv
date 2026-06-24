import { useState, useEffect, useCallback } from 'react';
import DashboardView from './views/DashboardView';
import RuntimesView from './views/RuntimesView';
import SitesView from './views/SitesView';
import AiView from './views/AiView';
import DatabaseView from './views/DatabaseView';
import SettingsView from './views/SettingsView';

type Tab = 'dashboard' | 'sites' | 'runtimes' | 'database' | 'ai' | 'settings';

const NAV: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: '📊 Dashboard' },
  { id: 'sites', label: '🌍 Sites' },
  { id: 'runtimes', label: '🧩 Services' },
  { id: 'database', label: '🗄️ Databases' },
  { id: 'ai', label: '🤖 AI / LLM' },
  { id: 'settings', label: '⚙️ Settings' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [dockerActive, setDockerActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ version: 'Unknown', containers: 0, containersRunning: 0, images: 0, memory: 'N/A' });

  const fetchData = useCallback(async () => {
    try {
      const status = await window.api.docker.checkStatus();
      setDockerActive(status.active);
      if (status.active) {
        setStats({
          version: status.version || 'Unknown',
          containers: status.containers || 0,
          containersRunning: status.containersRunning || 0,
          images: status.images || 0,
          memory: status.memory || 'N/A',
        });
      }
    } catch (err) {
      console.error('Error fetching docker data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div>
          <div className="brand-section">
            <div className="brand-logo">W</div>
            <span className="brand-name">WebServ</span>
          </div>
          <nav>
            <ul className="nav-list">
              {NAV.map((n) => (
                <li key={n.id} className={`nav-item ${activeTab === n.id ? 'active' : ''}`} onClick={() => setActiveTab(n.id)}>
                  {n.label}
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="sidebar-footer">
          <div>WebServ v0.1.0 (Alpha)</div>
          <div>Docker Engine v{stats.version}</div>
        </div>
      </aside>

      <main className="main-viewport">
        <header className="header-bar">
          <h2 className="page-title">{NAV.find((n) => n.id === activeTab)?.label.replace(/^\S+\s/, '')}</h2>
          <div className="system-status-badges">
            <div className="status-badge" style={{ cursor: 'default' }}>
              <span className={`dot ${dockerActive ? 'active' : ''}`} />
              Docker: {dockerActive ? 'Connected' : 'Disconnected'}
            </div>
          </div>
        </header>

        <div className="content-scrollable">
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading Docker environment…</div>
          ) : !dockerActive && activeTab !== 'settings' ? (
            <div style={{ padding: 40, textAlign: 'center', backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>🔌</div>
              <h3>Docker daemon is offline or inaccessible</h3>
              <p style={{ color: 'var(--text-secondary)', marginTop: 8, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
                Make sure Docker Desktop or the Docker daemon is running. We look for the socket at
                <code> /var/run/docker.sock</code> and <code>~/.docker/run/docker.sock</code>.
                {' '}You can adjust the Docker host in <a className="domain-link" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('settings')}>Settings</a>.
              </p>
              <p style={{ color: 'var(--text-muted)', marginTop: 12, fontSize: '0.85rem' }}>
                Don't have Docker?{' '}
                <a className="domain-link" href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noreferrer">
                  Install Docker Desktop ↗
                </a>
              </p>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && <DashboardView />}
              {activeTab === 'sites' && <SitesView />}
              {activeTab === 'runtimes' && <RuntimesView />}
              {activeTab === 'database' && <DatabaseView />}
              {activeTab === 'ai' && <AiView />}
              {activeTab === 'settings' && <SettingsView />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
