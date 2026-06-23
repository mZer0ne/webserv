import React, { useEffect, useState, useCallback } from 'react';
import type { Site, WebStatus, RuntimeStatus } from '../types';

const card: React.CSSProperties = {
  padding: 20, backgroundColor: 'var(--bg-glass)',
  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
};
const inp: React.CSSProperties = {
  width: '100%', padding: 10, background: 'rgba(0,0,0,0.2)',
  border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)',
};

export default function SitesView() {
  const [sites, setSites] = useState<Site[]>([]);
  const [web, setWeb] = useState<WebStatus | null>(null);
  const [phpVersions, setPhpVersions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{ domain: string; root: string; php: string }>({ domain: '', root: '', php: '' });

  const refresh = useCallback(async () => {
    const [s, w, rt] = await Promise.all([
      window.api.sites.list(),
      window.api.sites.webStatus(),
      window.api.runtimes.list(),
    ]);
    setSites(s);
    setWeb(w);
    setPhpVersions(rt.filter((r: RuntimeStatus) => r.category === 'PHP').map((r) => r.label.replace('PHP ', '')));
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [refresh]);

  const pickFolder = async () => {
    const dir = await window.api.dialog.pickFolder();
    if (dir) {
      setForm((f) => ({ ...f, root: dir, domain: f.domain || deriveDomain(dir) }));
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await window.api.sites.add({
        domain: form.domain.trim(),
        root: form.root,
        php: form.php || null,
      });
      if (res.success) {
        setForm({ domain: '', root: '', php: '' });
        await refresh();
      } else {
        setError(res.error || 'Failed to add site');
      }
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const remove = async (s: Site) => {
    if (!confirm(`Remove site ${s.domain}? (files on disk are kept)`)) return;
    await window.api.sites.remove(s.id);
    await refresh();
  };

  const port = web?.httpPort ?? 9080;

  return (
    <div>
      <div className="section-header">
        <h3>Sites</h3>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Web server:{' '}
          <span style={{ color: web?.running ? 'var(--color-success)' : 'var(--text-muted)' }}>
            {web?.running ? `running on :${port}` : web?.installed ? 'stopped' : 'not installed'}
          </span>
          {' · '}root: <code>{web?.sitesRoot}</code>
        </div>
      </div>

      <form onSubmit={add} style={{ ...card, marginBottom: 20, display: 'grid', gridTemplateColumns: '1.4fr 1.6fr 1fr auto', gap: 12, alignItems: 'end' }}>
        <Field label="Domain">
          <input required placeholder="blog.test" style={inp} value={form.domain}
            onChange={(e) => setForm({ ...form, domain: e.target.value })} />
        </Field>
        <Field label="Document root">
          <div style={{ display: 'flex', gap: 8 }}>
            <input required placeholder="~/Sites/blog" style={inp} value={form.root}
              onChange={(e) => setForm({ ...form, root: e.target.value })} />
            <button type="button" className="btn-action" title="Choose folder" onClick={pickFolder} style={{ flexShrink: 0 }}>📁</button>
          </div>
        </Field>
        <Field label="PHP version">
          <select style={inp} value={form.php} onChange={(e) => setForm({ ...form, php: e.target.value })}>
            <option value="">Static (no PHP)</option>
            {phpVersions.map((v) => <option key={v} value={v}>PHP {v}</option>)}
          </select>
        </Field>
        <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Adding…' : '+ Add Site'}</button>
      </form>

      {phpVersions.length === 0 && (
        <div style={{ ...card, marginBottom: 20, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          💡 No PHP runtimes installed yet — install one on the <b>Runtimes</b> tab to serve PHP sites. Static sites work without it.
        </div>
      )}

      {error && <div style={{ color: 'var(--color-danger)', marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{error}</div>}

      {sites.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)' }}>No sites yet. Add one above.</div>
      ) : (
        <table className="project-table">
          <thead><tr><th>Domain</th><th>Document Root</th><th>PHP</th><th>URL</th><th>Actions</th></tr></thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.domain}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{s.root}</td>
                <td><span className="stack-badge">{s.php ? `PHP ${s.php}` : 'Static'}</span></td>
                <td>
                  <a className="domain-link" href={`http://${s.domain}:${port}`} target="_blank" rel="noreferrer">
                    {s.domain}:{port}
                  </a>
                </td>
                <td><button className="btn-action stop" title="Remove" onClick={() => remove(s)}>🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function deriveDomain(dir: string): string {
  const base = dir.split('/').filter(Boolean).pop() || 'site';
  return `${base.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.test`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', marginBottom: 6, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}
