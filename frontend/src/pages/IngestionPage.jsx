import React, { useState, useEffect, useRef } from 'react';
import {
  registerApiSource, uploadStaticFile,
  listSources, getBlueprints, setBlueprints, getDQRules, addDQRule,
  listSilverTables, runQuery,
} from '../api/client.js';
import { useToast } from '../components/ToastProvider.jsx';

// ── Step Indicator ──────────────────────────────────────────
const Steps = ({ current, steps }) => (
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
    {steps.map((s, i) => (
      <React.Fragment key={i}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '0.78rem', fontWeight: 700,
            background: i < current ? 'var(--cyan)' : i === current ? 'var(--cyan-dim)' : 'var(--bg-elevated)',
            color: i < current ? 'hsl(222,28%,6%)' : i === current ? 'var(--cyan)' : 'var(--text-muted)',
            border: i === current ? '2px solid var(--cyan)' : '2px solid transparent',
          }}>{i < current ? '✓' : i + 1}</div>
          <span style={{ fontSize: '0.7rem', color: i === current ? 'var(--cyan)' : 'var(--text-muted)', fontWeight: i === current ? 600 : 400, whiteSpace: 'nowrap' }}>{s}</span>
        </div>
        {i < steps.length - 1 && <div style={{ flex: 1, height: 2, background: i < current ? 'var(--cyan)' : 'var(--border-subtle)', margin: '-18px 8px 0', minWidth: 20 }} />}
      </React.Fragment>
    ))}
  </div>
);

// ════════════════════════════════════════════════════════
// TAB 1 — INGEST
// ════════════════════════════════════════════════════════
function APIWizard() {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({
    source_id: '', api_url: '', method: 'GET', headers: '{}',
    body_template: '{}', extraction_path: '', poll_interval_seconds: 300, description: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const wizardSteps = ['Name & Source', 'API Config', 'Polling & Auth', 'Review & Launch'];
  const canNext = () => step === 0 ? form.source_id.trim().length > 0 : step === 1 ? form.api_url.trim().length > 0 : true;

  const launch = async () => {
    setLoading(true);
    try {
      let headers = {}, body = null;
      try { headers = JSON.parse(form.headers || '{}'); } catch {}
      try { body = form.body_template ? JSON.parse(form.body_template) : null; } catch {}
      const res = await registerApiSource({
        source_id: form.source_id, api_url: form.api_url, method: form.method,
        headers, body_template: body, extraction_path: form.extraction_path || null,
        poll_interval_seconds: parseInt(form.poll_interval_seconds), description: form.description || null,
      });
      setResult(res); setStep(4); toast('API source registered!', 'success');
    } catch (e) { toast(e?.response?.data?.detail || 'Registration failed', 'error'); }
    finally { setLoading(false); }
  };

  const reset = () => { setStep(0); setResult(null); setForm({ source_id: '', api_url: '', method: 'GET', headers: '{}', body_template: '{}', extraction_path: '', poll_interval_seconds: 300, description: '' }); };

  return (
    <div className="card" style={{ padding: 28, maxWidth: 620 }}>
      <h2 style={{ marginBottom: 4 }}>Register External API</h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 20 }}>Connect any REST API for automated polling into the Lakehouse.</p>
      {step < 4 && <Steps current={step} steps={wizardSteps} />}

      {step === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field"><label>Source ID <span style={{ color: 'var(--rose)' }}>*</span></label>
            <input value={form.source_id} onChange={e => set('source_id', e.target.value.replace(/\s/g, '_').toLowerCase())} placeholder="e.g. bangalore_military" autoFocus />
            <p className="field-hint">Unique pipeline ID. Becomes the Iceberg table name. Use snake_case.</p></div>
          <div className="field"><label>Description</label><input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional" /></div>
        </div>
      )}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field"><label>API URL <span style={{ color: 'var(--rose)' }}>*</span></label><input value={form.api_url} onChange={e => set('api_url', e.target.value)} placeholder="https://overpass-api.de/api/interpreter?..." autoFocus /></div>
          <div className="field"><label>Method</label><select value={form.method} onChange={e => set('method', e.target.value)}><option>GET</option><option>POST</option></select></div>
          {form.method === 'POST' && <div className="field"><label>Request Body (JSON)</label><textarea value={form.body_template} onChange={e => set('body_template', e.target.value)} rows={4} /></div>}
          <div className="field"><label>Extraction Path (JSONPath)</label><input value={form.extraction_path} onChange={e => set('extraction_path', e.target.value)} placeholder="$.elements" />
            <p className="field-hint">Path to the array in the response. Leave blank if root is already an array.</p></div>
        </div>
      )}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field"><label>Poll Interval (seconds)</label><input type="number" value={form.poll_interval_seconds} onChange={e => set('poll_interval_seconds', e.target.value)} min={10} max={86400} /></div>
          <div className="field"><label>Headers (JSON)</label><textarea value={form.headers} onChange={e => set('headers', e.target.value)} rows={4} placeholder={'{\n  "Authorization": "Bearer TOKEN"\n}'} /></div>
        </div>
      )}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: 16, background: 'var(--bg-elevated)' }}>
            {[['Source ID', form.source_id], ['API URL', form.api_url], ['Method', form.method], ['Poll Interval', `${form.poll_interval_seconds}s`], ['Extraction Path', form.extraction_path || '(root)']].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--text-primary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {step === 4 && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'center' }}>
          <div style={{ padding: '12px 0' }}><div style={{ fontSize: '2.5rem' }}>✅</div><h2 style={{ marginTop: 8 }}>API Registered!</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 4 }}>Polling started for <strong style={{ color: 'var(--cyan)' }}>{result.source_id}</strong></p></div>
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={reset}>Register Another</button>
        </div>
      )}

      {step < 4 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
          <button className="btn btn-ghost" onClick={() => setStep(s => s - 1)} disabled={step === 0}>{step > 0 ? '← Back' : ''}</button>
          {step < 3
            ? <button className="btn btn-primary" onClick={() => setStep(s => s + 1)} disabled={!canNext()}>Continue →</button>
            : <button className="btn btn-primary" onClick={launch} disabled={loading}>{loading ? <span className="spinner" /> : '🚀 Launch'}</button>}
        </div>
      )}
    </div>
  );
}

function FileUpload() {
  const toast = useToast();
  const [sourceId, setSourceId] = useState('');
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const upload = async () => {
    if (!file || !sourceId.trim()) { toast('Source ID and file are required', 'error'); return; }
    setProgress(0);
    try {
      const res = await uploadStaticFile(sourceId, file, setProgress);
      setResult(res); toast(`Processed! ${res.records_passed} clean rows in Silver`, 'success');
    } catch (e) { toast(e?.response?.data?.detail || 'Upload failed', 'error'); }
    finally { setProgress(null); }
  };

  return (
    <div className="card" style={{ padding: 28, maxWidth: 520 }}>
      <h2 style={{ marginBottom: 4 }}>Upload Static File</h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 20 }}>CSV, JSON, Parquet, Excel, GeoJSON → Bronze → Silver pipeline.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field"><label>Source ID <span style={{ color: 'var(--rose)' }}>*</span></label>
          <input value={sourceId} onChange={e => setSourceId(e.target.value.replace(/\s/g, '_').toLowerCase())} placeholder="e.g. bangalore_military" /></div>
        <div onClick={() => inputRef.current.click()}
          style={{ border: '2px dashed var(--border-default)', borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: file ? 'var(--cyan-dim)' : 'transparent', borderColor: file ? 'var(--cyan)' : 'var(--border-default)', transition: 'all 0.2s' }}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); setFile(e.dataTransfer.files[0]); }}>
          <input ref={inputRef} type="file" style={{ display: 'none' }} accept=".csv,.json,.parquet,.xlsx,.geojson" onChange={e => setFile(e.target.files[0])} />
          <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>📁</div>
          {file ? <><p style={{ color: 'var(--cyan)', fontWeight: 600 }}>{file.name}</p><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{(file.size / 1024 / 1024).toFixed(2)} MB</p></>
            : <><p style={{ color: 'var(--text-secondary)' }}>Drop file or click to browse</p><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>CSV · JSON · Parquet · Excel · GeoJSON</p></>}
        </div>
        {progress !== null && <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, overflow: 'hidden', height: 6 }}><div style={{ height: '100%', width: `${progress}%`, background: 'var(--cyan)', transition: 'width 0.2s' }} /></div>}
        {result && <div style={{ background: 'var(--emerald-dim)', border: '1px solid hsla(158,70%,40%,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem', color: 'var(--emerald)' }}>✓ {result.records_passed} clean rows → Silver | {result.records_failed} quarantined</div>}
        <button className="btn btn-primary" onClick={upload} disabled={!file || !sourceId || progress !== null} style={{ width: '100%', justifyContent: 'center' }}>
          {progress !== null ? <><span className="spinner" /> Processing…</> : '↑ Upload & Process'}
        </button>
      </div>
    </div>
  );
}

function IngestTab() {
  const [mode, setMode] = useState('api');
  const Btn = ({ id, icon, label }) => (
    <button onClick={() => setMode(id)} style={{ padding: '8px 20px', border: 'none', cursor: 'pointer', borderRadius: 8, background: mode === id ? 'var(--cyan-dim)' : 'transparent', color: mode === id ? 'var(--cyan)' : 'var(--text-secondary)', fontWeight: mode === id ? 600 : 400, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 7 }}>{icon}{label}</button>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--bg-elevated)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        <Btn id="api" icon="🔌 " label="Register API" />
        <Btn id="file" icon="📁 " label="Upload File" />
      </div>
      {mode === 'api' && <APIWizard />}
      {mode === 'file' && <FileUpload />}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// TAB 2 — PIPELINES
// ════════════════════════════════════════════════════════
function BlueprintEditor({ sourceId }) {
  const toast = useToast();
  const [bps, setBPs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const blank = () => ({ target_field: '', json_path: '', data_type: 'STRING', is_primary_key: false, is_required: false });

  useEffect(() => {
    if (!sourceId) return;
    setLoading(true);
    getBlueprints(sourceId).then(r => setBPs(r.length ? r : [blank()])).finally(() => setLoading(false));
  }, [sourceId]);

  const upd = (i, k, v) => setBPs(arr => arr.map((b, idx) => idx === i ? { ...b, [k]: v } : b));
  const save = async () => {
    setSaving(true);
    try {
      await setBlueprints(sourceId, bps.map(({ blueprint_id, source_id, created_at, ...r }) => r));
      toast('Blueprints saved!', 'success');
    } catch (e) { toast(e?.response?.data?.detail || 'Save failed', 'error'); }
    finally { setSaving(false); }
  };

  if (!sourceId) return <div className="empty-state"><p>Select a source to edit blueprints</p></div>;
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div><h2>Mapping Blueprints</h2><p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>Raw JSON → Iceberg columns for <strong>{sourceId}</strong></p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setBPs(arr => [...arr, blank()])}>+ Add Field</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <span className="spinner" /> : '💾 Save'}</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 100px 60px 60px 32px', gap: 8, padding: '0 4px', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <span>Target Field</span><span>JSON Path</span><span>Type</span><span>PK</span><span>Req</span><span />
        </div>
        {bps.map((bp, i) => (
          <div key={i} className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 100px 60px 60px 32px', gap: 8, padding: '10px 12px', alignItems: 'center', background: 'var(--bg-elevated)' }}>
            <input value={bp.target_field} onChange={e => upd(i, 'target_field', e.target.value)} placeholder="latitude" />
            <input value={bp.json_path} onChange={e => upd(i, 'json_path', e.target.value)} placeholder="$.lat" style={{ fontFamily: 'JetBrains Mono', fontSize: '0.78rem' }} />
            <select value={bp.data_type} onChange={e => upd(i, 'data_type', e.target.value)}>
              {['STRING', 'INT', 'FLOAT', 'BOOLEAN', 'BIGINT', 'TIMESTAMP'].map(t => <option key={t}>{t}</option>)}
            </select>
            <div style={{ display: 'flex', justifyContent: 'center' }}><input type="checkbox" checked={bp.is_primary_key} onChange={e => upd(i, 'is_primary_key', e.target.checked)} style={{ width: 18, height: 18 }} /></div>
            <div style={{ display: 'flex', justifyContent: 'center' }}><input type="checkbox" checked={bp.is_required} onChange={e => upd(i, 'is_required', e.target.checked)} style={{ width: 18, height: 18 }} /></div>
            <button onClick={() => setBPs(arr => arr.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem' }}>✕</button>
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

  useEffect(() => {
    if (!sourceId) return;
    setLoading(true);
    getDQRules(sourceId).then(setRules).finally(() => setLoading(false));
  }, [sourceId]);

  const add = async () => {
    if (!form.rule_name || !form.rule_logic) { toast('Name and logic required', 'error'); return; }
    setAdding(true);
    try {
      const r = await addDQRule(sourceId, form);
      setRules(arr => [...arr, r]);
      setForm({ rule_name: '', rule_logic: '', action_on_fail: 'QUARANTINE', severity: 'ERROR' });
      toast('DQ Rule added!', 'success');
    } catch (e) { toast(e?.response?.data?.detail || 'Failed', 'error'); }
    finally { setAdding(false); }
  };

  if (!sourceId) return <div className="empty-state"><p>Select a source to manage DQ rules</p></div>;
  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Data Quality Rules</h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 16 }}>Python expressions that firewall records before Silver</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><span className="spinner" /></div>}
        {!loading && rules.length === 0 && <div className="empty-state" style={{ padding: 20, fontSize: '0.8rem' }}>No rules yet. Add one below.</div>}
        {rules.map(r => (
          <div key={r.rule_id} className="card" style={{ padding: '12px 14px', background: 'var(--bg-elevated)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: '0.875rem' }}>{r.rule_name}</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                <span className="badge badge-amber">{r.action_on_fail}</span>
                <span className="badge badge-muted">{r.severity}</span>
              </div>
            </div>
            <code style={{ fontSize: '0.78rem', color: 'var(--cyan)', fontFamily: 'JetBrains Mono' }}>{r.rule_logic}</code>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 16, background: 'var(--bg-elevated)' }}>
        <h3 style={{ marginBottom: 14 }}>Add New Rule</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field"><label>Rule Name</label><input value={form.rule_name} onChange={e => setForm(f => ({ ...f, rule_name: e.target.value }))} placeholder="Must have valid id" /></div>
          <div className="field"><label>Rule Logic (Python expression)</label><input value={form.rule_logic} onChange={e => setForm(f => ({ ...f, rule_logic: e.target.value }))} placeholder="osm_id is not None" style={{ fontFamily: 'JetBrains Mono' }} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label>Action on Fail</label><select value={form.action_on_fail} onChange={e => setForm(f => ({ ...f, action_on_fail: e.target.value }))}><option>QUARANTINE</option><option>DROP</option><option>FLAG</option></select></div>
            <div className="field"><label>Severity</label><select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}><option>ERROR</option><option>WARNING</option><option>INFO</option></select></div>
          </div>
          <button className="btn btn-primary" onClick={add} disabled={adding} style={{ alignSelf: 'flex-end' }}>{adding ? <span className="spinner" /> : '+ Add Rule'}</button>
        </div>
      </div>
    </div>
  );
}

function PipelinesTab() {
  const toast = useToast();
  const [sources, setSources] = useState([]);
  const [selected, setSelected] = useState(null);
  const [subTab, setSubTab] = useState('blueprints');
  const [loading, setLoading] = useState(true);

  const load = () => { setLoading(true); listSources().then(setSources).catch(() => toast('Failed to load sources', 'error')).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const SubBtn = ({ id, label }) => (
    <button onClick={() => setSubTab(id)} style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', borderRadius: 7, background: subTab === id ? 'var(--cyan-dim)' : 'transparent', color: subTab === id ? 'var(--cyan)' : 'var(--text-secondary)', fontWeight: subTab === id ? 600 : 400, fontSize: '0.84rem' }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%' }}>
      <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', paddingRight: 16, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Sources</h3>
          <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', fontSize: '0.9rem' }}>↺</button>
        </div>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><span className="spinner" /></div>}
        {!loading && sources.length === 0 && <div className="empty-state" style={{ padding: 16, fontSize: '0.76rem' }}>No sources. Register one in Ingest tab.</div>}
        {sources.map(s => (
          <div key={s.source_id} onClick={() => setSelected(s.source_id)} className="card"
            style={{ padding: '10px 12px', cursor: 'pointer', marginBottom: 6, background: selected === s.source_id ? 'var(--cyan-dim)' : 'var(--glass-bg)', borderColor: selected === s.source_id ? 'var(--cyan)' : 'var(--border-default)', transition: 'all 0.15s' }}>
            <p style={{ fontWeight: 600, fontSize: '0.8rem' }}>{s.source_id}</p>
            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{s.source_type}</p>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, paddingLeft: 24, overflowY: 'auto' }}>
        {!selected
          ? <div className="empty-state" style={{ marginTop: 60 }}><div style={{ fontSize: '2rem' }}>👈</div><h2>Select a Source</h2><p style={{ fontSize: '0.82rem' }}>Choose from the left to configure its pipeline rules.</p></div>
          : <>
              <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-elevated)', padding: 4, borderRadius: 8, width: 'fit-content' }}>
                <SubBtn id="blueprints" label="📐 Blueprints" />
                <SubBtn id="dq" label="🛡 DQ Rules" />
              </div>
              {subTab === 'blueprints' && <BlueprintEditor sourceId={selected} />}
              {subTab === 'dq' && <DQPanel sourceId={selected} />}
            </>
        }
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// TAB 3 — QUERY
// ════════════════════════════════════════════════════════
function TableGrid({ data }) {
  if (!data || data.length === 0) return <div className="empty-state"><p>No results returned</p></div>;
  const cols = Object.keys(data[0]);
  return (
    <div style={{ overflow: 'auto', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead><tr style={{ background: 'var(--bg-elevated)' }}>
          {cols.map(c => <th key={c} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', borderBottom: '1px solid var(--border-default)', whiteSpace: 'nowrap' }}>{c}</th>)}
        </tr></thead>
        <tbody>{data.map((row, i) => (
          <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)', background: i % 2 === 0 ? 'transparent' : 'hsla(222,28%,9%,0.4)' }}>
            {cols.map(c => <td key={c} style={{ padding: '9px 14px', color: 'var(--text-secondary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row[c] === null ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>null</span> : String(row[c])}
            </td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function QueryTab() {
  const toast = useToast();
  const [tables, setTables] = useState([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [sql, setSql] = useState('SELECT * FROM bangalore_military LIMIT 25');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [execTime, setExecTime] = useState(null);

  const loadTables = async () => { setTablesLoading(true); try { setTables(await listSilverTables()); } catch {} finally { setTablesLoading(false); } };
  useEffect(() => { loadTables(); }, []);

  const execute = async () => {
    if (!sql.trim()) return;
    setLoading(true); setError(null); setResult(null);
    const t0 = performance.now();
    try {
      const r = await runQuery(sql.trim());
      setResult(Array.isArray(r) ? r : (r.rows || r.data || []));
      setExecTime(((performance.now() - t0) / 1000).toFixed(2));
    } catch (e) { setError(e?.response?.data?.detail || 'Query failed'); toast('Query failed', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 2, minWidth: 320 }}>
        <div className="card" style={{ padding: 20, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2>SQL Query</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {execTime && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{execTime}s</span>}
              <button className="btn btn-primary" onClick={execute} disabled={loading} style={{ padding: '7px 16px' }}>{loading ? <span className="spinner" /> : '▶ Run'}</button>
            </div>
          </div>
          <textarea value={sql} onChange={e => setSql(e.target.value)} style={{ minHeight: 96, borderRadius: 8 }} onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') execute(); }} />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>Ctrl+Enter to run</p>
        </div>
        <div className="card" style={{ padding: 20, flex: 1, overflow: 'auto' }}>
          <h2 style={{ marginBottom: 12 }}>Results {result && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 400 }}>({result.length} rows)</span>}</h2>
          {error && <div style={{ background: 'var(--rose-dim)', border: '1px solid hsla(352,85%,50%,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem', color: 'var(--rose)', fontFamily: 'JetBrains Mono' }}>{error}</div>}
          {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>}
          {!loading && !error && result && <TableGrid data={result} />}
          {!loading && !error && !result && <div className="empty-state"><p>Run a query to see results</p></div>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 220, flexShrink: 0 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3>Silver Tables</h3>
            <button onClick={loadTables} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', fontSize: '0.9rem' }}>{tablesLoading ? '…' : '↺'}</button>
          </div>
          {tables.length === 0 && <div className="empty-state" style={{ padding: 16, fontSize: '0.76rem' }}>No Silver tables yet</div>}
          {tables.map(t => { const name = typeof t === 'string' ? t : t.table_name; return (
            <div key={name} onClick={() => setSql(`SELECT * FROM ${name} LIMIT 50`)}
              style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'JetBrains Mono', color: 'var(--cyan)', background: 'var(--cyan-dim)', marginBottom: 6, transition: 'filter 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.2)'}
              onMouseLeave={e => e.currentTarget.style.filter = ''}>{name}</div>
          ); })}
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginBottom: 12 }}>Quick Queries</h3>
          {[{ label: 'Preview 50 rows', sql: 'SELECT * FROM bangalore_military LIMIT 50' }, { label: 'Count records', sql: 'SELECT COUNT(*) as total FROM bangalore_military' }]
            .map(p => <button key={p.label} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 6, fontSize: '0.78rem', padding: '7px 10px' }} onClick={() => setSql(p.sql)}>{p.label}</button>)}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// ROOT PAGE
// ════════════════════════════════════════════════════════
export default function IngestionPage() {
  const [tab, setTab] = useState('ingest');
  const tabs = [
    { id: 'ingest',    icon: '⬇', label: 'Ingest' },
    { id: 'pipelines', icon: '⚙', label: 'Pipelines' },
    { id: 'query',     icon: '⬆', label: 'Query' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header + tabs */}
      <div style={{ padding: '20px 32px 0', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <h1 style={{ marginBottom: 2 }}>HVE-OS Data Platform</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 16 }}>Ingest → Configure Pipelines → Query Silver Lakehouse</p>
        <div style={{ display: 'flex', gap: 0 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '10px 22px', border: 'none', cursor: 'pointer', background: 'transparent',
              color: tab === t.id ? 'var(--cyan)' : 'var(--text-muted)',
              borderBottom: tab === t.id ? '2px solid var(--cyan)' : '2px solid transparent',
              fontWeight: tab === t.id ? 600 : 400, fontSize: '0.9rem',
              display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.15s',
            }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>
      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '28px 32px' }}>
        {tab === 'ingest'    && <IngestTab />}
        {tab === 'pipelines' && <PipelinesTab />}
        {tab === 'query'     && <QueryTab />}
      </div>
    </div>
  );
}
