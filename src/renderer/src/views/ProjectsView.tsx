import React, { useEffect, useState } from 'react';
import type { Template } from '../types';

export default function ProjectsView({ onCreated }: { onCreated: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    window.api.projects.templates().then(setTemplates);
  }, []);

  const create = async () => {
    if (!selected || !name.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const res = await window.api.projects.create({ name: name.trim(), template: selected.id });
      if (res.success) {
        setMsg({ kind: 'ok', text: `Created "${res.project}" at ${res.dir}` });
        setName(''); setSelected(null);
        onCreated();
      } else {
        setMsg({ kind: 'err', text: res.error || 'Failed to create project' });
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 24, backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
      <h3>Project Stack Template Library</h3>
      <p style={{ color: 'var(--text-secondary)', margin: '8px 0 24px' }}>
        Pick a stack, name it, and WebServ scaffolds a docker-compose project and brings it up.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {templates.map((tpl) => (
          <div key={tpl.id} onClick={() => setSelected(tpl)} style={{
            padding: 16, borderRadius: 'var(--radius-md)', cursor: 'pointer',
            border: `1px solid ${selected?.id === tpl.id ? 'var(--color-accent, #5b8cff)' : 'var(--border-color)'}`,
            background: selected?.id === tpl.id ? 'rgba(91,140,255,0.08)' : 'rgba(255,255,255,0.01)',
          }}>
            <div style={{ fontSize: '1.2rem', marginBottom: 8 }}>📂</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{tpl.label}</div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tpl.description}</span>
          </div>
        ))}
      </div>

      {selected && (
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border-color)' }}>
          <h4 style={{ marginBottom: 12 }}>New {selected.label}</h4>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input autoFocus placeholder="project-name" value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              style={{ flex: 1, minWidth: 220, padding: 10, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)' }} />
            <button className="btn-primary" disabled={busy || !name.trim()} onClick={create}>
              {busy ? 'Scaffolding…' : 'Create & Start'}
            </button>
          </div>
          {msg && (
            <p style={{ marginTop: 14, fontSize: '0.85rem', color: msg.kind === 'ok' ? 'var(--color-success)' : 'var(--color-danger, #e25555)' }}>
              {msg.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
