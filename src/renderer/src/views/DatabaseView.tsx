import React, { useEffect, useState } from 'react';
import type { DbContainer, QueryResult } from '../types';

const card: React.CSSProperties = {
  padding: '16px',
  backgroundColor: 'var(--bg-glass)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
};

export default function DatabaseView() {
  const [containers, setContainers] = useState<DbContainer[]>([]);
  const [selected, setSelected] = useState<DbContainer | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [activeDb, setActiveDb] = useState<string | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.db.listContainers().then(setContainers);
  }, []);

  const selectContainer = async (c: DbContainer) => {
    setSelected(c);
    setDatabases([]); setTables([]); setActiveDb(null); setResult(null); setError('');
    if (c.state !== 'running') { setError('Container is not running.'); return; }
    if (c.engine !== 'mysql' && c.engine !== 'postgres') {
      setError(`Browsing not supported for ${c.engine} yet.`); return;
    }
    try {
      setDatabases(await window.api.db.listDatabases(c.id));
    } catch (e: any) { setError(e.message); }
  };

  const selectDb = async (db: string) => {
    if (!selected) return;
    setActiveDb(db); setResult(null); setError('');
    try {
      setTables(await window.api.db.listTables(selected.id, db));
    } catch (e: any) { setError(e.message); }
  };

  const run = async (query?: string) => {
    if (!selected) return;
    const q = query ?? sql;
    if (!q.trim()) return;
    if (query) setSql(query);
    setBusy(true); setError('');
    try {
      const res = await window.api.db.runQuery(selected.id, activeDb, q);
      setResult(res);
      if (res.error) setError(res.error);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={card}>
          <h4 style={{ marginBottom: 12 }}>Database Servers</h4>
          {containers.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No DB containers found.</span>}
          {containers.map((c) => (
            <div key={c.id} onClick={() => selectContainer(c)} style={{
              padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', marginBottom: 4,
              background: selected?.id === c.id ? 'rgba(255,255,255,0.06)' : 'transparent',
            }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                <span className={`dot ${c.state === 'running' ? 'active' : ''}`} style={{ marginRight: 6 }} />
                {c.name}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.engine} · {c.image}</div>
            </div>
          ))}
        </div>

        {databases.length > 0 && (
          <div style={card}>
            <h4 style={{ marginBottom: 12 }}>Databases</h4>
            {databases.map((db) => (
              <div key={db} onClick={() => selectDb(db)} style={{
                padding: '6px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.85rem',
                background: activeDb === db ? 'rgba(255,255,255,0.06)' : 'transparent',
              }}>🗄️ {db}</div>
            ))}
          </div>
        )}

        {tables.length > 0 && (
          <div style={card}>
            <h4 style={{ marginBottom: 12 }}>Tables · {activeDb}</h4>
            {tables.map((t) => (
              <div key={t} onClick={() => run(`SELECT * FROM ${t} LIMIT 100;`)} style={{
                padding: '5px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.82rem',
                fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
              }}>▤ {t}</div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div style={card}>
          <textarea value={sql} onChange={(e) => setSql(e.target.value)}
            placeholder={selected ? 'SELECT 1;' : 'Select a database server first…'}
            disabled={!selected}
            style={{
              width: '100%', minHeight: 90, resize: 'vertical', fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem', background: 'rgba(0,0,0,0.25)', color: 'var(--text-primary)',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: 10,
            }} />
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn-primary" disabled={!selected || busy} onClick={() => run()}>
              {busy ? 'Running…' : '▶ Run query'}
            </button>
            {activeDb && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>against <b>{activeDb}</b></span>}
          </div>
        </div>

        {error && <div style={{ ...card, color: 'var(--color-danger, #e25555)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{error}</div>}

        {result && !result.error && (
          <div style={{ ...card, overflow: 'auto', flex: 1 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 8 }}>{result.rows.length} row(s)</div>
            <table className="project-table">
              <thead><tr>{result.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
              <tbody>
                {result.rows.map((row, ri) => (
                  <tr key={ri}>{row.map((cell, ci) => (
                    <td key={ci} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{cell}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
