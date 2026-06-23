import React, { useEffect, useState } from 'react';
import type { AppSettings } from '../types';

const inp: React.CSSProperties = {
  width: '100%', padding: 10, background: 'rgba(0,0,0,0.2)',
  border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)',
};

export default function SettingsView() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { window.api.settings.get().then(setS); }, []);

  if (!s) return <div style={{ color: 'var(--text-muted)' }}>Loading settings…</div>;

  const save = async () => {
    const next = await window.api.settings.set(s);
    setS(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder = '') => (
    <div>
      <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem' }}>{label}</label>
      <input style={inp} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  const portField = (label: string, value: number, onChange: (v: number) => void, fallback: number) => (
    <div>
      <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem' }}>{label}</label>
      <input style={inp} type="number" value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || fallback)} />
    </div>
  );

  return (
    <div style={{ padding: 24, backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
      <h3>Engine & Infrastructure Controls</h3>
      <p style={{ color: 'var(--text-secondary)', margin: '8px 0 24px' }}>
        Docker connection, local DNS, service ports and the bundled services.
      </p>

      <h4 style={{ margin: '0 0 16px' }}>General</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {field('Docker Host / Socket (blank = auto)', s.dockerSocketPath, (v) => setS({ ...s, dockerSocketPath: v }), 'tcp://127.0.0.1:2375 or //./pipe/docker_engine')}
        {field('Local TLD Suffix', s.tldSuffix, (v) => setS({ ...s, tldSuffix: v }))}
        {field('Docker Network', s.networkName, (v) => setS({ ...s, networkName: v }))}
        {field('Sites Root', s.sitesRoot, (v) => setS({ ...s, sitesRoot: v }))}
        {field('Workspace Directory (compose projects)', s.workspaceDir, (v) => setS({ ...s, workspaceDir: v }))}
      </div>

      <h4 style={{ margin: '28px 0 16px' }}>Ports</h4>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '-8px 0 16px' }}>
        Containers are recreated automatically when a port changes. Avoid ports already in use (80/443 = system Apache).
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
        {portField('Sites — HTTP', s.web.httpPort, (v) => setS({ ...s, web: { ...s.web, httpPort: v } }), 9080)}
        {portField('Sites — HTTPS', s.web.httpsPort, (v) => setS({ ...s, web: { ...s.web, httpsPort: v } }), 9443)}
        {portField('Ollama (AI)', s.ai.port, (v) => setS({ ...s, ai: { ...s.ai, port: v } }), 11434)}
        {portField('NPM — Admin UI', s.npm.adminPort, (v) => setS({ ...s, npm: { ...s.npm, adminPort: v } }), 9081)}
        {portField('NPM — HTTP', s.npm.httpPort, (v) => setS({ ...s, npm: { ...s.npm, httpPort: v } }), 9082)}
        {portField('NPM — HTTPS', s.npm.httpsPort, (v) => setS({ ...s, npm: { ...s.npm, httpsPort: v } }), 9444)}
      </div>

      <h4 style={{ margin: '28px 0 16px' }}>Nginx Proxy Manager</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {field('Admin Email', s.npm.adminEmail, (v) => setS({ ...s, npm: { ...s.npm, adminEmail: v } }))}
        {field('Admin Password', s.npm.adminPassword, (v) => setS({ ...s, npm: { ...s.npm, adminPassword: v } }))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem' }}>
          <input type="checkbox" checked={s.npm.enabled} onChange={(e) => setS({ ...s, npm: { ...s.npm, enabled: e.target.checked } })} />
          Auto-register domains in NPM on project start
        </label>
      </div>

      <div style={{ marginTop: 28, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn-primary" onClick={save}>Save settings</button>
        {saved && <span style={{ color: 'var(--color-success)', fontSize: '0.85rem' }}>✓ Saved</span>}
      </div>
    </div>
  );
}
