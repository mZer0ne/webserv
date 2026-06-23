import React, { useEffect, useState, useCallback } from 'react';
import type { ServiceInfo, SystemMetrics } from '../types';

const CATEGORY_ORDER = [
  'Web Server', 'PHP', 'MariaDB', 'MySQL', 'PostgreSQL',
  'Redis', 'Memcached', 'MongoDB', 'Node.js', 'WordPress', 'Other',
];

export default function DashboardView() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [logs, setLogs] = useState<{ name: string; text: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const [svc, m] = await Promise.all([
      window.api.services.list(),
      window.api.system.metrics(),
    ]);
    setServices(svc);
    setMetrics(m);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  const control = async (id: string, action: 'start' | 'stop' | 'restart') => {
    await window.api.services.control(id, action);
    refresh();
  };

  const groupControl = async (members: ServiceInfo[], action: 'start' | 'stop' | 'restart') => {
    await Promise.all(members.map((m) => window.api.services.control(m.id, action)));
    refresh();
  };

  const toggleCollapse = (project: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(project) ? next.delete(project) : next.add(project);
      return next;
    });
  };

  const showLogs = async (s: ServiceInfo) => {
    const text = await window.api.services.logs(s.id);
    setLogs({ name: s.name, text: text || '(no output)' });
  };

  // group services into category cards
  const groups = new Map<string, ServiceInfo[]>();
  for (const s of services) {
    if (!groups.has(s.category)) groups.set(s.category, []);
    groups.get(s.category)!.push(s);
  }
  const orderedCategories = [...groups.keys()].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b)
  );

  // Overview lists the user's own services; WebServ's own infra (web/proxy/runtimes) is hidden.
  const overviewServices = services.filter((s) => !s.managed);

  // Group compose-project containers together (Docker-Desktop style); the rest stay flat.
  const projectGroups = new Map<string, ServiceInfo[]>();
  const standalone: ServiceInfo[] = [];
  for (const s of overviewServices) {
    if (s.project) {
      if (!projectGroups.has(s.project)) projectGroups.set(s.project, []);
      projectGroups.get(s.project)!.push(s);
    } else {
      standalone.push(s);
    }
  }

  const renderRow = (s: ServiceInfo, project: string | null) => {
    const running = s.state === 'running';
    const display = project && s.name.startsWith(`${project}-`) ? s.name.slice(project.length + 1) : s.name;
    return (
      <tr key={s.id}>
        <td style={{ ...td, paddingLeft: project ? 46 : 20 }}>{display}</td>
        <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{s.version}</td>
        <td style={td}><span className={`run-badge ${running ? 'run' : 'stopped'}`}>{running ? 'Running' : 'Stopped'}</span></td>
        <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{s.pid || '—'}</td>
        <td style={td}>
          {running ? (
            <button className="ctrl-btn" title="Stop" onClick={() => control(s.id, 'stop')}>🔴</button>
          ) : (
            <button className="ctrl-btn" title="Start" onClick={() => control(s.id, 'start')}>🟢</button>
          )}
          <button className="ctrl-btn" title="Restart" onClick={() => control(s.id, 'restart')}>🔄</button>
          <button className="ctrl-btn" title="Logs" onClick={() => showLogs(s)}>📄</button>
        </td>
      </tr>
    );
  };

  return (
    <div className="dash-grid">
      <div>
        {/* Status cards */}
        <div className="service-cards">
          {orderedCategories.map((cat) => (
            <ServiceCard key={cat} category={cat} services={groups.get(cat)!} />
          ))}
        </div>

        {/* Overview table */}
        <div className="project-table" style={{ display: 'block', padding: 0 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', fontWeight: 600 }}>
            Overview
          </div>
          {overviewServices.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No services running.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Service Name</th>
                  <th style={th}>Version</th>
                  <th style={th}>Status</th>
                  <th style={th}>PID</th>
                  <th style={th}>Control</th>
                </tr>
              </thead>
              <tbody>
                {[...projectGroups.entries()].map(([project, members]) => {
                  const anyRunning = members.some((m) => m.state === 'running');
                  const isCollapsed = collapsed.has(project);
                  return (
                    <React.Fragment key={project}>
                      <tr style={{ background: 'rgba(255,255,255,0.02)', cursor: 'pointer' }} onClick={() => toggleCollapse(project)}>
                        <td style={{ ...td, fontWeight: 600 }}>
                          <span style={{ display: 'inline-block', width: 16, color: 'var(--text-muted)' }}>{isCollapsed ? '▸' : '▾'}</span>
                          {project}
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8, fontSize: '0.8rem' }}>({members.length})</span>
                        </td>
                        <td style={td} />
                        <td style={td}><span className={`run-badge ${anyRunning ? 'run' : 'stopped'}`}>{anyRunning ? 'Running' : 'Stopped'}</span></td>
                        <td style={td} />
                        <td style={td} onClick={(e) => e.stopPropagation()}>
                          {anyRunning ? (
                            <button className="ctrl-btn" title="Stop all" onClick={() => groupControl(members, 'stop')}>🔴</button>
                          ) : (
                            <button className="ctrl-btn" title="Start all" onClick={() => groupControl(members, 'start')}>🟢</button>
                          )}
                          <button className="ctrl-btn" title="Restart all" onClick={() => groupControl(members, 'restart')}>🔄</button>
                        </td>
                      </tr>
                      {!isCollapsed && members.map((s) => renderRow(s, project))}
                    </React.Fragment>
                  );
                })}
                {standalone.map((s) => renderRow(s, null))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Metrics column */}
      <div>
        <div className="metric-panel">
          <h4>CPU Load</h4>
          <Gauge value={metrics?.cpu.usage ?? 0} />
          <div className="metric-sub">
            <div>System<b>{metrics?.cpu.system ?? 0} %</b></div>
            <div>User<b>{metrics?.cpu.user ?? 0} %</b></div>
            <div>Nice<b>{metrics?.cpu.nice ?? 0} %</b></div>
            <div>Idle<b>{metrics?.cpu.idle ?? 0} %</b></div>
          </div>
        </div>

        <div className="metric-panel">
          <h4>CPU Usage History</h4>
          <Sparkline data={metrics?.cpu.history ?? []} />
        </div>

        <div className="metric-panel">
          <h4>Memory</h4>
          <div className="metric-row"><span>Pressure {metrics?.memory.pressure ?? 0} %</span><span>{metrics?.memory.usedGB ?? 0}/{metrics?.memory.totalGB ?? 0} GB</span></div>
          <div className="metric-bar"><span style={{ width: `${metrics?.memory.pressure ?? 0}%` }} /></div>
          <div className="metric-sub">
            <div>App<b>{metrics?.memory.app ?? 0} GB</b></div>
            <div>Wired<b>{metrics?.memory.wired ?? 0} GB</b></div>
            <div>Comp.<b>{metrics?.memory.compressed ?? 0} GB</b></div>
            <div>Free<b>{((metrics?.memory.totalGB ?? 0) - (metrics?.memory.usedGB ?? 0)).toFixed(1)} GB</b></div>
          </div>
        </div>

        <div className="metric-panel">
          <h4>Storage</h4>
          <div className="metric-bar"><span style={{ width: `${metrics?.storage.percent ?? 0}%` }} /></div>
          <div className="metric-row"><span>{metrics?.storage.percent ?? 0} %</span><span>{metrics?.storage.usedTB ?? 0}/{metrics?.storage.totalTB ?? 0} TB</span></div>
        </div>

        <div className="metric-panel">
          <h4>Network</h4>
          <div className="metric-row"><span>{metrics?.network.ip ?? '—'}</span></div>
          <div className="metric-sub" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>Upload<b>{metrics?.network.uploadKbps ?? 0} KB/s</b></div>
            <div>Download<b>{metrics?.network.downloadKbps ?? 0} KB/s</b></div>
          </div>
        </div>
      </div>

      {logs && (
        <div className="modal-overlay" onClick={() => setLogs(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <header>
              <span style={{ fontWeight: 600 }}>Logs · {logs.name}</span>
              <button className="ctrl-btn" onClick={() => setLogs(null)}>✕</button>
            </header>
            <pre>{logs.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceCard({ category, services }: { category: string; services: ServiceInfo[] }) {
  const anyRunning = services.some((s) => s.state === 'running');
  const multi = services.length > 1 && (category === 'PHP' || category === 'Web Server');

  return (
    <div className="service-card">
      <div className="sc-title">{category}</div>
      {multi ? (
        <div className="sc-versions">
          {services.slice(0, 6).map((s) => (
            <div className="sc-ver-row" key={s.id}>
              <span>{s.version}</span>
              <span className={`sc-tick ${s.state === 'running' ? 'run' : 'stopped'}`}>
                {s.state === 'running' ? '✓' : '■'}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className={`sc-badge ${anyRunning ? 'run' : 'stopped'}`}>{anyRunning ? '✓' : '■'}</div>
      )}
      <div className="sc-footer">
        {multi ? `${services.filter((s) => s.state === 'running').length}/${services.length} active`
          : `Version: ${services[0]?.version ?? 'N/A'}`}
      </div>
    </div>
  );
}

function Gauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const angle = -90 + (v / 100) * 180; // -90 (left) .. +90 (right)
  const r = 70, cx = 100, cy = 95;
  const needleLen = 60;
  const rad = (angle * Math.PI) / 180;
  const nx = cx + needleLen * Math.sin(rad);
  const ny = cy - needleLen * Math.cos(rad);
  const arc = (start: number, end: number) => {
    const a0 = ((-90 + start) * Math.PI) / 180;
    const a1 = ((-90 + end) * Math.PI) / 180;
    return `M ${cx + r * Math.sin(a0)} ${cy - r * Math.cos(a0)} A ${r} ${r} 0 0 1 ${cx + r * Math.sin(a1)} ${cy - r * Math.cos(a1)}`;
  };
  return (
    <svg viewBox="0 0 200 110" style={{ width: '100%' }}>
      <path d={arc(0, 60)} fill="none" stroke="var(--color-success)" strokeWidth="10" strokeLinecap="round" />
      <path d={arc(60, 120)} fill="none" stroke="var(--color-warning)" strokeWidth="10" />
      <path d={arc(120, 180)} fill="none" stroke="var(--color-danger)" strokeWidth="10" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--text-primary)" strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5" fill="var(--text-primary)" />
      <text x={cx} y={cy - 18} textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--text-primary)">{v}%</text>
    </svg>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const w = 280, h = 60;
  if (data.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%' }} />;
  const max = Math.max(10, ...data);
  const step = w / (data.length - 1);
  const pts = data.map((d, i) => `${i * step},${h - (d / max) * h}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block' }} preserveAspectRatio="none">
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill="rgba(16,185,129,0.18)" stroke="none" />
      <polyline points={pts} fill="none" stroke="var(--color-success)" strokeWidth="2" />
    </svg>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '12px 20px', fontSize: '0.78rem', textTransform: 'uppercase',
  letterSpacing: '0.5px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)',
};
const td: React.CSSProperties = { padding: '12px 20px', fontSize: '0.88rem', borderBottom: '1px solid var(--border-color)' };
