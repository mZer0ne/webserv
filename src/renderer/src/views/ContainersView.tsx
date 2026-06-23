import React from 'react';
import type { Project } from '../types';

export default function ContainersView({ projects }: { projects: Project[] }) {
  const containers = projects.flatMap((p) => p.containers || []);
  return (
    <div style={{ padding: 24, backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
      <h3>Docker Daemon Topologies</h3>
      <p style={{ color: 'var(--text-secondary)', margin: '8px 0 24px' }}>Running Docker processes and orchestration states.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {containers.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>No containers found in Docker.</div>
        ) : (
          containers.map((c, i) => (
            <div key={c.id || i} style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)' }}>
              <div>
                <span style={{ fontWeight: 600, marginRight: 8 }}>{c.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>({c.image})</span>
              </div>
              <span style={{ color: c.state === 'running' ? 'var(--color-success)' : 'var(--text-muted)', fontWeight: 600, fontSize: '0.85rem', textTransform: 'uppercase' }}>
                {c.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
