import React, { useState, useEffect, useCallback } from 'react';
import { listSources, getBlueprints, setBlueprints, getDQRules, addDQRule } from '../api/client.js';
import { useToast } from '../components/ToastProvider.jsx';

// ── Source List ─────────────────────────────────────────────
function SourceList({ selected, onSelect, refresh }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(async () => {
    try { setSources(await listSources()); }
    catch { toast('Failed to load sources', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refresh]);

  const protocolColor = { API_POLL: 'cyan', STREAM: 'violet', STATIC_FILE: 'emerald' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h3 style={{ marginBottom: 10 }}>Data Sources</h3>
      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><span className="spinner" /></div>}
      {!loading && sources.length === 0 && (
        <div className="empty-state" style={{ padding: 24 }}>
          <div style={{ fontSize: '1.5rem' }}>🔌</div>
          <p style={{ fontSize: '0.82rem' }}>No sources yet. Register one in Ingestion.</p>
        </div>
      )}
      {sources.map(s => (
        <div key={s.source_id} onClick={() => onSelect(s.source_id)}
          className="card"
          style={{
            padding: '12px 14px', cursor: 'pointer',
            background: selected === s.source_id ? 'var(--cyan-dim)' : 'var(--glass-bg)',
            borderColor: selected === s.source_id ? 'var(--cyan)' : 'var(--border-default)',
            transition: 'all 0.15s',
          }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>{s.source_id}</p>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{s.protocol}</p>
            </div>
            <span className={`badge badge-${protocolColor[s.source_type] || 'muted'}`}>{s.source_type}</span>
          </div>
        </div>
      ))}
      <button className="btn btn-ghost" style={{ marginTop: 8, justifyContent: 'center', fontSize: '0.78rem' }} onClick={load}>↺ Refresh</button>
    </div>
  );
}

// ── Blueprint Editor ─────────────────────────────────────────
function BlueprintEditor({ sourceId }) {
  const toast = useToast();
  const [blueprints, setLocalBPs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sourceId) return;
    setLoading(true);
    getBlueprints(sourceId).then(bps => {
      setLocalBPs(bps.length > 0 ? bps : [defaultBP()]);
    }).finally(() => setLoading(false));
  }, [sourceId]);

  const defaultBP = () => ({ target_field: '', json_path: '', data_type: 'STRING', is_primary_key: false, is_required: false, default_value: '' });

  const update = (i, k, v) => setLocalBPs(arr => arr.map((b, idx) => idx === i ? { ...b, [k]: v } : b));
  const add = () => setLocalBPs(arr => [...arr, defaultBP()]);
  const remove = (i) => setLocalBPs(arr => arr.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = blueprints.map(({ blueprint_id, source_id, created_at, ...rest }) => rest);
      await setBlueprints(sourceId, cleaned);
      toast('Blueprints saved!', 'success');
    } catch (e) {
      toast(e?.response?.data?.detail || 'Save failed', 'error');
    } finally { setSaving(false); }
  };

  if (!sourceId) return <div className="empty-state"><p>Select a source to edit blueprints</p></div>;
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2>Mapping Blueprints</h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>Define how raw JSON maps to Iceberg columns for <strong>{sourceId}</strong></p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={add}>+ Add Field</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : '💾 Save'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 100px 60px 60px 32px', gap: 8, padding: '0 4px', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <span>Target Field</span><span>JSON Path</span><span>Data Type</span><span>PK</span><span>Required</span><span></span>
        </div>
        {blueprints.map((bp, i) => (
          <div key={i} className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 100px 60px 60px 32px', gap: 8, padding: '10px 12px', alignItems: 'center', background: 'var(--bg-elevated)' }}>
            <input value={bp.target_field} onChange={e => update(i, 'target_field', e.target.value)} placeholder="latitude" />
            <input value={bp.json_path} onChange={e => update(i, 'json_path', e.target.value)} placeholder="$.lat" style={{ fontFamily: 'JetBrains Mono', fontSize: '0.78rem' }} />
            <select value={bp.data_type} onChange={e => update(i, 'data_type', e.target.value)}>
              {['STRING', 'INT', 'FLOAT', 'BOOLEAN', 'BIGINT', 'TIMESTAMP'].map(t => <option key={t}>{t}</option>)}
            </select>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <input type="checkbox" checked={bp.is_primary_key} onChange={e => update(i, 'is_primary_key', e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <input type="checkbox" checked={bp.is_required} onChange={e => update(i, 'is_required', e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
            </div>
            <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem' }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── DQ Rules Panel ───────────────────────────────────────────
function DQRulesPanel({ sourceId }) {
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

  const save = async () => {
    if (!form.rule_name || !form.rule_logic) { toast('Name and rule logic required', 'error'); return; }
    setAdding(true);
    try {
      const r = await addDQRule(sourceId, form);
      setRules(arr => [...arr, r]);
      setForm({ rule_name: '', rule_logic: '', action_on_fail: 'QUARANTINE', severity: 'ERROR' });
      toast('DQ Rule added!', 'success');
    } catch (e) {
      toast(e?.response?.data?.detail || 'Failed to add rule', 'error');
    } finally { setAdding(false); }
  };

  const actionColor = { QUARANTINE: 'amber', DROP: 'rose', FLAG: 'violet' };

  if (!sourceId) return <div className="empty-state"><p>Select a source to manage DQ rules</p></div>;

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Data Quality Rules</h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 16 }}>Python firewall rules that filter records before they reach Silver</p>

      {/* Existing rules */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><span className="spinner" /></div>}
        {!loading && rules.length === 0 && <div className="empty-state" style={{ padding: 20, fontSize: '0.8rem' }}>No rules yet. Add one below.</div>}
        {rules.map(r => (
          <div key={r.rule_id} className="card" style={{ padding: '12px 14px', background: 'var(--bg-elevated)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: '0.875rem' }}>{r.rule_name}</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                <span className={`badge badge-${actionColor[r.action_on_fail] || 'muted'}`}>{r.action_on_fail}</span>
                <span className="badge badge-muted">{r.severity}</span>
              </div>
            </div>
            <code style={{ fontSize: '0.78rem', color: 'var(--cyan)', fontFamily: 'JetBrains Mono' }}>{r.rule_logic}</code>
          </div>
        ))}
      </div>

      {/* Add rule form */}
      <div className="card" style={{ padding: 16, background: 'var(--bg-elevated)' }}>
        <h3 style={{ marginBottom: 14 }}>Add New Rule</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label>Rule Name</label>
            <input value={form.rule_name} onChange={e => setForm(f => ({ ...f, rule_name: e.target.value }))} placeholder="Must have positive altitude" />
          </div>
          <div className="field">
            <label>Rule Logic (Python expression)</label>
            <input value={form.rule_logic} onChange={e => setForm(f => ({ ...f, rule_logic: e.target.value }))}
              placeholder="altitude >= 0 and altitude < 50000" style={{ fontFamily: 'JetBrains Mono' }} />
            <p className="field-hint">Evaluated against mapped columns. Use Python math and string ops.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Action on Fail</label>
              <select value={form.action_on_fail} onChange={e => setForm(f => ({ ...f, action_on_fail: e.target.value }))}>
                <option>QUARANTINE</option><option>DROP</option><option>FLAG</option>
              </select>
            </div>
            <div className="field">
              <label>Severity</label>
              <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                <option>ERROR</option><option>WARNING</option><option>INFO</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary" onClick={save} disabled={adding} style={{ alignSelf: 'flex-end' }}>
            {adding ? <span className="spinner" /> : '+ Add Rule'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function ProcessingPage() {
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('blueprints');
  const [refresh] = useState(0);
  const toast = useToast();

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{
      padding: '7px 16px', border: 'none', cursor: 'pointer', borderRadius: 7,
      background: tab === id ? 'var(--cyan-dim)' : 'transparent',
      color: tab === id ? 'var(--cyan)' : 'var(--text-secondary)',
      fontWeight: tab === id ? 600 : 400, fontSize: '0.84rem',
    }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left sidebar: source list */}
      <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', padding: '24px 16px', overflow: 'auto' }}>
        <SourceList selected={selected} onSelect={setSelected} refresh={refresh} />
      </div>

      {/* Right: content area */}
      <div style={{ flex: 1, padding: '24px 28px', overflow: 'auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ marginBottom: 6 }}>⚙ Processing</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Configure mapping blueprints and data quality gates for each source.</p>
        </div>

        {selected && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-elevated)', padding: 4, borderRadius: 8, width: 'fit-content' }}>
            <TabBtn id="blueprints" label="📐 Blueprints" />
            <TabBtn id="dq" label="🛡 DQ Rules" />
          </div>
        )}

        {!selected && (
          <div className="empty-state" style={{ marginTop: 60 }}>
            <div style={{ fontSize: '2.5rem' }}>👈</div>
            <h2>Select a Source</h2>
            <p style={{ fontSize: '0.82rem' }}>Choose a data source from the left panel to configure its pipeline rules.</p>
          </div>
        )}
        {selected && tab === 'blueprints' && <BlueprintEditor sourceId={selected} />}
        {selected && tab === 'dq' && <DQRulesPanel sourceId={selected} />}
      </div>
    </div>
  );
}
