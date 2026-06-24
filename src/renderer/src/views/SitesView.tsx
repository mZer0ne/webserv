import React, {useEffect, useState, useCallback} from 'react';
import type {Site, SiteType, WebStatus, RuntimeStatus, ServiceInfo} from '../types';

const card: React.CSSProperties = {
    padding: 20, backgroundColor: 'var(--bg-glass)',
    border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
};
const inp: React.CSSProperties = {
    width: '100%', padding: 10, background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)',
};

interface FormState {
    type: SiteType;
    domain: string;
    root: string;
    php: string;
    target: string;
    port: string;
}

const EMPTY: FormState = {type: 'app', domain: '', root: '', php: '', target: '', port: ''};

export default function SitesView() {
    const [sites, setSites] = useState<Site[]>([]);
    const [web, setWeb] = useState<WebStatus | null>(null);
    const [phpVersions, setPhpVersions] = useState<string[]>([]);
    const [containers, setContainers] = useState<{ name: string; ports: number[] }[]>([]);
    const [ca, setCa] = useState<{ generated: boolean; trusted: boolean } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [form, setForm] = useState<FormState>(EMPTY);
    const [editing, setEditing] = useState<Site | null>(null);
    const [editForm, setEditForm] = useState<FormState>(EMPTY);

    const refresh = useCallback(async () => {
        const [s, w, rt, svc, caStatus] = await Promise.all([
            window.api.sites.list(),
            window.api.sites.webStatus(),
            window.api.runtimes.list(),
            window.api.services.list(),
            window.api.tls.status(),
        ]);
        setSites(s);
        setWeb(w);
        setCa(caStatus);
        setPhpVersions(rt.filter((r: RuntimeStatus) => r.category === 'PHP').map((r) => r.label.replace('PHP ', '')));
        setContainers(
            svc.filter((c: ServiceInfo) => c.state === 'running' && !c.managed && c.name !== 'webserv-web')
                .map((c) => ({name: c.name, ports: c.internalPorts || []}))
        );
    }, []);

    const portsFor = (name: string): number[] => containers.find((c) => c.name === name)?.ports || [];

    useEffect(() => {
        refresh();
        const t = setInterval(refresh, 4000);
        return () => clearInterval(t);
    }, [refresh]);

    const toInput = (f: FormState) => ({
        domain: f.domain.trim(),
        type: f.type,
        root: f.root,
        php: f.php || null,
        target: f.target.trim(),
        targetPort: parseInt(f.port, 10) || 0,
    });

    const pick = async (set: React.Dispatch<React.SetStateAction<FormState>>, fillDomain: boolean) => {
        const dir = await window.api.dialog.pickFolder();
        if (dir) set((f) => ({...f, root: dir, domain: fillDomain && !f.domain ? deriveDomain(dir) : f.domain}));
    };

    const add = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const res = await window.api.sites.add(toInput(form));
            if (res.success) {
                setForm(EMPTY);
                await refresh();
            } else setError(res.error || 'Failed to add site');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const openEdit = (s: Site) => {
        setError('');
        setEditing(s);
        setEditForm({
            type: s.type || 'app', domain: s.domain, root: s.root, php: s.php || '',
            target: s.target || '', port: s.targetPort ? String(s.targetPort) : '',
        });
    };

    const saveEdit = async () => {
        if (!editing) return;
        setBusy(true);
        setError('');
        try {
            const res = await window.api.sites.update(editing.id, toInput(editForm));
            if (res.success) {
                setEditing(null);
                await refresh();
            } else setError(res.error || 'Failed to update site');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const startWeb = async () => {
        setBusy(true);
        setError('');
        try {
            await window.api.sites.ensureWeb();
            await refresh();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (s: Site) => {
        if (!confirm(`Remove site ${s.domain}? (files on disk are kept)`)) return;
        await window.api.sites.remove(s.id);
        await refresh();
    };

    const installCa = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await window.api.tls.installCa();
            if (!res.success) setError(res.error || 'Failed to install CA');
            await refresh();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const port = web?.httpPort ?? 9080;
    const httpsPort = web?.httpsPort ?? 9443;

    // shared field renderers (app vs proxy) used by both add form and edit modal
    const typeField = (f: FormState, set: React.Dispatch<React.SetStateAction<FormState>>) => (
        <Field label="Type">
            <select style={inp} value={f.type} onChange={(e) => set({...f, type: e.target.value as SiteType})}>
                <option value="app">App / files</option>
                <option value="proxy">Proxy → container</option>
            </select>
        </Field>
    );

    const targetField = (f: FormState, set: React.Dispatch<React.SetStateAction<FormState>>) => (
        <Field label="Target container">
            <input list="webserv-containers" style={inp} placeholder="my-app-1" value={f.target}
                   onChange={(e) => {
                       const name = e.target.value;
                       const ports = portsFor(name);
                       // auto-fill the container's internal port (NOT the host-published one)
                       set({...f, target: name, port: ports.length && !f.port ? String(ports[0]) : f.port});
                   }}/>
            <datalist id="webserv-containers">{containers.map((c) => <option key={c.name} value={c.name}/>)}</datalist>
        </Field>
    );

    const portField = (f: FormState, set: React.Dispatch<React.SetStateAction<FormState>>) => {
        const ports = portsFor(f.target);
        return (
            <Field label="Internal port">
                <input required list="webserv-ports" style={inp} placeholder="80" value={f.port}
                       onChange={(e) => set({...f, port: e.target.value})}/>
                <datalist id="webserv-ports">{ports.map((p) => <option key={p} value={p}/>)}</datalist>
            </Field>
        );
    };

    return (
        <div>
            <div className="section-header">
                <h3>Sites</h3>
                <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                    <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>
                        Web server:{' '}
                        <span style={{color: web?.running ? 'var(--color-success)' : 'var(--text-muted)'}}>
              {web?.running ? `running on :${port}` : web?.installed ? 'stopped' : 'not installed'}
            </span>
                        {' · '}{web?.engine ?? 'nginx'}
                    </div>
                    <button className="btn-primary" disabled={busy} onClick={startWeb}>
                        {busy ? '…' : web?.running ? '↻ Restart server' : '▶ Start web server'}
                    </button>
                </div>
            </div>

            <div style={{
                ...card,
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 20px'
            }}>
                <div style={{fontSize: '0.85rem'}}>
                    <span style={{marginRight: 8}}>🔒</span>
                    Local HTTPS CA:{' '}
                    <b style={{color: ca?.trusted ? 'var(--color-success)' : 'var(--color-warning)'}}>
                        {ca?.trusted ? 'trusted' : ca?.generated ? 'generated, not trusted' : 'not created'}
                    </b>
                    {!ca?.trusted &&
                        <span style={{color: 'var(--text-muted)'}}> — install it so browsers trust your site certificates.</span>}
                </div>
                <div style={{display: 'flex', gap: 8}}>
                    {ca?.generated && <button className="btn-action" title="Reveal CA file"
                                              onClick={() => window.api.tls.revealCa()}>📂</button>}
                    {!ca?.trusted &&
                        <button className="btn-primary" disabled={busy} onClick={installCa}>Install root CA</button>}
                </div>
            </div>

            <form onSubmit={add} style={{
                ...card,
                marginBottom: 20,
                display: 'grid',
                gridTemplateColumns: '0.9fr 1.3fr 1.6fr 1fr auto',
                gap: 12,
                alignItems: 'end'
            }}>
                {typeField(form, setForm)}
                <Field label="Domain">
                    <input required placeholder={form.type === 'proxy' ? 'api.test' : 'blog.test'} style={inp}
                           value={form.domain}
                           onChange={(e) => setForm({...form, domain: e.target.value})}/>
                </Field>
                {form.type === 'proxy' ? (
                    <>
                        {targetField(form, setForm)}
                        {portField(form, setForm)}
                    </>
                ) : (
                    <>
                        <Field label="Document root">
                            <div style={{display: 'flex', gap: 8}}>
                                <input required placeholder="~/Sites/blog" style={inp} value={form.root}
                                       onChange={(e) => setForm({...form, root: e.target.value})}/>
                                <button type="button" className="btn-action" title="Choose folder"
                                        onClick={() => pick(setForm, true)} style={{flexShrink: 0}}>📁
                                </button>
                            </div>
                        </Field>
                        <Field label="PHP version">
                            <select style={inp} value={form.php}
                                    onChange={(e) => setForm({...form, php: e.target.value})}>
                                <option value="">Static (no PHP)</option>
                                {phpVersions.map((v) => <option key={v} value={v}>PHP {v}</option>)}
                            </select>
                        </Field>
                    </>
                )}
                <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Adding…' : '+ Add'}</button>
            </form>

            {error && <div style={{
                color: 'var(--color-danger)',
                marginBottom: 16,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.82rem'
            }}>{error}</div>}

            {sites.length === 0 ? (
                <div style={{...card, textAlign: 'center', color: 'var(--text-muted)'}}>No sites yet. Add one
                    above.</div>
            ) : (
                <table className="project-table">
                    <thead>
                    <tr>
                        <th>Domain</th>
                        <th>Type</th>
                        <th>Target / Root</th>
                        <th>URL</th>
                        <th>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {sites.map((s) => (
                        <tr key={s.id}>
                            <td style={{fontWeight: 600}}>{s.domain}</td>
                            <td>
                  <span className="stack-badge">
                    {s.type === 'proxy' ? 'Proxy' : s.php ? `PHP ${s.php}` : 'Static'}
                  </span>
                            </td>
                            <td style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.8rem',
                                color: 'var(--text-secondary)'
                            }}>
                                {s.type === 'proxy' ? `${s.target}:${s.targetPort}` : s.root}
                            </td>
                            <td style={{whiteSpace: 'nowrap'}}>
                                <a className="domain-link" href={`https://${s.domain}:${httpsPort}`} target="_blank"
                                   rel="noreferrer">
                                    🔒 {s.domain}:{httpsPort}
                                </a>
                                <a className="domain-link" href={`http://${s.domain}:${port}`} target="_blank"
                                   rel="noreferrer"
                                   style={{marginLeft: 10, color: 'var(--text-muted)', fontSize: '0.8rem'}}>
                                    :{port}
                                </a>
                            </td>
                            <td style={{whiteSpace: 'nowrap'}}>
                                <button className="btn-action" title="Edit" onClick={() => openEdit(s)}>✏️</button>
                                <button className="btn-action stop" title="Remove" onClick={() => remove(s)}>🗑</button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            )}

            {editing && (
                <div className="modal-overlay" onClick={() => setEditing(null)}>
                    <div className="modal-box" style={{maxWidth: 560}} onClick={(e) => e.stopPropagation()}>
                        <header><span style={{fontWeight: 600}}>Edit site · {editing.domain}</span>
                            <button className="btn-action" onClick={() => setEditing(null)}>✕</button>
                        </header>
                        <div style={{padding: 20, display: 'flex', flexDirection: 'column', gap: 16}}>
                            {typeField(editForm, setEditForm)}
                            <Field label="Domain">
                                <input style={inp} value={editForm.domain}
                                       onChange={(e) => setEditForm({...editForm, domain: e.target.value})}/>
                            </Field>
                            {editForm.type === 'proxy' ? (
                                <>
                                    {targetField(editForm, setEditForm)}
                                    {portField(editForm, setEditForm)}
                                </>
                            ) : (
                                <>
                                    <Field label="Document root">
                                        <div style={{display: 'flex', gap: 8}}>
                                            <input style={inp} value={editForm.root}
                                                   onChange={(e) => setEditForm({...editForm, root: e.target.value})}/>
                                            <button type="button" className="btn-action" title="Choose folder"
                                                    onClick={() => pick(setEditForm, false)} style={{flexShrink: 0}}>📁
                                            </button>
                                        </div>
                                    </Field>
                                    <Field label="PHP version">
                                        <select style={inp} value={editForm.php}
                                                onChange={(e) => setEditForm({...editForm, php: e.target.value})}>
                                            <option value="">Static (no PHP)</option>
                                            {phpVersions.map((v) => <option key={v} value={v}>PHP {v}</option>)}
                                        </select>
                                    </Field>
                                </>
                            )}
                            {error && <div style={{
                                color: 'var(--color-danger)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.82rem'
                            }}>{error}</div>}
                            <div style={{display: 'flex', gap: 10, justifyContent: 'flex-end'}}>
                                <button className="btn-action" onClick={() => setEditing(null)}>Cancel</button>
                                <button className="btn-primary" disabled={busy}
                                        onClick={saveEdit}>{busy ? 'Saving…' : 'Save changes'}</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function deriveDomain(dir: string): string {
    const base = dir.split('/').filter(Boolean).pop() || 'site';
    return `${base.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.test`;
}

function Field({label, children}: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label style={{
                display: 'block',
                marginBottom: 6,
                fontSize: '0.8rem',
                color: 'var(--text-secondary)'
            }}>{label}</label>
            {children}
        </div>
    );
}
