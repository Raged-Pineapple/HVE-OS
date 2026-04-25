import React, { useState, useEffect, useRef } from 'react';
import { listSources, listSourcesWithStatus, deleteSource, uploadStaticFile, listSilverTables, runQuery, getBlueprints, setBlueprints, getDQRules, addDQRule } from '../api/client.js';
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
  const load = () => { setLoading(true); listSourcesWithStatus().then(setSources).catch(() => toast('Failed', 'error')).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);
  const doDelete = async (id) => { if (!confirm(`Delete source "${id}" and ALL its data?`)) return; try { await deleteSource(id); setSources(s => s.filter(x => x.source_id !== id)); if (sel === id) setSel(null); toast('Deleted', 'success'); } catch (e) { toast('Delete failed', 'error'); } };
  const statusDot = (ps) => {
    if (!ps) return <span title="No API config" style={{ width:8, height:8, borderRadius:'50%', background:'var(--text-muted)', display:'inline-block', opacity:0.4 }} />;
    if (ps.last_status === 'SUCCESS') return <span title={`OK — last polled ${ps.last_polled_at||'never'}`} style={{ width:8, height:8, borderRadius:'50%', background:'#34d399', display:'inline-block', boxShadow:'0 0 6px #34d39960' }} />;
    if (ps.last_status === 'ERROR') return <span title={ps.last_error||'Error'} style={{ width:8, height:8, borderRadius:'50%', background:'#f05050', display:'inline-block', boxShadow:'0 0 6px #f0505060' }} />;
    return <span title={`Status: ${ps.last_status||'pending'}`} style={{ width:8, height:8, borderRadius:'50%', background:'#fbbf24', display:'inline-block' }} />;
  };
  return (
    <div style={{ display: 'flex', gap: 0, height: '100%' }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', paddingRight: 16, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Sources</h3>
          <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', fontSize: '0.9rem' }}>↺</button>
        </div>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><span className="spinner" /></div>}
        {!loading && sources.length === 0 && <div className="empty-state" style={{ padding: 16, fontSize: '0.76rem' }}>No sources yet.</div>}
        {sources.map(s => (
          <div key={s.source_id} onClick={() => setSel(s.source_id)} className="card" style={{ padding: '10px 12px', cursor: 'pointer', marginBottom: 6, background: sel === s.source_id ? 'var(--cyan-dim)' : 'var(--glass-bg)', borderColor: sel === s.source_id ? 'var(--cyan)' : 'var(--border-default)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                {statusDot(s.poll_status)}
                <p style={{ fontWeight: 600, fontSize: '0.8rem' }}>{s.source_id}</p>
              </div>
              <button onClick={e => { e.stopPropagation(); doDelete(s.source_id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--rose)', fontSize: '0.8rem' }} title="Delete source">🗑</button>
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
              <button onClick={() => setSub('blueprints')} style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', borderRadius: 7, background: sub === 'blueprints' ? 'var(--cyan-dim)' : 'transparent', color: sub === 'blueprints' ? 'var(--cyan)' : 'var(--text-secondary)', fontWeight: sub === 'blueprints' ? 600 : 400, fontSize: '0.84rem' }}>📐 Blueprints</button>
              <button onClick={() => setSub('dq')} style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', borderRadius: 7, background: sub === 'dq' ? 'var(--cyan-dim)' : 'transparent', color: sub === 'dq' ? 'var(--cyan)' : 'var(--text-secondary)', fontWeight: sub === 'dq' ? 600 : 400, fontSize: '0.84rem' }}>🛡 DQ Rules</button>
            </div>
            {sub === 'blueprints' && <BlueprintEditor sourceId={sel} />}
            {sub === 'dq' && <DQPanel sourceId={sel} />}
          </>}
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
          {tables.map(t => { const n = typeof t === 'string' ? t : t.table_name; return <div key={n} onClick={() => setSql(`SELECT * FROM ${n} LIMIT 50`)} style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'JetBrains Mono', color: 'var(--cyan)', background: 'var(--cyan-dim)', marginBottom: 6 }}>{n}</div>; })}
        </div>
      </div>
    </div>
  );
}

export default function IngestionPage() {
  const [tab, setTab] = useState('ingest');
  const [mode, setMode] = useState('api');
  const tabs = [{ id: 'ingest', icon: '⬇', label: 'Ingest' }, { id: 'pipelines', icon: '⚙', label: 'Pipelines' }, { id: 'query', icon: '⬆', label: 'Query' }];
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
      </div>
    </div>
  );
}
