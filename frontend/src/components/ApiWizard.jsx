import React, { useState, useEffect } from 'react';
import { previewApi, registerSource, registerApiSource, getBlueprints, setBlueprints, getDQRules, addDQRule } from '../api/client.js';
import { useToast } from './ToastProvider.jsx';

const STATUS_RING = { ok:'#34d399', error:'#f05050', pending:'transparent' };

const Steps = ({ current, steps, highest, onStepClick, stepStatus }) => (
  <div style={{ display:'flex', alignItems:'center', marginBottom:20 }}>
    {steps.map((s,i) => {
      const clickable = i <= highest;
      const st = stepStatus?.[i];
      const ring = st ? STATUS_RING[st] : 'transparent';
      return (
        <React.Fragment key={i}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, position:'relative' }}>
            <div
              onClick={clickable ? () => onStepClick(i) : undefined}
              style={{ width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', fontWeight:700,
                background: i<current?'var(--cyan)':i===current?'var(--cyan-dim)':'var(--bg-elevated)',
                color: i<current?'hsl(222,28%,6%)':i===current?'var(--cyan)':'var(--text-muted)',
                border: i===current?'2px solid var(--cyan)':'2px solid transparent',
                cursor: clickable?'pointer':'default',
                transition: 'transform 0.1s',
                boxShadow: ring !== 'transparent' ? `0 0 0 3px ${ring}40, 0 0 8px ${ring}30` : 'none',
              }}
              onMouseEnter={e => { if (clickable) e.currentTarget.style.transform='scale(1.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform='scale(1)'; }}
              title={clickable ? `Go to ${s}${st ? ` (${st})` : ''}` : ''}
            >{i<current?'✓':i+1}</div>
            {st && <div style={{ position:'absolute', top:-3, right:-3, width:8, height:8, borderRadius:'50%', background:STATUS_RING[st], border:'2px solid var(--bg-surface)' }} />}
            <span style={{ fontSize:'0.62rem', color:i===current?'var(--cyan)':'var(--text-muted)', fontWeight:i===current?600:400, whiteSpace:'nowrap', cursor:clickable?'pointer':'default' }} onClick={clickable ? () => onStepClick(i) : undefined}>{s}</span>
          </div>
          {i<steps.length-1 && <div style={{ flex:1, height:2, background:i<current?'var(--cyan)':'var(--border-subtle)', margin:'-14px 5px 0', minWidth:12 }}/>}
        </React.Fragment>
      );
    })}
  </div>
);

const TYPES = ['STRING','INT','FLOAT','BOOLEAN','BIGINT','TIMESTAMP'];
const blankBP = () => ({ target_field:'', json_path:'', data_type:'STRING', is_primary_key:false, is_required:false });

const METHOD_COLORS = { GET:'#73dc8c', POST:'#f0a44b', PUT:'#4ba3f0', DELETE:'#f05050' };

export default function ApiWizard() {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ source_id:'', api_url:'', method:'GET', headers:'', body_template:'', extraction_path:'', poll_interval_seconds:300, description:'' });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState(null);
  const [previewTime, setPreviewTime] = useState(null);

  // Status tracking per step + activity log
  const [stepStatus, setStepStatus] = useState({});
  const [actLog, setActLog] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const markStep = (s, status) => setStepStatus(prev => ({...prev, [s]: status}));
  const log = (action, status, detail) => setActLog(prev => [{ts: new Date().toLocaleTimeString(), action, status, detail}, ...prev].slice(0, 50));
  const [reqTab, setReqTab] = useState('headers');

  const [bps, setBPs] = useState([blankBP()]);
  const [bpSaving, setBpSaving] = useState(false);
  const [bpSaved, setBpSaved] = useState(false);

  const [rules, setRules] = useState([]);
  const [dqForm, setDqForm] = useState({ rule_name:'', rule_logic:'', action_on_fail:'QUARANTINE', severity:'ERROR' });
  const [dqAdding, setDqAdding] = useState(false);

  const [result, setResult] = useState(null);

  const wizardSteps = ['Setup','Preview','Blueprints','DQ Rules','Launch'];

  // Preview fetch
  const fetchPreview = async () => {
    setLoading(true); setPreviewErr(null); setPreview(null);
    log('Preview API', 'pending', `${form.method} ${form.api_url}`);
    const t0 = performance.now();
    try {
      let hdrs = {}; try { hdrs = form.headers ? JSON.parse(form.headers) : {}; } catch { setPreviewErr('Invalid headers JSON'); markStep(1,'error'); log('Preview API','error','Invalid headers JSON'); setLoading(false); return; }
      let body = null; try { body = form.body_template ? JSON.parse(form.body_template) : null; } catch { setPreviewErr('Invalid body JSON'); markStep(1,'error'); log('Preview API','error','Invalid body JSON'); setLoading(false); return; }
      const r = await previewApi({ source_id: form.source_id||'preview', api_url:form.api_url, method:form.method, headers:hdrs, body_template:body, extraction_path:form.extraction_path||null, poll_interval_seconds:60 });
      setPreview(r);
      setPreviewTime(((performance.now()-t0)/1000).toFixed(2));
      if (r.sample_keys?.length) setBPs(r.sample_keys.map(k => ({ target_field:k, json_path:`$.${k}`, data_type:'STRING', is_primary_key:false, is_required:false })));
      markStep(1,'ok'); log('Preview API','ok',`${r.total_records} records in ${((performance.now()-t0)/1000).toFixed(2)}s`);
      toast(`${r.total_records} records fetched`, 'success');
    } catch(e) { const msg = e?.response?.data?.detail || e.message; setPreviewErr(msg); markStep(1,'error'); log('Preview API','error',msg); }
    finally { setLoading(false); }
  };

  const saveBPs = async () => {
    setBpSaving(true); log('Save Blueprints','pending',`${bps.length} fields for ${form.source_id}`);
    try {
      try { await registerSource({ source_id:form.source_id, source_type:'STREAM', protocol:'HTTP', description:form.description||'Pre-registered' }); log('Pre-register Source','ok',form.source_id); } catch { /* already exists */ }
      await setBlueprints(form.source_id, bps.map(({blueprint_id,source_id,created_at,...r})=>r));
      setBpSaved(true); markStep(2,'ok'); log('Save Blueprints','ok',`${bps.length} fields saved`); toast('Blueprints saved!','success');
    } catch(e) { const msg=e?.response?.data?.detail||'Failed'; markStep(2,'error'); log('Save Blueprints','error',msg); toast(msg,'error'); }
    finally { setBpSaving(false); }
  };

  const addRule = async () => {
    if (!dqForm.rule_name||!dqForm.rule_logic) { toast('Required','error'); return; }
    setDqAdding(true); log('Add DQ Rule','pending',dqForm.rule_name);
    try { const r = await addDQRule(form.source_id, dqForm); setRules(a=>[...a,r]); setDqForm({ rule_name:'', rule_logic:'', action_on_fail:'QUARANTINE', severity:'ERROR' }); markStep(3,'ok'); log('Add DQ Rule','ok',dqForm.rule_name); toast('Added!','success'); }
    catch(e) { const msg=e?.response?.data?.detail||'Failed'; log('Add DQ Rule','error',msg); toast(msg,'error'); }
    finally { setDqAdding(false); }
  };

  useEffect(() => { if (step===3 && form.source_id) getDQRules(form.source_id).then(setRules).catch(()=>{}); }, [step]);

  const launch = async () => {
    setLoading(true); log('Register API','pending',`${form.source_id} → ${form.api_url}`);
    try {
      let hdrs={}, body=null;
      try { hdrs=JSON.parse(form.headers||'{}'); } catch {}
      try { body=form.body_template?JSON.parse(form.body_template):null; } catch {}
      const res = await registerApiSource({ source_id:form.source_id, api_url:form.api_url, method:form.method, headers:hdrs, body_template:body, extraction_path:form.extraction_path||null, poll_interval_seconds:parseInt(form.poll_interval_seconds), description:form.description||null });
      setResult(res); setStep(5); markStep(4,'ok'); log('Register API','ok',`Polling active! ${res.total_records_found||0} initial records`); toast('Polling started!','success');
    } catch(e) { const msg=e?.response?.data?.detail||'Failed'; markStep(4,'error'); log('Register API','error',msg); toast(msg,'error'); }
    finally { setLoading(false); }
  };

  const reset = () => { setStep(0); setHighest(0); setResult(null); setPreview(null); setPreviewErr(null); setBPs([blankBP()]); setRules([]); setBpSaved(false); setStepStatus({}); setActLog([]); setForm({ source_id:'', api_url:'', method:'GET', headers:'', body_template:'', extraction_path:'', poll_interval_seconds:300, description:'' }); };
  const canNext = () => { if (step===0) return form.source_id.trim().length>0; if (step===1) return preview && preview.total_records>0; if (step===2) return bpSaved; return true; };
  const upd = (i,k,v) => { setBPs(a=>a.map((b,j)=>j===i?{...b,[k]:v}:b)); setBpSaved(false); };

  // Track highest step reached (for clickable navigation)
  const [highest, setHighest] = useState(0);

  // Navigate to a step + auto-refresh its data
  const goToStep = async (target) => {
    setStep(target);
    setHighest(h => Math.max(h, target));
    // Auto-refresh data for the target step
    if (target === 2 && form.source_id) {
      // Entering Blueprints: reload existing blueprints
      try { const existing = await getBlueprints(form.source_id); if (existing.length > 0) { setBPs(existing); setBpSaved(true); } } catch {}
    }
    if (target === 3 && form.source_id) {
      // Entering DQ Rules: reload existing rules
      try { const existing = await getDQRules(form.source_id); setRules(existing); } catch {}
    }
  };

  // --- Postman-style tab button ---
  const TabBtn = ({ id, label, active, onClick }) => (
    <button onClick={onClick} style={{ padding:'7px 16px', border:'none', cursor:'pointer', background:'transparent', color:active?'var(--text-primary)':'var(--text-muted)', borderBottom:active?'2px solid var(--cyan)':'2px solid transparent', fontWeight:active?600:400, fontSize:'0.8rem' }}>{label}</button>
  );

  return (
    <div style={{ maxWidth:820 }}>
      {step<5 && <Steps current={step} steps={wizardSteps} highest={highest} onStepClick={goToStep} stepStatus={stepStatus} />}

      {/* ═══ Step 0: Setup ═══ */}
      {step===0 && <div className="card" style={{ padding:24 }}>
        <h2 style={{ marginBottom:12 }}>Pipeline Setup</h2>
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="field"><label>Source ID <span style={{color:'var(--rose)'}}>*</span></label><input value={form.source_id} onChange={e=>set('source_id',e.target.value.replace(/\s/g,'_').toLowerCase())} placeholder="bangalore_military" autoFocus /><p className="field-hint">Unique pipeline ID — becomes your Iceberg table name.</p></div>
          <div className="field"><label>Description</label><input value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Optional description" /></div>
        </div>
      </div>}

      {/* ═══ Step 1: Postman-style Preview ═══ */}
      {step===1 && <div>
        {/* URL Bar */}
        <div style={{ display:'flex', gap:0, marginBottom:0, background:'var(--bg-surface)', border:'1px solid var(--border-default)', borderRadius:'10px 10px 0 0', padding:6, alignItems:'center' }}>
          <select value={form.method} onChange={e=>set('method',e.target.value)} style={{ width:100, border:'none', background:'transparent', color:METHOD_COLORS[form.method]||'var(--cyan)', fontWeight:700, fontSize:'0.9rem', cursor:'pointer', padding:'8px 10px' }}>
            <option style={{color:'#73dc8c'}}>GET</option><option style={{color:'#f0a44b'}}>POST</option><option style={{color:'#4ba3f0'}}>PUT</option><option style={{color:'#f05050'}}>DELETE</option>
          </select>
          <input value={form.api_url} onChange={e=>set('api_url',e.target.value)} placeholder="Enter request URL" style={{ flex:1, border:'none', background:'transparent', color:'var(--text-primary)', fontSize:'0.88rem', padding:'8px 12px', outline:'none', fontFamily:'JetBrains Mono' }} />
          <button onClick={fetchPreview} disabled={loading||!form.api_url.trim()} style={{ padding:'8px 24px', border:'none', borderRadius:6, background:'#4b8df8', color:'#fff', fontWeight:700, fontSize:'0.85rem', cursor:'pointer', opacity:loading||!form.api_url.trim()?0.5:1, display:'flex', alignItems:'center', gap:6 }}>
            {loading ? <span className="spinner" style={{width:14,height:14}}/> : null} Send
          </button>
        </div>

        {/* Request Tabs */}
        <div style={{ background:'var(--bg-surface)', borderLeft:'1px solid var(--border-default)', borderRight:'1px solid var(--border-default)', display:'flex', gap:0, borderBottom:'1px solid var(--border-subtle)' }}>
          <TabBtn id="headers" label="Headers" active={reqTab==='headers'} onClick={()=>setReqTab('headers')} />
          {(form.method==='POST'||form.method==='PUT') && <TabBtn id="body" label="Body" active={reqTab==='body'} onClick={()=>setReqTab('body')} />}
        </div>

        {/* Tab Content */}
        <div style={{ background:'var(--bg-surface)', borderLeft:'1px solid var(--border-default)', borderRight:'1px solid var(--border-default)', padding:12, minHeight:80 }}>
          {reqTab==='headers' && <textarea value={form.headers} onChange={e=>set('headers',e.target.value)} placeholder='{"Content-Type":"application/json"}' rows={3} style={{ width:'100%', fontFamily:'JetBrains Mono', fontSize:'0.8rem', background:'var(--bg-elevated)', border:'1px solid var(--border-subtle)', borderRadius:6, padding:10, color:'var(--text-primary)', resize:'vertical' }} />}
          {reqTab==='body' && <textarea value={form.body_template} onChange={e=>set('body_template',e.target.value)} placeholder='{"key":"value"}' rows={5} style={{ width:'100%', fontFamily:'JetBrains Mono', fontSize:'0.8rem', background:'var(--bg-elevated)', border:'1px solid var(--border-subtle)', borderRadius:6, padding:10, color:'var(--text-primary)', resize:'vertical' }} />}
        </div>

        {/* Response Panel */}
        <div style={{ background:'var(--bg-elevated)', border:'1px solid var(--border-default)', borderRadius:'0 0 10px 10px', minHeight:120 }}>
          {/* Response header bar */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 14px', borderBottom:'1px solid var(--border-subtle)' }}>
            <span style={{ fontSize:'0.78rem', fontWeight:600, color:'var(--text-muted)' }}>Response</span>
            {preview && <div style={{ display:'flex', gap:14, fontSize:'0.75rem', alignItems:'center' }}>
              <span style={{ color:'#73dc8c', fontWeight:600 }}>200 OK</span>
              <span style={{ color:'var(--text-muted)' }}>{previewTime}s</span>
              <span style={{ color:'var(--text-muted)' }}>{preview.total_records} records</span>
              <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(preview.preview, null, 2)); toast('Copied to clipboard!','success'); }} style={{ background:'none', border:'1px solid var(--border-subtle)', borderRadius:5, cursor:'pointer', color:'var(--text-muted)', fontSize:'0.7rem', padding:'2px 8px', display:'flex', alignItems:'center', gap:4 }} title="Copy response JSON">📋 Copy</button>
            </div>}
          </div>
          {/* Response body */}
          <div style={{ padding:12, maxHeight:300, overflowY:'auto' }}>
            {!preview && !previewErr && !loading && <div style={{ textAlign:'center', padding:'30px 0', color:'var(--text-muted)', fontSize:'0.85rem' }}>Click <strong>Send</strong> to fetch a preview</div>}
            {loading && <div style={{ display:'flex', justifyContent:'center', padding:30 }}><span className="spinner" /></div>}
            {previewErr && <div style={{ color:'var(--rose)', fontFamily:'JetBrains Mono', fontSize:'0.78rem', whiteSpace:'pre-wrap' }}>{previewErr}</div>}
            {preview && <pre style={{ margin:0, fontFamily:'JetBrains Mono', fontSize:'0.72rem', color:'var(--text-secondary)', whiteSpace:'pre-wrap', wordBreak:'break-all' }}>{JSON.stringify(preview.preview?.slice(0,5), null, 2)}</pre>}
          </div>
        </div>
      </div>}

      {/* ═══ Step 2: Blueprints ═══ */}
      {step===2 && (() => {
        // Build a clickable JSON tree from the first preview record
        const sample = preview?.preview?.[0] || {};

        const detectType = (v) => {
          if (v === null || v === undefined) return 'STRING';
          if (typeof v === 'boolean') return 'BOOLEAN';
          if (typeof v === 'number') return Number.isInteger(v) ? (v > 2147483647 ? 'BIGINT' : 'INT') : 'FLOAT';
          if (typeof v === 'string') { if (/^\d{4}-\d{2}-\d{2}/.test(v)) return 'TIMESTAMP'; return 'STRING'; }
          return 'STRING';
        };

        const addFromTree = (path, key, value) => {
          // Don't add if path already exists
          if (bps.some(b => b.json_path === path)) return;
          const newBP = { target_field: key.replace(/[^a-zA-Z0-9_]/g,'_').toLowerCase(), json_path: path, data_type: detectType(value), is_primary_key: key === 'id', is_required: false };
          setBPs(a => [...a.filter(b => b.target_field || b.json_path), newBP]);
          setBpSaved(false);
        };

        // Recursive tree node renderer
        const TreeNode = ({ obj, path, depth }) => {
          if (obj === null || obj === undefined) return null;
          if (typeof obj !== 'object') return null;

          return Object.entries(obj).map(([key, val]) => {
            const fullPath = `${path}.${key}`;
            const isObj = val !== null && typeof val === 'object' && !Array.isArray(val);
            const isArr = Array.isArray(val);
            const isLeaf = !isObj && !isArr;
            const alreadyAdded = bps.some(b => b.json_path === fullPath);
            const typeColor = { STRING:'#a78bfa', INT:'#34d399', FLOAT:'#34d399', BIGINT:'#34d399', BOOLEAN:'#fbbf24', TIMESTAMP:'#60a5fa' };

            // For arrays: peek at the first element to show its structure
            const arrSample = isArr && val.length > 0 ? val[0] : null;
            const arrSampleIsObj = arrSample !== null && typeof arrSample === 'object' && !Array.isArray(arrSample);

            return (
              <TreeNodeItem key={fullPath} fullPath={fullPath} keyName={key} val={val}
                isObj={isObj} isArr={isArr} isLeaf={isLeaf} alreadyAdded={alreadyAdded}
                typeColor={typeColor} depth={depth} detectType={detectType}
                addFromTree={addFromTree} bps={bps}
                arrSample={arrSample} arrSampleIsObj={arrSampleIsObj} />
            );
          });
        };

        // Individual tree node with its own expand/collapse state
        const TreeNodeItem = ({ fullPath, keyName, val, isObj, isArr, isLeaf, alreadyAdded, typeColor, depth, detectType, addFromTree, bps, arrSample, arrSampleIsObj }) => {
          const [expanded, setExpanded] = React.useState(depth < 1);
          const canExpand = isObj || (isArr && arrSampleIsObj);

          return (
            <div style={{ marginLeft: depth * 14 }}>
              <div
                onClick={canExpand ? () => setExpanded(!expanded) : isLeaf ? () => addFromTree(fullPath, keyName, val) : undefined}
                style={{
                  display:'flex', alignItems:'center', gap:6, padding:'3px 6px', borderRadius:5,
                  cursor: canExpand || isLeaf ? 'pointer' : 'default',
                  background: alreadyAdded ? 'hsla(192,100%,55%,0.08)' : 'transparent',
                  opacity: alreadyAdded ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (canExpand || (isLeaf && !alreadyAdded)) e.currentTarget.style.background = 'hsla(192,100%,55%,0.12)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = alreadyAdded ? 'hsla(192,100%,55%,0.08)' : 'transparent'; }}
                title={isLeaf ? (alreadyAdded ? 'Already added' : `Click to add as ${detectType(val)}`) : canExpand ? (expanded ? 'Collapse' : 'Expand') : ''}
              >
                <span style={{ color: canExpand ? 'var(--cyan)' : 'var(--text-muted)', fontSize:'0.7rem', width:10, textAlign:'center', transition:'transform 0.15s', transform: canExpand && expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                  {canExpand ? '▶' : (alreadyAdded ? '✓' : '+')}
                </span>
                <span style={{ color:'#79c0ff', fontFamily:'JetBrains Mono', fontSize:'0.75rem' }}>{keyName}</span>
                <span style={{ color:'var(--text-muted)', fontSize:'0.62rem' }}>:</span>
                {isLeaf && <>
                  <span style={{ color: typeColor[detectType(val)] || 'var(--text-secondary)', fontFamily:'JetBrains Mono', fontSize:'0.72rem', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {typeof val === 'string' ? `"${val.length > 20 ? val.slice(0,20)+'…' : val}"` : String(val)}
                  </span>
                  <span style={{ fontSize:'0.58rem', color:'var(--text-muted)', background:'var(--bg-elevated)', padding:'1px 5px', borderRadius:3, marginLeft:2 }}>{detectType(val)}</span>
                </>}
                {isObj && <span style={{ color:'var(--text-muted)', fontSize:'0.68rem' }}>{'{'}{expanded ? '' : '…}'}</span>}
                {isArr && <span style={{ color:'var(--text-muted)', fontSize:'0.68rem' }}>[{val.length}]{!expanded && arrSampleIsObj ? ' ▸' : ''}</span>}
              </div>
              {/* Expanded children for objects */}
              {isObj && expanded && <TreeNode obj={val} path={fullPath} depth={depth + 1} />}
              {/* Expanded children for arrays — show first element's keys */}
              {isArr && expanded && arrSampleIsObj && (
                <div style={{ marginLeft: depth * 14 + 14, borderLeft:'1px dashed var(--border-subtle)', paddingLeft:6 }}>
                  <div style={{ fontSize:'0.6rem', color:'var(--text-muted)', padding:'2px 6px', fontStyle:'italic' }}>[0] sample:</div>
                  <TreeNode obj={arrSample} path={`${fullPath}[0]`} depth={0} />
                </div>
              )}
            </div>
          );
        };

        return (
          <div style={{ display:'flex', gap:16, alignItems:'flex-start' }}>
            {/* Left: JSON Tree */}
            <div style={{ width:300, flexShrink:0, background:'var(--bg-surface)', border:'1px solid var(--border-default)', borderRadius:10, overflow:'hidden' }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border-subtle)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:'0.78rem', fontWeight:600, color:'var(--text-muted)' }}>Sample Record</span>
                <span style={{ fontSize:'0.65rem', color:'var(--cyan)' }}>click to add →</span>
              </div>
              <div style={{ padding:'8px 6px', maxHeight:420, overflowY:'auto' }}>
                {Object.keys(sample).length > 0
                  ? <TreeNode obj={sample} path="$" depth={0} />
                  : <div style={{ padding:20, textAlign:'center', color:'var(--text-muted)', fontSize:'0.8rem' }}>No preview data.<br/>Go back and Send first.</div>
                }
              </div>
            </div>

            {/* Right: Blueprint Table */}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                <div><h2 style={{ fontSize:'1.1rem' }}>Mapping Blueprints</h2><p style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>Click fields on the left or edit manually</p></div>
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn btn-ghost" onClick={()=>setBPs(a=>[...a,blankBP()])}>+ Field</button>
                  <button className="btn btn-primary" onClick={saveBPs} disabled={bpSaving}>{bpSaving?<span className="spinner"/>:bpSaved?'✓ Saved':'💾 Save'}</button>
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1.2fr 86px 44px 44px 26px', gap:5, fontSize:'0.65rem', color:'var(--text-muted)', textTransform:'uppercase', padding:'0 4px' }}>
                  <span>Field</span><span>JSON Path</span><span>Type</span><span>PK</span><span>Req</span><span/>
                </div>
                {bps.map((bp,i)=>(
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1.2fr 86px 44px 44px 26px', gap:5, padding:'7px 8px', alignItems:'center', background:'var(--bg-elevated)', borderRadius:7, border:'1px solid var(--border-subtle)' }}>
                    <input value={bp.target_field} onChange={e=>upd(i,'target_field',e.target.value)} placeholder="latitude" style={{fontSize:'0.78rem'}} />
                    <input value={bp.json_path} onChange={e=>upd(i,'json_path',e.target.value)} placeholder="$.lat" style={{fontFamily:'JetBrains Mono',fontSize:'0.74rem'}} />
                    <select value={bp.data_type} onChange={e=>upd(i,'data_type',e.target.value)} style={{fontSize:'0.74rem'}}>{TYPES.map(t=><option key={t}>{t}</option>)}</select>
                    <div style={{display:'flex',justifyContent:'center'}}><input type="checkbox" checked={bp.is_primary_key} onChange={e=>upd(i,'is_primary_key',e.target.checked)} /></div>
                    <div style={{display:'flex',justifyContent:'center'}}><input type="checkbox" checked={bp.is_required} onChange={e=>upd(i,'is_required',e.target.checked)} /></div>
                    <button onClick={()=>setBPs(a=>a.filter((_,j)=>j!==i))} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:'0.85rem'}}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ Step 3: DQ Rules ═══ */}
      {step===3 && <div className="card" style={{ padding:24 }}>
        <h2 style={{marginBottom:4}}>Data Quality Rules</h2>
        <p style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:14}}>Python firewall expressions. Optional — skip if not needed.</p>
        {rules.length>0 && <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
          {rules.map(r=>(
            <div key={r.rule_id} style={{padding:'10px 12px',background:'var(--bg-elevated)',borderRadius:8,border:'1px solid var(--border-subtle)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><strong style={{fontSize:'0.82rem'}}>{r.rule_name}</strong><br/><code style={{fontSize:'0.75rem',color:'var(--cyan)',fontFamily:'JetBrains Mono'}}>{r.rule_logic}</code></div>
              <span className="badge badge-amber" style={{fontSize:'0.65rem'}}>{r.action_on_fail}</span>
            </div>
          ))}
        </div>}
        <div style={{padding:14,background:'var(--bg-elevated)',borderRadius:8,border:'1px solid var(--border-subtle)'}}>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div className="field"><label>Rule Name</label><input value={dqForm.rule_name} onChange={e=>setDqForm(f=>({...f,rule_name:e.target.value}))} placeholder="Valid coordinates" /></div>
            <div className="field"><label>Logic (Python)</label><input value={dqForm.rule_logic} onChange={e=>setDqForm(f=>({...f,rule_logic:e.target.value}))} placeholder="latitude > 0" style={{fontFamily:'JetBrains Mono'}} /></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <div className="field"><label>Action</label><select value={dqForm.action_on_fail} onChange={e=>setDqForm(f=>({...f,action_on_fail:e.target.value}))}><option>QUARANTINE</option><option>DROP</option><option>FLAG</option></select></div>
              <div className="field"><label>Severity</label><select value={dqForm.severity} onChange={e=>setDqForm(f=>({...f,severity:e.target.value}))}><option>ERROR</option><option>WARNING</option><option>INFO</option></select></div>
            </div>
            <button className="btn btn-primary" onClick={addRule} disabled={dqAdding} style={{alignSelf:'flex-end'}}>{dqAdding?<span className="spinner"/>:'+ Add Rule'}</button>
          </div>
        </div>
      </div>}

      {/* ═══ Step 4: Launch ═══ */}
      {step===4 && <div className="card" style={{ padding:24 }}>
        <h2 style={{marginBottom:14}}>Review & Launch</h2>
        <div style={{background:'var(--bg-elevated)',borderRadius:8,border:'1px solid var(--border-subtle)',padding:16,marginBottom:16}}>
          {[['Source ID',form.source_id],['API URL',form.api_url],['Method',form.method],['Extraction',form.extraction_path||'(root)'],['Blueprints',`${bps.length} fields`],['DQ Rules',`${rules.length} rules`]].map(([k,v])=>(
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid var(--border-subtle)',fontSize:'0.82rem'}}>
              <span style={{color:'var(--text-muted)'}}>{k}</span>
              <span style={{fontFamily:'JetBrains Mono',color:'var(--text-primary)',maxWidth:360,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</span>
            </div>
          ))}
        </div>
        <div className="field" style={{marginBottom:16}}><label>Poll Interval (seconds)</label><input type="number" value={form.poll_interval_seconds} onChange={e=>set('poll_interval_seconds',e.target.value)} min={10} max={86400} /><p className="field-hint">How often the poller fetches. 86400 = daily.</p></div>
        <div style={{background:'var(--amber-dim)',border:'1px solid hsla(38,95%,58%,0.3)',borderRadius:8,padding:'10px 14px',fontSize:'0.78rem',color:'var(--amber)'}}>⚠ Clicking Launch will start the background poller immediately.</div>
      </div>}

      {/* ═══ Step 5: Done ═══ */}
      {step===5 && result && <div className="card" style={{padding:24,textAlign:'center'}}>
        <div style={{fontSize:'2.5rem'}}>✅</div>
        <h2 style={{marginTop:8}}>API Registered & Polling!</h2>
        <p style={{fontSize:'0.82rem',color:'var(--text-muted)',marginTop:4}}>Pipeline active for <strong style={{color:'var(--cyan)'}}>{result.source_id}</strong></p>
        {result.total_records_found>0 && <p style={{fontSize:'0.78rem',color:'var(--emerald)',marginTop:8}}>First fetch: {result.total_records_found} records</p>}
        <button className="btn btn-ghost" style={{width:'100%',marginTop:16}} onClick={reset}>Register Another</button>
      </div>}

      {/* ═══ Nav ═══ */}
      {step<5 && <div style={{display:'flex',justifyContent:'space-between',marginTop:20}}>
        <button className="btn btn-ghost" onClick={()=>goToStep(step-1)} disabled={step===0}>{step>0?'← Back':''}</button>
        {step===4 ? <button className="btn btn-primary" onClick={launch} disabled={loading}>{loading?<span className="spinner"/>:'🚀 Launch'}</button>
         : <button className="btn btn-primary" onClick={()=>goToStep(step+1)} disabled={!canNext()}>{step===3?'Continue (skip OK) →':'Continue →'}</button>}
      </div>}

      {/* ═══ Activity Log ═══ */}
      {actLog.length > 0 && (
        <div style={{ marginTop:16, border:'1px solid var(--border-subtle)', borderRadius:10, overflow:'hidden' }}>
          <div onClick={()=>setLogOpen(!logOpen)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 14px', background:'var(--bg-elevated)', cursor:'pointer', userSelect:'none' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:'0.75rem', fontWeight:600, color:'var(--text-muted)' }}>Activity Log</span>
              {actLog.length > 0 && (() => { const errs = actLog.filter(l=>l.status==='error').length; const oks = actLog.filter(l=>l.status==='ok').length; return <>
                {oks > 0 && <span style={{ fontSize:'0.65rem', background:'hsla(152,69%,53%,0.15)', color:'#34d399', padding:'1px 7px', borderRadius:4 }}>{oks} ok</span>}
                {errs > 0 && <span style={{ fontSize:'0.65rem', background:'hsla(0,85%,63%,0.15)', color:'#f05050', padding:'1px 7px', borderRadius:4 }}>{errs} error</span>}
              </>; })()}
            </div>
            <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', transition:'transform 0.15s', transform:logOpen?'rotate(180deg)':'rotate(0)' }}>▼</span>
          </div>
          {logOpen && <div style={{ maxHeight:180, overflowY:'auto', padding:'4px 0' }}>
            {actLog.map((l,i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'4px 14px', fontSize:'0.72rem', borderBottom:'1px solid var(--border-subtle)' }}>
                <span style={{ color:'var(--text-muted)', fontFamily:'JetBrains Mono', fontSize:'0.65rem', flexShrink:0 }}>{l.ts}</span>
                <span style={{ width:8, height:8, borderRadius:'50%', flexShrink:0, background: l.status==='ok'?'#34d399':l.status==='error'?'#f05050':'#fbbf24' }} />
                <span style={{ fontWeight:600, color:'var(--text-primary)', flexShrink:0 }}>{l.action}</span>
                <span style={{ color: l.status==='error'?'#f05050':'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, fontFamily:'JetBrains Mono', fontSize:'0.68rem' }}>{l.detail}</span>
              </div>
            ))}
          </div>}
        </div>
      )}
    </div>
  );
}
