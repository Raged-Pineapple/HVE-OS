import React, { useState, useEffect, useRef, useMemo } from 'react';
import { listSources, listSourcesWithStatus, deleteSource, uploadStaticFile, listSilverTables, runQuery, getBlueprints, setBlueprints, getDQRules, addDQRule, getApiConfig, registerApiSource, previewApi, saveGraphBlueprint, syncGraph } from '../api/client.js';
import { useToast } from '../components/ToastProvider.jsx';
import ApiWizard from '../components/ApiWizard.jsx';

function FileUpload() {
  const toast = useToast();
  const [sourceId, setSourceId] = useState('');
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const ref = useRef(null);
  const upload = async () => {
    if (!file || !sourceId.trim()) { toast('Source ID and file required', 'error'); return; }
    setProgress(0);
    try { const r = await uploadStaticFile(sourceId, file, setProgress); setResult(r); toast(`${r.records_passed} rows in Silver`, 'success'); }
    catch (e) { toast(e?.response?.data?.detail || 'Failed', 'error'); }
    finally { setProgress(null); }
  };
  return (
    <div className="card" style={{ padding: 28, maxWidth: 520 }}>
      <h2 style={{ marginBottom: 4 }}>Upload Static File</h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 20 }}>CSV, JSON, Parquet, Excel, GeoJSON → Silver</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field"><label>Source ID *</label><input value={sourceId} onChange={e => setSourceId(e.target.value.replace(/\s/g, '_').toLowerCase())} placeholder="bangalore_military" /></div>
        <div onClick={() => ref.current.click()} style={{ border: '2px dashed var(--border-default)', borderRadius: 10, padding: '24px 20px', textAlign: 'center', cursor: 'pointer', background: file ? 'var(--cyan-dim)' : 'transparent', borderColor: file ? 'var(--cyan)' : 'var(--border-default)' }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); setFile(e.dataTransfer.files[0]); }}>
          <input ref={ref} type="file" style={{ display: 'none' }} accept=".csv,.json,.parquet,.xlsx,.geojson" onChange={e => setFile(e.target.files[0])} />
          {file ? <><p style={{ color: 'var(--cyan)', fontWeight: 600 }}>{file.name}</p><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{(file.size / 1048576).toFixed(2)} MB</p></> : <p style={{ color: 'var(--text-secondary)' }}>Drop file or click to browse</p>}
        </div>
        {progress !== null && <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, height: 6 }}><div style={{ height: '100%', width: `${progress}%`, background: 'var(--cyan)' }} /></div>}
        {result && <div style={{ background: 'var(--emerald-dim)', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem', color: 'var(--emerald)' }}>✓ {result.records_passed} clean | {result.records_failed} quarantined</div>}
        <button className="btn btn-primary" onClick={upload} disabled={!file || !sourceId || progress !== null} style={{ width: '100%', justifyContent: 'center' }}>{progress !== null ? 'Processing…' : '↑ Upload & Process'}</button>
      </div>
    </div>
  );
}

function BlueprintEditor({ sourceId }) {
  const toast = useToast();
  const [bps, setBPs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const blank = () => ({ target_field: '', jmes_path: '', data_type: 'STRING', is_primary_key: false, is_required: false });
  useEffect(() => { if (!sourceId) return; setLoading(true); getBlueprints(sourceId).then(r => setBPs(r.length ? r : [blank()])).finally(() => setLoading(false)); }, [sourceId]);
  const upd = (i, k, v) => setBPs(a => a.map((b, j) => j === i ? { ...b, [k]: v } : b));
  const save = async () => { setSaving(true); try { await setBlueprints(sourceId, bps.map(({ blueprint_id, source_id, created_at, ...r }) => r)); toast('Saved!', 'success'); } catch (e) { toast('Failed', 'error'); } finally { setSaving(false); } };
  if (!sourceId) return null;
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div><h2>Blueprints</h2><p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>For <strong>{sourceId}</strong></p></div>
        <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-ghost" onClick={() => setBPs(a => [...a, blank()])}>+ Field</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <span className="spinner" /> : '💾 Save'}</button></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 90px 50px 50px 28px', gap: 6, fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', padding: '0 4px' }}><span>Field</span><span>Path</span><span>Type</span><span>PK</span><span>Req</span><span /></div>
        {bps.map((bp, i) => (
          <div key={i} className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 90px 50px 50px 28px', gap: 6, padding: '8px 10px', alignItems: 'center', background: 'var(--bg-elevated)' }}>
            <input value={bp.target_field} onChange={e => upd(i, 'target_field', e.target.value)} placeholder="latitude" />
            <input value={bp.jmes_path} onChange={e => upd(i, 'jmes_path', e.target.value)} placeholder="center.lat" style={{ fontFamily: 'JetBrains Mono', fontSize: '0.76rem' }} />
            <select value={bp.data_type} onChange={e => upd(i, 'data_type', e.target.value)}>{['STRING', 'INT', 'FLOAT', 'BOOLEAN', 'BIGINT', 'TIMESTAMP'].map(t => <option key={t}>{t}</option>)}</select>
            <div style={{ display: 'flex', justifyContent: 'center' }}><input type="checkbox" checked={bp.is_primary_key} onChange={e => upd(i, 'is_primary_key', e.target.checked)} /></div>
            <div style={{ display: 'flex', justifyContent: 'center' }}><input type="checkbox" checked={bp.is_required} onChange={e => upd(i, 'is_required', e.target.checked)} /></div>
            <button onClick={() => setBPs(a => a.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApiConfigPanel({ sourceId }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sourceId) return;
    setLoading(true);
    getApiConfig(sourceId)
      .then(cfg => {
        setForm({
          source_id: cfg.source_id,
          api_url: cfg.api_url,
          method: cfg.method,
          headers: typeof cfg.headers === 'string' ? cfg.headers : JSON.stringify(cfg.headers || {}, null, 2),
          body_template: typeof cfg.body_template === 'string' ? cfg.body_template : JSON.stringify(cfg.body_template || {}, null, 2),
          poll_interval_seconds: cfg.poll_interval_seconds
        });
      })
      .catch(() => toast('Failed to load API config', 'error'))
      .finally(() => setLoading(false));
  }, [sourceId]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const fetchPreview = async () => {
    if (!form) return;
    setLoading(true); setPreviewErr(null); setPreview(null);
    try {
      let hdrs = {}; try { hdrs = JSON.parse(form.headers); } catch { setPreviewErr('Invalid headers JSON'); setLoading(false); return; }
      let body = null; try { body = form.body_template ? JSON.parse(form.body_template) : null; } catch { setPreviewErr('Invalid body JSON'); setLoading(false); return; }
      const r = await previewApi({ source_id: form.source_id, api_url: form.api_url, method: form.method, headers: hdrs, body_template: body, poll_interval_seconds: form.poll_interval_seconds });
      setPreview(r);
      toast(`${r.total_records} records fetched`, 'success');
    } catch (e) { setPreviewErr(e?.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      let hdrs = {}; try { hdrs = JSON.parse(form.headers); } catch { toast('Invalid headers JSON', 'error'); setSaving(false); return; }
      let body = null; try { body = form.body_template ? JSON.parse(form.body_template) : null; } catch { toast('Invalid body JSON', 'error'); setSaving(false); return; }
      await registerApiSource({ ...form, headers: hdrs, body_template: body });
      toast('API Config Updated!', 'success');
    } catch (e) { toast(e?.response?.data?.detail || 'Update failed', 'error'); }
    finally { setSaving(false); }
  };

  if (!sourceId || !form) return null;
  if (loading && !form) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>;

  const METHOD_COLORS = { GET: '#73dc8c', POST: '#f0a44b', PUT: '#4ba3f0', DELETE: '#f05050' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2>API Configuration</h2>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <span className="spinner" /> : '💾 Update & Poll'}</button>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 4, alignItems: 'center' }}>
            <select value={form.method} onChange={e => set('method', e.target.value)} style={{ width: 90, border: 'none', background: 'transparent', color: METHOD_COLORS[form.method] || 'var(--cyan)', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}>
              <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
            </select>
            <input value={form.api_url} onChange={e => set('api_url', e.target.value)} style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '0.82rem', padding: '6px 10px', outline: 'none', fontFamily: 'JetBrains Mono' }} />
            <button className="btn btn-ghost" onClick={fetchPreview} style={{ padding: '4px 12px', fontSize: '0.75rem' }}>Probe</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>Headers (JSON)</label><textarea value={form.headers} onChange={e => set('headers', e.target.value)} style={{ fontFamily: 'JetBrains Mono', fontSize: '0.75rem', minHeight: 80 }} /></div>
            <div className="field"><label>Body Template (JSON)</label><textarea value={form.body_template} onChange={e => set('body_template', e.target.value)} style={{ fontFamily: 'JetBrains Mono', fontSize: '0.75rem', minHeight: 80 }} /></div>
          </div>
          <div className="field"><label>Poll Interval (seconds)</label><input type="number" value={form.poll_interval_seconds} onChange={e => set('poll_interval_seconds', parseInt(e.target.value))} /></div>
        </div>
      </div>

      {preview && (
        <div className="card" style={{ padding: 20, background: 'hsla(222,28%,7%,0.5)' }}>
          <h3 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 10 }}>Preview (5 records)</h3>
          <pre style={{ margin: 0, fontFamily: 'JetBrains Mono', fontSize: '0.72rem', color: 'var(--text-secondary)', overflow: 'auto', maxHeight: 200 }}>{JSON.stringify(preview.preview, null, 2)}</pre>
        </div>
      )}
      {previewErr && <div style={{ color: 'var(--rose)', fontFamily: 'JetBrains Mono', fontSize: '0.78rem', padding: 10, background: 'var(--rose-dim)', borderRadius: 8 }}>{previewErr}</div>}
    </div>
  );
}

function DQPanel({ sourceId }) {
  const toast = useToast();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ rule_name: '', rule_logic: '', action_on_fail: 'QUARANTINE', severity: 'ERROR' });
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (!sourceId) return; setLoading(true); getDQRules(sourceId).then(setRules).finally(() => setLoading(false)); }, [sourceId]);
  const add = async () => { if (!form.rule_name || !form.rule_logic) { toast('Required', 'error'); return; } setAdding(true); try { const r = await addDQRule(sourceId, form); setRules(a => [...a, r]); setForm({ rule_name: '', rule_logic: '', action_on_fail: 'QUARANTINE', severity: 'ERROR' }); toast('Added!', 'success'); } catch (e) { toast('Failed', 'error'); } finally { setAdding(false); } };
  if (!sourceId) return null;
  return (
    <div>
      <h2 style={{ marginBottom: 14 }}>DQ Rules for <strong>{sourceId}</strong></h2>
      {rules.map(r => (<div key={r.rule_id} className="card" style={{ padding: '10px 12px', background: 'var(--bg-elevated)', marginBottom: 6 }}><strong>{r.rule_name}</strong> — <code style={{ color: 'var(--cyan)', fontFamily: 'JetBrains Mono', fontSize: '0.78rem' }}>{r.rule_logic}</code><span className="badge badge-amber" style={{ marginLeft: 8 }}>{r.action_on_fail}</span></div>))}
      <div className="card" style={{ padding: 14, background: 'var(--bg-elevated)', marginTop: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="field"><label>Name</label><input value={form.rule_name} onChange={e => setForm(f => ({ ...f, rule_name: e.target.value }))} placeholder="Valid coordinates" /></div>
          <div className="field"><label>Logic</label><input value={form.rule_logic} onChange={e => setForm(f => ({ ...f, rule_logic: e.target.value }))} placeholder="latitude > 0" style={{ fontFamily: 'JetBrains Mono' }} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="field"><label>Action</label><select value={form.action_on_fail} onChange={e => setForm(f => ({ ...f, action_on_fail: e.target.value }))}><option>QUARANTINE</option><option>DROP</option><option>FLAG</option></select></div>
            <div className="field"><label>Severity</label><select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}><option>ERROR</option><option>WARNING</option><option>INFO</option></select></div>
          </div>
          <button className="btn btn-primary" onClick={add} disabled={adding} style={{ alignSelf: 'flex-end' }}>{adding ? <span className="spinner" /> : '+ Add'}</button>
        </div>
      </div>
    </div>
  );
}

function PipelinesTab() {
  const toast = useToast();
  const [sources, setSources] = useState([]);
  const [sel, setSel] = useState(null);
  const [sub, setSub] = useState('blueprints');
  const [loading, setLoading] = useState(true);
  const [deletingIds, setDeletingIds] = useState(new Set());
  const load = () => { setLoading(true); listSourcesWithStatus().then(setSources).catch(() => toast('Failed', 'error')).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);
  const doDelete = async (id) => { 
    if (!confirm(`Delete source "${id}" and ALL its data?`)) return; 
    setDeletingIds(prev => new Set(prev).add(id));
    try { 
      await deleteSource(id); 
      setSources(s => s.filter(x => x.source_id !== id)); 
      if (sel === id) setSel(null); 
      toast('Deleted source and all associated data', 'success'); 
    } catch (e) { 
      toast('Delete failed: ' + (e?.response?.data?.detail || e.message), 'error'); 
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };
  const statusDot = (ps) => {
    if (!ps) return <span title="No API config" style={{ width:8, height:8, borderRadius:'50%', background:'var(--text-muted)', display:'inline-block', opacity:0.4 }} />;
    if (ps.last_status === 'SUCCESS') return <span title={`OK — last polled ${ps.last_polled_at||'never'}`} style={{ width:8, height:8, borderRadius:'50%', background:'#34d399', display:'inline-block', boxShadow:'0 0 6px #34d39960' }} />;
    if (ps.last_status === 'ERROR') return <span title={ps.last_error||'Error'} style={{ width:8, height:8, borderRadius:'50%', background:'#f05050', display:'inline-block', boxShadow:'0 0 6px #f0505060' }} />;
    return <span title={`Status: ${ps.last_status||'pending'}`} style={{ width:8, height:8, borderRadius:'50%', background:'#fbbf24', display:'inline-block' }} />;
  };
  const currentSource = sources.find(s => s.source_id === sel);
  const isApiSource = currentSource?.source_type === 'API_POLL';

  useEffect(() => {
    if (isApiSource) setSub('api');
    else if (sub === 'api') setSub('blueprints');
  }, [sel, isApiSource]);

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%' }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', paddingRight: 16, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Sources</h3>
          <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', fontSize: '0.9rem' }}>↺</button>
        </div>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><span className="spinner" /></div>}
        {!loading && sources.length === 0 && <div className="empty-state" style={{ padding: 16, fontSize: '0.76rem' }}>No sources yet.</div>}
        {sources
          .filter(s => s.source_type !== 'MANUAL_SNAPSHOT')
          .map(s => (
          <div key={s.source_id} onClick={() => setSel(s.source_id)} className="card" style={{ padding: '10px 12px', cursor: 'pointer', marginBottom: 6, background: sel === s.source_id ? 'var(--cyan-dim)' : 'var(--glass-bg)', borderColor: sel === s.source_id ? 'var(--cyan)' : 'var(--border-default)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                {statusDot(s.poll_status)}
                <p style={{ fontWeight: 600, fontSize: '0.8rem' }}>{s.source_id}</p>
              </div>
              {deletingIds.has(s.source_id) ? (
                <span className="spinner" style={{ width: 14, height: 14, borderLeftColor: 'var(--rose)' }} />
              ) : (
                <button onClick={e => { e.stopPropagation(); doDelete(s.source_id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rose)', fontSize: '0.8rem' }} title="Delete source">🗑</button>
              )}
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:3, fontSize:'0.66rem', color:'var(--text-muted)' }}>
              <span>{s.source_type}</span>
              {s.poll_status?.is_polling && <span style={{ color:'var(--emerald)', fontWeight:600 }}>● polling</span>}
              {s.poll_status && !s.poll_status.is_polling && <span style={{ color:'var(--text-muted)' }}>○ idle</span>}
            </div>
            {s.poll_status?.last_status === 'ERROR' && <div style={{ marginTop:4, fontSize:'0.62rem', color:'#f05050', background:'hsla(0,85%,63%,0.08)', borderRadius:4, padding:'2px 6px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={s.poll_status.last_error}>{s.poll_status.last_error}</div>}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, paddingLeft: 24, overflowY: 'auto' }}>
        {!sel ? <div className="empty-state" style={{ marginTop: 60 }}><h2>Select a Source</h2><p style={{ fontSize: '0.82rem' }}>Choose from the left to configure pipeline rules.</p></div>
          : <>
            <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-elevated)', padding: 4, borderRadius: 8, width: 'fit-content' }}>
              {isApiSource && <button onClick={() => setSub('api')} style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', borderRadius: 7, background: sub === 'api' ? 'var(--cyan-dim)' : 'transparent', color: sub === 'api' ? 'var(--cyan)' : 'var(--text-secondary)', fontWeight: sub === 'api' ? 600 : 400, fontSize: '0.84rem' }}>🔌 API Config</button>}
              <button onClick={() => setSub('blueprints')} style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', borderRadius: 7, background: sub === 'blueprints' ? 'var(--cyan-dim)' : 'transparent', color: sub === 'blueprints' ? 'var(--cyan)' : 'var(--text-secondary)', fontWeight: sub === 'blueprints' ? 600 : 400, fontSize: '0.84rem' }}>📐 Blueprints</button>
              <button onClick={() => setSub('dq')} style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', borderRadius: 7, background: sub === 'dq' ? 'var(--cyan-dim)' : 'transparent', color: sub === 'dq' ? 'var(--cyan)' : 'var(--text-secondary)', fontWeight: sub === 'dq' ? 600 : 400, fontSize: '0.84rem' }}>🛡 DQ Rules</button>
            </div>
            {sub === 'api' && isApiSource && <ApiConfigPanel sourceId={sel} />}
            {sub === 'blueprints' && <BlueprintEditor sourceId={sel} />}
            {sub === 'dq' && <DQPanel sourceId={sel} />}
          </>}
      </div>
    </div>
  );
}

function EntityMappingPanel({ sourceId, columns, onClose }) {
  const toast = useToast();
  const [nodeLabel, setNodeLabel] = useState('Entity');
  const [primaryKey, setPrimaryKey] = useState('');
  const [mappings, setMappings] = useState([]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (columns && columns.length > 0) {
      setMappings(columns.map(c => ({ column: c, property: c, type: 'string', transform: 'none' })));
      if (!primaryKey || !columns.includes(primaryKey)) {
        setPrimaryKey(columns[0]);
      }
    }
  }, [columns]);

  const cypher = useMemo(() => {
    if (!nodeLabel || !primaryKey) return '// Awaiting node label and primary key...';
    const pkMap = mappings.find(m => m.column === primaryKey);
    if (!pkMap) return '// Primary key not found in columns...';

    let c = `MERGE (s:Source {source_id: '${sourceId}'})\n`;
    c += `WITH s\n`;
    c += `UNWIND $rows AS row\n`;
    c += `WITH s, row WHERE row.${pkMap.column} IS NOT NULL\n`;
    c += `MERGE (n:Entity:${nodeLabel} {${pkMap.property}: row.${pkMap.column}})\n`;

    const setProps = mappings.filter(m => m.column !== primaryKey).map(m => {
      let val = `row.${m.column}`;
      if (m.type === 'float') val = `toFloat(${val})`;
      else if (m.type === 'int') val = `toInteger(${val})`;
      if (m.transform === 'uppercase') val = `toUpper(${val})`;
      else if (m.transform === 'lowercase') val = `toLower(${val})`;
      return `${m.property}: ${val}`;
    });

    if (setProps.length > 0) {
      c += `SET n += {\n  ${setProps.join(',\n  ')}\n}\n`;
    }

    c += `MERGE (n)-[:PART_OF_SOURCE]->(s)`;
    return c;
  }, [nodeLabel, primaryKey, mappings]);

  const saveMapping = async () => {
    if (!sourceId) { toast('No source selected', 'error'); return; }
    setSaving(true);
    try {
      await saveGraphBlueprint(sourceId, { cypher_template: cypher });
      toast('Graph Blueprint Saved!', 'success');
    } catch (e) {
      toast(`Save failed: ${e?.response?.data?.detail || e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const triggerSync = async () => {
    if (!sourceId) { toast('No source selected', 'error'); return; }
    setSyncing(true);
    try {
      await syncGraph(sourceId);
      toast('Graph Sync Started! Check Neo4j in a few seconds.', 'success');
    } catch (e) {
      toast(`Sync failed: ${e?.response?.data?.detail || e.message}`, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const updateMap = (idx, key, val) => {
    const newMap = [...mappings];
    newMap[idx][key] = val;
    setMappings(newMap);
  };

  return (
    <div className="card" style={{ width: '100%', flexShrink: 0, padding: 20, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 2 }}>Entity Mapping</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{sourceId || 'No source inferred'}</p>
        </div>
        {onClose && <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>}
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label>Node Label</label>
        <input value={nodeLabel} onChange={e => setNodeLabel(e.target.value)} placeholder="e.g. Flight" />
      </div>

      <div className="field" style={{ marginBottom: 16 }}>
        <label>Primary Key (Merge Key)</label>
        <select value={primaryKey} onChange={e => setPrimaryKey(e.target.value)}>
          {columns.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16, border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 8, background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 70px 70px', gap: 8, fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, padding: '0 4px' }}>
          <span>Column</span><span>Property</span><span>Type</span><span>Transform</span>
        </div>
        {mappings.map((m, i) => (
          <div key={m.column} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 70px 70px', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.column}>{m.column}</span>
            <input value={m.property} onChange={e => updateMap(i, 'property', e.target.value)} style={{ padding: '4px 6px', fontSize: '0.75rem', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 4, outline: 'none' }} />
            <select value={m.type} onChange={e => updateMap(i, 'type', e.target.value)} style={{ padding: '4px', fontSize: '0.7rem', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 4, outline: 'none' }}>
              <option value="string">Str</option><option value="int">Int</option><option value="float">Float</option>
            </select>
            <select value={m.transform} onChange={e => updateMap(i, 'transform', e.target.value)} style={{ padding: '4px', fontSize: '0.7rem', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 4, outline: 'none' }}>
              <option value="none">None</option><option value="uppercase">Upper</option><option value="lowercase">Lower</option>
            </select>
          </div>
        ))}
        {mappings.length === 0 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Run a query to map columns</div>}
      </div>

      <div style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid var(--border-subtle)' }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Generated Cypher</span>
        <pre style={{ margin: 0, fontFamily: 'JetBrains Mono', fontSize: '0.7rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
          {cypher}
        </pre>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--emerald)', textTransform: 'uppercase' }}>To view nodes & relations in Neo4j, run:</span>
          <code style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, fontFamily: 'JetBrains Mono' }}>MATCH path=(s:Source)-[:PART_OF_SOURCE]-(n:{nodeLabel}) RETURN path LIMIT 50</code>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={saveMapping} disabled={saving || !sourceId} style={{ flex: 1, justifyContent: 'center' }}>
          {saving ? <span className="spinner" /> : '💾 Save Mapping'}
        </button>
        <button className="btn btn-ghost" onClick={triggerSync} disabled={syncing || !sourceId} style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--cyan)', color: 'var(--cyan)' }}>
          {syncing ? <span className="spinner" /> : '⚡ Sync Now'}
        </button>
      </div>
    </div>
  );
}

function QueryTab() {
  const toast = useToast();
  const [tables, setTables] = useState([]);
  const [sql, setSql] = useState('SELECT * FROM bangalore_military LIMIT 25');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [time, setTime] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [activeTable, setActiveTable] = useState(null);
  const loadT = async () => { try { setTables(await listSilverTables()); } catch {} };
  useEffect(() => { loadT(); }, []);
  const exec = async () => {
    if (!sql.trim()) return; setLoading(true); setError(null); setResult(null); setSortCol(null);
    const t0 = performance.now();
    try { const r = await runQuery(sql.trim()); setResult(Array.isArray(r) ? r : (r.rows || r.data || [])); setTime(((performance.now() - t0) / 1000).toFixed(2)); }
    catch (e) { setError(e?.response?.data?.detail || 'Failed'); toast('Query failed', 'error'); }
    finally { setLoading(false); }
  };
  const toggleSort = (col) => {
    if (sortCol === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setSortCol(col); setSortDir('asc'); }
  };
  const sorted = result && sortCol ? [...result].sort((a, b) => {
    const va = a[sortCol], vb = b[sortCol];
    if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return sortDir === 'asc' ? cmp : -cmp;
  }) : result;
  const exportCSV = () => {
    if (!result?.length) return;
    const cols = Object.keys(result[0]);
    const csv = [cols.join(','), ...result.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'query_results.csv'; a.click();
    toast('CSV exported!', 'success');
  };
  const colStats = (col) => {
    if (!result?.length) return '';
    const vals = result.map(r => r[col]).filter(v => v != null);
    const nums = vals.filter(v => typeof v === 'number');
    if (nums.length > 0) return `min:${Math.min(...nums)} max:${Math.max(...nums)}`;
    const uniq = new Set(vals).size;
    return `${uniq} unique`;
  };
  return (
    <div style={{ display: 'flex', gap: 20, height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 2, minWidth: 320 }}>
        <div className="card" style={{ padding: 20, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2>SQL Query</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {time && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{time}s</span>}
              {result?.length > 0 && <button className="btn btn-ghost" onClick={exportCSV} style={{ fontSize:'0.75rem', padding:'4px 10px' }}>📥 CSV</button>}
              <button className="btn btn-primary" onClick={exec} disabled={loading}>{loading ? <span className="spinner" /> : '▶ Run'}</button>
            </div>
          </div>
          <textarea value={sql} onChange={e => setSql(e.target.value)} style={{ minHeight: 96, borderRadius: 8 }} onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') exec(); }} />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>Ctrl+Enter to run</p>
        </div>
        <div className="card" style={{ padding: 20, flex: 1, overflow: 'auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 12 }}>
            <h2>Results {result && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 400 }}>({result.length} rows{sortCol ? `, sorted by ${sortCol} ${sortDir}` : ''})</span>}</h2>
          </div>
          {error && <div style={{ background: 'var(--rose-dim)', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem', color: 'var(--rose)', fontFamily: 'JetBrains Mono' }}>{error}</div>}
          {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>}
          {!loading && !error && sorted && sorted.length > 0 && <div style={{ overflow: 'auto', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead><tr style={{ background: 'var(--bg-elevated)' }}>{Object.keys(sorted[0]).map(c => (
                <th key={c} onClick={() => toggleSort(c)} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: sortCol === c ? 'var(--cyan)' : 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', borderBottom: '1px solid var(--border-default)', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
                  {c} {sortCol === c ? (sortDir === 'asc' ? '▲' : '▼') : <span style={{ opacity:0.3 }}>⇅</span>}
                  <div style={{ fontSize:'0.58rem', fontWeight:400, color:'var(--text-muted)', textTransform:'none', marginTop:2 }}>{colStats(c)}</div>
                </th>
              ))}</tr></thead>
              <tbody>{sorted.map((row, i) => <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)', background: i % 2 ? 'hsla(222,28%,9%,0.4)' : 'transparent' }}>{Object.keys(sorted[0]).map(c => <td key={c} style={{ padding: '9px 14px', color: 'var(--text-secondary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row[c] === null ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>null</span> : String(row[c])}</td>)}</tr>)}</tbody>
            </table>
          </div>}
          {!loading && !error && !result && <div className="empty-state"><p>Run a query to see results</p></div>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 220, flexShrink: 0 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}><h3>Silver Tables</h3><button onClick={loadT} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', fontSize: '0.9rem' }}>↺</button></div>
          {tables.length === 0 && <div className="empty-state" style={{ padding: 16, fontSize: '0.76rem' }}>No tables yet</div>}
          {tables.map(t => { const n = typeof t === 'string' ? t : t.table_name; return <div key={n} onClick={() => { setSql(`SELECT * FROM ${n} LIMIT 50`); setActiveTable(t); }} style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'JetBrains Mono', color: 'var(--cyan)', background: 'var(--cyan-dim)', marginBottom: 6 }}>{n}</div>; })}
        </div>
      </div>
    </div>
  );
}

function EntityMappingTab() {
  const toast = useToast();
  const [tables, setTables] = useState([]);
  const [activeTable, setActiveTable] = useState(null);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadT = async () => { try { setTables(await listSilverTables()); } catch {} };
  useEffect(() => { loadT(); }, []);

  const selectTable = async (t) => {
    setActiveTable(t);
    setLoading(true);
    try {
      const tableName = typeof t === 'string' ? t : t.table_name;
      const r = await runQuery(`SELECT * FROM ${tableName} LIMIT 1`);
      const res = Array.isArray(r) ? r : (r.rows || r.data || []);
      if (res && res.length > 0) {
        setColumns(Object.keys(res[0]));
      } else {
        toast(`Table ${tableName} is empty, unable to infer schema`, 'error');
        setColumns([]);
      }
    } catch (e) {
      toast('Failed to fetch table schema', 'error');
      setColumns([]);
    } finally {
      setLoading(false);
    }
  };

  const sourceId = typeof activeTable === 'object' && activeTable ? activeTable.source_id || activeTable.table_name : activeTable;

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 220, flexShrink: 0 }}>
        <div className="card" style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}><h3>Silver Tables</h3><button onClick={loadT} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', fontSize: '0.9rem' }}>↺</button></div>
          {tables.length === 0 && <div className="empty-state" style={{ padding: 16, fontSize: '0.76rem' }}>No tables yet</div>}
          {tables.map(t => { const n = typeof t === 'string' ? t : t.table_name; const isActive = (typeof activeTable === 'string' ? activeTable : activeTable?.table_name) === n; return <div key={n} onClick={() => selectTable(t)} style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'JetBrains Mono', color: isActive ? '#000' : 'var(--cyan)', background: isActive ? 'var(--cyan)' : 'var(--cyan-dim)', marginBottom: 6 }}>{n}</div>; })}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
        {!activeTable ? <div className="empty-state" style={{ marginTop: 60, width: '100%' }}><h2>Select a Table</h2><p style={{ fontSize: '0.82rem' }}>Choose a silver table from the left to configure entity mapping.</p></div> : loading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40, width: '100%' }}><span className="spinner" /></div> : <div style={{ maxWidth: 650, width: '100%', height: '100%' }}><EntityMappingPanel sourceId={sourceId} columns={columns} /></div>}
      </div>
    </div>
  );
}

export default function IngestionPage() {
  const [tab, setTab] = useState('ingest');
  const [mode, setMode] = useState('api');
  const tabs = [{ id: 'ingest', icon: '⬇', label: 'Ingest' }, { id: 'pipelines', icon: '⚙', label: 'Pipelines' }, { id: 'query', icon: '⬆', label: 'Query' }, { id: 'entity-map', icon: '⎘', label: 'Entity Map' }];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '20px 32px 0', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <h1 style={{ marginBottom: 2 }}>HVE-OS Data Platform</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 16 }}>Preview → Blueprint → DQ → Launch → Query</p>
        <div style={{ display: 'flex' }}>{tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '10px 22px', border: 'none', cursor: 'pointer', background: 'transparent', color: tab === t.id ? 'var(--cyan)' : 'var(--text-muted)', borderBottom: tab === t.id ? '2px solid var(--cyan)' : '2px solid transparent', fontWeight: tab === t.id ? 600 : 400, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 7 }}>{t.icon} {t.label}</button>)}</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '28px 32px' }}>
        <div style={{ display: tab === 'ingest' ? 'block' : 'none' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--bg-elevated)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
            <button onClick={() => setMode('api')} style={{ padding: '8px 20px', border: 'none', cursor: 'pointer', borderRadius: 8, background: mode === 'api' ? 'var(--cyan-dim)' : 'transparent', color: mode === 'api' ? 'var(--cyan)' : 'var(--text-secondary)', fontWeight: mode === 'api' ? 600 : 400, fontSize: '0.875rem' }}>🔌 Register API</button>
            <button onClick={() => setMode('file')} style={{ padding: '8px 20px', border: 'none', cursor: 'pointer', borderRadius: 8, background: mode === 'file' ? 'var(--cyan-dim)' : 'transparent', color: mode === 'file' ? 'var(--cyan)' : 'var(--text-secondary)', fontWeight: mode === 'file' ? 600 : 400, fontSize: '0.875rem' }}>📁 Upload File</button>
          </div>
          <div style={{ display: mode === 'api' ? 'block' : 'none' }}><ApiWizard /></div>
          <div style={{ display: mode === 'file' ? 'block' : 'none' }}><FileUpload /></div>
        </div>
        <div style={{ display: tab === 'pipelines' ? 'block' : 'none', height: '100%' }}><PipelinesTab /></div>
        <div style={{ display: tab === 'query' ? 'block' : 'none', height: '100%' }}><QueryTab /></div>
        <div style={{ display: tab === 'entity-map' ? 'block' : 'none', height: '100%' }}><EntityMappingTab /></div>
      </div>
    </div>
  );
}
