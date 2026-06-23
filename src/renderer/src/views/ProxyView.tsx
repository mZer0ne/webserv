import React, { useEffect, useState } from 'react';
import type { ProxyHost, ProxyStatus } from '../types';

const card: React.CSSProperties = {
  padding: '24px',
  backgroundColor: 'var(--bg-glass)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-lg)',
};

export default function ProxyView() {
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [hosts, setHosts] = useState<ProxyHost[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ domain: '', forwardHost: '', forwardPort: '80' });

  const refresh = async () => {
    const s = await window.api.proxy.status();
    setStatus(s);
    if (s.ready) {
      try {
        setHosts(await window.api.proxy.listHosts());
      } catch (e: any) {
        setError(e.message);
      }
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const bootstrap = async () => {
    setBusy(true);
    setError('');
    try {
      const s = await window.api.proxy.bootstrap();
      setStatus(s);
      if (!s.ready) setError(s.error || 'NPM container started but API is not ready yet. Retry shortly.');
      else await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addHost = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await window.api.proxy.upsertHost({
        domain: form.domain.trim(),
        forwardHost: form.forwardHost.trim(),
        forwardPort: parseInt(form.forwardPort, 10) || 80,
      });
      setForm({ domain: '', forwardHost: '', forwardPort: '80' });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (h: ProxyHost) => {
    await window.api.proxy.setEnabled(h.id, !h.enabled);
    await refresh();
  };

  const remove = async (h: ProxyHost) => {
    if (!confirm(`Delete proxy host ${h.domain_names.join(', ')}?`)) return;
    await window.api.proxy.deleteHost(h.id);
    await refresh();
  };

  if (!status) return <div style={{ color: 'var(--text-muted)' }}>Checking proxy status…</div>;

  if (!status.installed || !status.ready) {
    return (
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>🌐</div>
        <h3>{status.installed ? 'Nginx Proxy Manager is starting…' : 'Nginx Proxy Manager not installed'}</h3>
        <p style={{ color: 'var(--text-secondary)', maxWidth: 520, margin: '8px auto 24px' }}>
          {status.installed
            ? 'The container exists but the API is not responding yet. First boot runs DB migrations — give it a moment.'
            : 'WebServ will pull and run the jc21/nginx-proxy-manager container, attach it to your app network, and manage proxy hosts for your local domains.'}
        </p>
        <button className="btn-primary" disabled={busy} onClick={bootstrap}>
          {busy ? 'Working…' : status.installed ? 'Retry / Start' : 'Install & Start NPM'}
        </button>
        {error && <p style={{ color: 'var(--color-danger, #e25555)', marginTop: 16 }}>{error}</p>}
      </div>
    );
  }

  return (
    <>
      <div className="section-header">
        <h3>Reverse Proxy Hosts</h3>
        <a className="domain-link" href={status.adminUrl} target="_blank" rel="noreferrer">
          Open NPM admin ↗
        </a>
      </div>

      <form onSubmit={addHost} style={{ ...card, marginBottom: 20, display: 'grid', gridTemplateColumns: '2fr 2fr 1fr auto', gap: 12, alignItems: 'end' }}>
        <Field label="Domain">
          <input required placeholder="myapp.test" value={form.domain}
            onChange={(e) => setForm({ ...form, domain: e.target.value })} style={inp} />
        </Field>
        <Field label="Forward host (container name)">
          <input required placeholder="myapp-web-1" value={form.forwardHost}
            onChange={(e) => setForm({ ...form, forwardHost: e.target.value })} style={inp} />
        </Field>
        <Field label="Port">
          <input required value={form.forwardPort}
            onChange={(e) => setForm({ ...form, forwardPort: e.target.value })} style={inp} />
        </Field>
        <button className="btn-primary" disabled={busy} type="submit">+ Add</button>
      </form>

      {error && <p style={{ color: 'var(--color-danger, #e25555)', marginBottom: 12 }}>{error}</p>}

      {hosts.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)' }}>No proxy hosts yet.</div>
      ) : (
        <table className="project-table">
          <thead>
            <tr><th>Domain</th><th>Forwards to</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {hosts.map((h) => (
              <tr key={h.id}>
                <td style={{ fontWeight: 600 }}>
                  <a className="domain-link" href={`http://${h.domain_names[0]}`} target="_blank" rel="noreferrer">
                    {h.domain_names.join(', ')}
                  </a>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {h.forward_scheme}://{h.forward_host}:{h.forward_port}
                </td>
                <td>
                  <span className={`dot ${h.enabled ? 'active' : ''}`} style={{ marginRight: 6 }} />
                  {h.enabled ? 'Enabled' : 'Disabled'}
                </td>
                <td>
                  <button className="btn-action" title="Toggle" onClick={() => toggle(h)}>{h.enabled ? '⏸' : '▶'}</button>
                  <button className="btn-action stop" title="Delete" onClick={() => remove(h)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

const inp: React.CSSProperties = {
  width: '100%', padding: '10px', background: 'rgba(0,0,0,0.2)',
  border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', marginBottom: 6, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}
