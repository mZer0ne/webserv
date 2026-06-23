import React, { useState, useEffect, useCallback } from 'react';
import type { Project } from './types';
import DashboardView from './views/DashboardView';
import ProjectsView from './views/ProjectsView';
import RuntimesView from './views/RuntimesView';
import SitesView from './views/SitesView';
import AiView from './views/AiView';
import ContainersView from './views/ContainersView';
import ProxyView from './views/ProxyView';
import DatabaseView from './views/DatabaseView';
import SettingsView from './views/SettingsView';

type Tab = 'dashboard' | 'sites' | 'runtimes' | 'projects' | 'containers' | 'proxy' | 'database' | 'ai' | 'settings';

const NAV: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: '📊 Dashboard' },
  { id: 'sites', label: '🌍 Sites' },
  { id: 'runtimes', label: '🧩 Services' },
  // { id: 'projects', label: '📁 Projects' },
  // { id: 'containers', label: '📦 Containers' },
  // { id: 'proxy', label: '🌐 Proxy Manager' },
  // { id: 'database', label: '🗄️ Databases' },
  { id: 'ai', label: '🤖 AI / LLM' },
  { id: 'settings', label: '⚙️ Settings' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [projects, setProjects] = useState<Project[]>([]);
  const [dockerActive, setDockerActive] = useState(false);
  const [proxyActive, setProxyActive] = useState(false);
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
        setProjects(await window.api.projects.list());
        const ps = await window.api.proxy.status();
        setProxyActive(ps.ready);
      } else {
        setProjects([]);
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
            <div className="status-badge" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('proxy')}>
              <span className={`dot ${proxyActive ? 'active' : ''}`} />
              NPM Proxy: {proxyActive ? 'Active' : 'Offline'}
            </div>
          </div>
        </header>

        <div className="content-scrollable">
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading Docker environment…</div>
          ) : !dockerActive ? (
            <div style={{ padding: 40, textAlign: 'center', backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>🔌</div>
              <h3>Docker daemon is offline or inaccessible</h3>
              <p style={{ color: 'var(--text-secondary)', marginTop: 8, maxWidth: 500, marginLeft: 'auto', marginRight: 'auto' }}>
                Make sure Docker Desktop or the Docker daemon is running. We look for the socket at
                <code> /var/run/docker.sock</code> and <code>~/.docker/run/docker.sock</code>.
              </p>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && <DashboardView />}
              {activeTab === 'sites' && <SitesView />}
              {activeTab === 'runtimes' && <RuntimesView />}
              {activeTab === 'projects' && <ProjectsView onCreated={fetchData} />}
              {activeTab === 'containers' && <ContainersView projects={projects} />}
              {activeTab === 'proxy' && <ProxyView />}
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
