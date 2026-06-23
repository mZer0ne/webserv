import React, { useEffect, useState, useCallback } from 'react';
import type { RuntimeStatus, DbFamilyStatus, ServiceInfo, WebStatus } from '../types';

const th: React.CSSProperties = {
  textAlign: 'left', padding: '12px 16px', fontSize: '0.76rem', textTransform: 'uppercase',
  letterSpacing: '0.5px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)',
};
const td: React.CSSProperties = { padding: '10px 16px', fontSize: '0.88rem', borderBottom: '1px solid var(--border-color)' };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-secondary)' };
const selStyle: React.CSSProperties = {
  padding: '4px 8px', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-color)',
  color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
};

function StatusCell({ kind }: { kind: 'run' | 'disabled' | 'missing' }) {
  const label = kind === 'run' ? 'Running' : kind === 'disabled' ? 'Disabled' : 'Not Installed';
  const glyph = kind === 'run' ? '●' : kind === 'disabled' ? '◌' : '⃠';
  return <span className={`svc-status ${kind}`}>{glyph} {label}</span>;
}

export default function RuntimesView() {
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([]);
  const [families, setFamilies] = useState<DbFamilyStatus[]>([]);
  const [webStatus, setWebStatus] = useState<WebStatus | null>(null);
  const [svcById, setSvcById] = useState<Record<string, ServiceInfo>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<{ name: string; text: string } | null>(null);
  const [cfg, setCfg] = useState<{ key: string; label: string; internalPort: number } | null>(null);
  const [cfgPort, setCfgPort] = useState('');
  const [cfgEnv, setCfgEnv] = useState('');
  const [ini, setIni] = useState<{ id: string; label: string } | null>(null);
  const [iniText, setIniText] = useState('');

  const openIni = async (id: string, label: string) => {
    setIni({ id, label });
    setIniText('Loading…');
    setIniText(await window.api.runtimes.readPhpIni(id));
  };

  const saveIni = async () => {
    if (!ini) return;
    const id = ini.id;
    const text = iniText;
    setIni(null);
    await act(id, () => window.api.runtimes.writePhpIni(id, text));
  };

  const openConfig = async (key: string, label: string, internalPort: number) => {
    const c = await window.api.runtimes.getConfig(key);
    setCfg({ key, label, internalPort });
    setCfgPort(c.hostPort ? String(c.hostPort) : '');
    setCfgEnv((c.env || []).join('\n'));
  };

  const saveConfig = async () => {
    if (!cfg) return;
    const hostPort = parseInt(cfgPort, 10);
    const env = cfgEnv.split('\n').map((l) => l.trim()).filter(Boolean);
    const key = cfg.key;
    setCfg(null);
    await act(key, () => window.api.runtimes.saveConfig(key, {
      hostPort: Number.isFinite(hostPort) ? hostPort : undefined,
      env,
    }));
  };

  const refresh = useCallback(async () => {
    const [rt, fam, svc, web] = await Promise.all([
      window.api.runtimes.list(),
      window.api.runtimes.listFamilies(),
      window.api.services.list(),
      window.api.sites.webStatus(),
    ]);
    setRuntimes(rt);
    setFamilies(fam);
    setWebStatus(web);
    const map: Record<string, ServiceInfo> = {};
    for (const s of svc) map[s.id] = s;
    setSvcById(map);
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, [refresh]);

  const act = async (id: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(id); setError('');
    try {
      const res = await fn();
      if (!res.success) setError(res.error || 'Operation failed');
      await refresh();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const showLogs = async (name: string, containerId?: string) => {
    if (!containerId) return;
    const text = await window.api.services.logs(containerId);
    setLogs({ name, text: text || '(no output)' });
  };

  // ----- runtime row (PHP / web servers) -----
  const runtimeRow = (r: RuntimeStatus) => {
    const svc = r.containerId ? svcById[r.containerId] : undefined;
    const working = busy === r.id;
    const kind = !r.installed ? 'missing' : r.running ? 'run' : 'disabled';
    const toggle = () => {
      if (!r.installed) return act(r.id, () => window.api.runtimes.install(r.id));
      return act(r.id, () => window.api.services.control(r.containerId!, r.running ? 'stop' : 'start'));
    };
    return (
      <tr key={r.id}>
        <td style={{ ...td, fontWeight: 600 }}>
          <span style={{ marginRight: 8 }}>{r.icon}</span>{r.label}
          {r.hostPort && <span style={{ ...mono, marginLeft: 8 }}>🔌 {r.hostPort}</span>}
        </td>
        <td style={{ ...td, ...mono }}>{working && !r.installed ? 'installing…' : r.installed ? (svc?.version ?? '…') : '—'}</td>
        <td style={td}><StatusCell kind={kind} /></td>
        <td style={{ ...td, ...mono }}>{svc?.pid || '—'}</td>
        <td style={{ ...td, textAlign: 'center' }}>
          {r.installed ? (
            <label className="toggle"><input type="checkbox" checked={r.running} disabled={working} onChange={toggle} /><span className="track" /></label>
          ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </td>
        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button className="btn-action" title="Settings" disabled={working} onClick={() => openConfig(r.id, r.label, r.internalPort)}>⚙️</button>
          {r.category === 'PHP' && (
            <button className="btn-action" title="Edit php.ini" disabled={working} onClick={() => openIni(r.id, r.label)}>📝</button>
          )}
          {!r.installed ? (
            <button className="btn-action" title="Install" disabled={working} onClick={toggle}>⬇</button>
          ) : (
            <>
              <button className="btn-action" title="Restart" disabled={working || !r.running} onClick={() => act(r.id, () => window.api.services.control(r.containerId!, 'restart'))}>🔄</button>
              <button className="btn-action" title="Logs" disabled={!r.running} onClick={() => showLogs(r.label, r.containerId)}>📄</button>
              <button className="btn-action stop" title="Uninstall" disabled={working} onClick={() => { if (confirm(`Remove ${r.label}?`)) act(r.id, () => window.api.runtimes.uninstall(r.id)); }}>🗑</button>
            </>
          )}
        </td>
      </tr>
    );
  };

  // ----- family row (databases / cache) with version select -----
  const familyRow = (f: DbFamilyStatus) => {
    const newest = f.versions[f.versions.length - 1]?.version;
    const def = f.versions.find((v) => v.running)?.version
      || f.versions.find((v) => v.installed)?.version
      || newest;
    const sel = selected[f.id] || def;
    const vs = f.versions.find((v) => v.version === sel) || f.versions[f.versions.length - 1];
    const svc = vs.containerId ? svcById[vs.containerId] : undefined;
    const rowId = `${f.id}-${sel}`;
    const working = busy === rowId;
    const kind = !vs.installed ? 'missing' : vs.running ? 'run' : 'disabled';
    const toggle = () => {
      if (vs.running) return act(rowId, () => window.api.services.control(vs.containerId!, 'stop'));
      // Start (or re-create with the correct data mount if the layout changed).
      return act(rowId, () => window.api.runtimes.installFamily(f.id, sel));
    };
    return (
      <tr key={f.id}>
        <td style={{ ...td, fontWeight: 600 }}>
          <span style={{ marginRight: 8 }}>{f.icon}</span>{f.label}
          <select style={{ ...selStyle, marginLeft: 10 }} value={sel}
            onChange={(e) => setSelected({ ...selected, [f.id]: e.target.value })}>
            {f.versions.map((v) => (
              <option key={v.version} value={v.version}>{v.version}{v.installed ? ' ✓' : ''}</option>
            ))}
          </select>
          {vs.hostPort && <span style={{ ...mono, marginLeft: 8 }}>🔌 {vs.hostPort}</span>}
        </td>
        <td style={{ ...td, ...mono }}>{working && !vs.installed ? 'installing…' : vs.installed ? (svc?.version ?? '…') : '—'}</td>
        <td style={td}><StatusCell kind={kind} /></td>
        <td style={{ ...td, ...mono }}>{svc?.pid || '—'}</td>
        <td style={{ ...td, textAlign: 'center' }}>
          {vs.installed ? (
            <label className="toggle"><input type="checkbox" checked={vs.running} disabled={working} onChange={toggle} /><span className="track" /></label>
          ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </td>
        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button className="btn-action" title="Settings" disabled={working} onClick={() => openConfig(rowId, `${f.label} ${sel}`, f.internalPort)}>⚙️</button>
          {!vs.installed ? (
            <button className="btn-action" title={`Install ${f.label} ${sel}`} disabled={working} onClick={toggle}>⬇</button>
          ) : (
            <>
              <button className="btn-action" title="Restart" disabled={working || !vs.running} onClick={() => act(rowId, () => window.api.services.control(vs.containerId!, 'restart'))}>🔄</button>
              <button className="btn-action" title="Logs" disabled={!vs.running} onClick={() => showLogs(`${f.label} ${sel}`, vs.containerId)}>📄</button>
              <button className="btn-action stop" title="Uninstall" disabled={working} onClick={() => { if (confirm(`Remove ${f.label} ${sel}?`)) act(rowId, () => window.api.runtimes.uninstall(rowId)); }}>🗑</button>
            </>
          )}
        </td>
      </tr>
    );
  };

  // ----- web server row (the shared site-serving nginx from sites.ts) -----
  const webServerRow = () => {
    const w = webStatus;
    const installed = !!w?.installed;
    const running = !!w?.running;
    const working = busy === 'web';
    const kind = !installed ? 'missing' : running ? 'run' : 'disabled';
    const engine = w?.engine ?? 'nginx';
    const wrap = (p: Promise<unknown>) => p.then(() => ({ success: true })).catch((e: any) => ({ success: false, error: e.message }));
    const toggle = () => running
      ? act('web', () => wrap(window.api.sites.stopWeb()))
      : act('web', () => wrap(window.api.sites.ensureWeb()));
    return (
      <tr key="web">
        <td style={{ ...td, fontWeight: 600 }}>
          <span style={{ marginRight: 8 }}>🌐</span>
          <select style={selStyle} value={engine} disabled={working}
            onChange={(e) => act('web', () => wrap(window.api.sites.setEngine(e.target.value as 'nginx' | 'apache')))}>
            <option value="nginx">Nginx</option>
            <option value="apache">Apache 2</option>
          </select>
          <span style={{ fontWeight: 400, fontSize: '0.76rem', color: 'var(--text-muted)', marginLeft: 8 }}>serves your Sites</span>
          {w?.httpPort && <span style={{ ...mono, marginLeft: 8 }}>🔌 {w.httpPort}</span>}
        </td>
        <td style={{ ...td, ...mono }}>{installed ? engine : '—'}</td>
        <td style={td}><StatusCell kind={kind} /></td>
        <td style={{ ...td, ...mono }}>—</td>
        <td style={{ ...td, textAlign: 'center' }}>
          <label className="toggle"><input type="checkbox" checked={running} disabled={working} onChange={toggle} /><span className="track" /></label>
        </td>
        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button className="btn-action" title="Restart / apply" disabled={working} onClick={() => act('web', () => wrap(window.api.sites.ensureWeb()))}>🔄</button>
          {installed && (
            <button className="btn-action stop" title="Remove web server" disabled={working}
              onClick={() => { if (confirm('Remove the web server container?')) act('web', () => wrap(window.api.sites.removeWeb())); }}>🗑</button>
          )}
        </td>
      </tr>
    );
  };

  const php = runtimes.filter((r) => r.category === 'PHP');

  const section = (title: string, hint: string, rows: React.ReactNode) => (
    <div style={{ marginBottom: 26 }}>
      <h4 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'baseline', gap: 10 }}>
        {title}<span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--text-muted)' }}>{hint}</span>
      </h4>
      <div className="project-table" style={{ display: 'block', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Service Name</th>
              <th style={th}>Installed</th>
              <th style={th}>Status</th>
              <th style={th}>PID</th>
              <th style={{ ...th, textAlign: 'center' }}>Activation</th>
              <th style={{ ...th, textAlign: 'right' }}>Control</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div>
      <div className="section-header">
        <h3>Services</h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {runtimes.filter((r) => r.running).length + families.flatMap((f) => f.versions).filter((v) => v.running).length} running
        </span>
      </div>

      {error && <div style={{ color: 'var(--color-danger)', marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{error}</div>}

      {section('Web Servers', 'shared nginx that serves all sites', webServerRow())}
      {section('PHP', 'each version runs as its own FPM service', php.map(runtimeRow))}
      {section('Databases', 'pick a version before install', families.filter((f) => f.category === 'Databases').map(familyRow))}
      {section('Cache', 'pick a version before install', families.filter((f) => f.category === 'Cache').map(familyRow))}

      {logs && (
        <div className="modal-overlay" onClick={() => setLogs(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <header><span style={{ fontWeight: 600 }}>Logs · {logs.name}</span><button className="ctrl-btn" onClick={() => setLogs(null)}>✕</button></header>
            <pre>{logs.text}</pre>
          </div>
        </div>
      )}

      {cfg && (
        <div className="modal-overlay" onClick={() => setCfg(null)}>
          <div className="modal-box" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <header><span style={{ fontWeight: 600 }}>Settings · {cfg.label}</span><button className="ctrl-btn" onClick={() => setCfg(null)}>✕</button></header>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem' }}>
                  Host port <span style={{ color: 'var(--text-muted)' }}>→ container :{cfg.internalPort} (blank = not published)</span>
                </label>
                <input type="number" value={cfgPort} placeholder={String(cfg.internalPort)}
                  onChange={(e) => setCfgPort(e.target.value)} style={selStyle as React.CSSProperties} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem' }}>
                  Extra environment <span style={{ color: 'var(--text-muted)' }}>(one KEY=VALUE per line)</span>
                </label>
                <textarea value={cfgEnv} onChange={(e) => setCfgEnv(e.target.value)} rows={5}
                  placeholder={'MYSQL_ROOT_PASSWORD=secret\nTZ=Europe/Moscow'}
                  style={{ ...selStyle as React.CSSProperties, width: '100%', resize: 'vertical' }} />
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Saving recreates the container if it already exists (data volumes are preserved).
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn-action" onClick={() => setCfg(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveConfig}>Save & apply</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {ini && (
        <div className="modal-overlay" onClick={() => setIni(null)}>
          <div className="modal-box" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
            <header><span style={{ fontWeight: 600 }}>php.ini · {ini.label}</span><button className="ctrl-btn" onClick={() => setIni(null)}>✕</button></header>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <textarea value={iniText} onChange={(e) => setIniText(e.target.value)} spellCheck={false} rows={20}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', lineHeight: 1.5,
                  background: 'rgba(0,0,0,0.25)', color: 'var(--text-primary)', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)', padding: 12 }} />
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Overlaid on the image defaults (mounted at conf.d). Saving restarts this PHP-FPM service.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn-action" onClick={() => setIni(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveIni}>Save & apply</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
