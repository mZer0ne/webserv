import React, { useEffect, useState, useCallback } from 'react';
import type { AiStatus, AiModel } from '../types';

const card: React.CSSProperties = {
  padding: 20, backgroundColor: 'var(--bg-glass)',
  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
};
const inp: React.CSSProperties = {
  width: '100%', padding: 10, background: 'rgba(0,0,0,0.2)',
  border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)',
};

const SUGGESTED = ['llama3.2', 'qwen2.5', 'phi3', 'mistral', 'gemma2', 'deepseek-r1', 'nomic-embed-text'];

function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export default function AiView() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [models, setModels] = useState<AiModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState('');
  const [error, setError] = useState('');
  const [pullName, setPullName] = useState('');

  // quick test
  const [testModel, setTestModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [thinking, setThinking] = useState(false);

  const refresh = useCallback(async () => {
    const s = await window.api.ai.status();
    setStatus(s);
    if (s.ready) {
      try { setModels(await window.api.ai.listModels()); } catch (e: any) { setError(e.message); }
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const bootstrap = async () => {
    setBusy(true); setError('');
    try {
      const s = await window.api.ai.bootstrap();
      setStatus(s);
      if (!s.ready) setError(s.error || 'Ollama is starting — retry in a moment.');
      else await refresh();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const pull = async (name: string) => {
    const n = name.trim();
    if (!n) return;
    setPulling(n); setError('');
    try {
      const res = await window.api.ai.pullModel(n);
      if (!res.success) setError(res.error || 'Pull failed');
      setPullName('');
      await refresh();
    } catch (e: any) { setError(e.message); }
    finally { setPulling(''); }
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete model ${name}?`)) return;
    await window.api.ai.deleteModel(name);
    await refresh();
  };

  const runTest = async () => {
    if (!testModel || !prompt.trim()) return;
    setThinking(true); setAnswer('');
    const res = await window.api.ai.generate(testModel, prompt.trim());
    setAnswer(res.error ? `Error: ${res.error}` : res.response || '(empty)');
    setThinking(false);
  };

  if (!status) return <div style={{ color: 'var(--text-muted)' }}>Checking Ollama…</div>;

  if (!status.installed || !status.ready) {
    return (
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>🤖</div>
        <h3>{status.installed ? 'Ollama is starting…' : 'Local LLM server (Ollama) not installed'}</h3>
        <p style={{ color: 'var(--text-secondary)', maxWidth: 560, margin: '8px auto 24px' }}>
          {status.installed
            ? 'The container exists but the API is not responding yet. Give it a moment.'
            : 'WebServ will pull and run the ollama/ollama container, then let you download and run open LLMs locally via its REST API on port ' + status.port + '.'}
        </p>
        <button className="btn-primary" disabled={busy} onClick={bootstrap}>
          {busy ? 'Working…' : status.installed ? 'Retry / Start' : 'Install & Start Ollama'}
        </button>
        {error && <p style={{ color: 'var(--color-danger)', marginTop: 16 }}>{error}</p>}
        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 20 }}>
          ⓘ On macOS, Docker containers run CPU-only — inference works but without Apple-GPU acceleration.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h3>Local LLM Models</h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-success)' }}>● Ollama on :{status.port}</span>
      </div>

      {/* Pull */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input style={inp} placeholder="model name, e.g. llama3.2:3b" value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && pull(pullName)} disabled={!!pulling} />
          <button className="btn-primary" disabled={!!pulling || !pullName.trim()} onClick={() => pull(pullName)}>
            {pulling ? `Pulling ${pulling}…` : '⬇ Pull'}
          </button>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SUGGESTED.map((m) => (
            <button key={m} className="stack-badge" style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.04)' }}
              disabled={!!pulling} onClick={() => pull(m)}>+ {m}</button>
          ))}
        </div>
        {pulling && <p style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: '0.82rem' }}>Downloading {pulling} — this can take several minutes…</p>}
      </div>

      {error && <div style={{ color: 'var(--color-danger)', marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{error}</div>}

      {/* Installed models */}
      {models.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)', marginBottom: 16 }}>No models yet. Pull one above.</div>
      ) : (
        <table className="project-table" style={{ marginBottom: 16 }}>
          <thead><tr><th>Model</th><th>Params</th><th>Quant</th><th>Size</th><th>Actions</th></tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.name}>
                <td style={{ fontWeight: 600 }}>{m.name}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{m.parameterSize || '—'}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{m.quantization || '—'}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{fmtSize(m.size)}</td>
                <td>
                  <button className="btn-action" title="Test" onClick={() => setTestModel(m.name)}>💬</button>
                  <button className="btn-action stop" title="Delete" onClick={() => remove(m.name)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Quick test */}
      <div style={card}>
        <h4 style={{ marginBottom: 12 }}>Quick test</h4>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <select style={{ ...inp, maxWidth: 240 }} value={testModel} onChange={(e) => setTestModel(e.target.value)}>
            <option value="">Select model…</option>
            {models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
          <input style={inp} placeholder="Ask something…" value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runTest()} />
          <button className="btn-primary" disabled={thinking || !testModel || !prompt.trim()} onClick={runTest}>
            {thinking ? '…' : 'Send'}
          </button>
        </div>
        {answer && (
          <pre style={{ margin: 0, padding: 14, background: 'rgba(0,0,0,0.25)', borderRadius: 'var(--radius-sm)',
            whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-secondary)', maxHeight: 300, overflow: 'auto' }}>
            {answer}
          </pre>
        )}
      </div>
    </div>
  );
}
