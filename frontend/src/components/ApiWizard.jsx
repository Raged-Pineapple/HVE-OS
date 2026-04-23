import React, { useState, useEffect } from 'react';
import { previewApi, registerSource, registerApiSource, getBlueprints, setBlueprints, getDQRules, addDQRule, listSources } from '../api/client.js';
import { useToast } from './ToastProvider.jsx';

const Steps = ({ current, steps }) => (
  <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
    {steps.map((s,i) => (
      <React.Fragment key={i}>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:5 }}>
          <div style={{ width:30, height:30, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.75rem', fontWeight:700,
            background: i<current?'var(--cyan)':i===current?'var(--cyan-dim)':'var(--bg-elevated)',
            color: i<current?'hsl(222,28%,6%)':i===current?'var(--cyan)':'var(--text-muted)',
            border: i===current?'2px solid var(--cyan)':'2px solid transparent',
          }}>{i<current?'✓':i+1}</div>
          <span style={{ fontSize:'0.65rem', color:i===current?'var(--cyan)':'var(--text-muted)', fontWeight:i===current?600:400, whiteSpace:'nowrap' }}>{s}</span>
        </div>
        {i<steps.length-1 && <div style={{ flex:1, height:2, background:i<current?'var(--cyan)':'var(--border-subtle)', margin:'-16px 6px 0', minWidth:16 }}/>}
      </React.Fragment>
    ))}
  </div>
);

const TYPES = ['STRING','INT','FLOAT','BOOLEAN','BIGINT','TIMESTAMP'];
const blankBP = () => ({ target_field:'', json_path:'', data_type:'STRING', is_primary_key:false, is_required:false });

export default function ApiWizard() {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ source_id:'', api_url:'', method:'GET', headers:'{}', body_template:'{}', extraction_path:'', poll_interval_seconds:300, description:'' });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  // Preview
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState(null);

  // Blueprints
  const [bps, setBPs] = useState([blankBP()]);
  const [bpSaving, setBpSaving] = useState(false);
  const [bpSaved, setBpSaved] = useState(false);

  // DQ
  const [rules, setRules] = useState([]);
  const [dqForm, setDqForm] = useState({ rule_name:'', rule_logic:'', action_on_fail:'QUARANTINE', severity:'ERROR' });
  const [dqAdding, setDqAdding] = useState(false);

  // Result
  const [result, setResult] = useState(null);

  const wizardSteps = ['API Config','Extraction','Preview','Blueprints','DQ Rules','Launch'];

  // Step 2: fetch preview
  const fetchPreview = async () => {
    setLoading(true); setPreviewErr(null); setPreview(null);
    try {
      const r = await previewApi({ source_id: form.source_id||'preview', api_url:form.api_url, method:form.method, headers:JSON.parse(form.headers||'{}'), body_template:form.method==='POST'?JSON.parse(form.body_template||'{}'):null, extraction_path:form.extraction_path||null, poll_interval_seconds:60 });
      setPreview(r);
      // Auto-generate blueprint suggestions from keys
      if (r.sample_keys?.length) {
        setBPs(r.sample_keys.map(k => ({ target_field:k, json_path:`$.${k}`, data_type:'STRING', is_primary_key:false, is_required:false })));
      }
      toast(`Fetched ${r.total_records} records`, 'success');
    } catch(e) { setPreviewErr(e?.response?.data?.detail || e.message); toast('Preview failed','error'); }
    finally { setLoading(false); }
  };

  // Step 3: pre-register source + save blueprints
  const saveBPs = async () => {
    setBpSaving(true);
    try {
      // Pre-register source if it doesn't exist
      try { await registerSource({ source_id:form.source_id, source_type:'STREAM', protocol:'HTTP', description:form.description||'Pre-registered for blueprints' }); } catch(e) { /* already exists, ok */ }
      await setBlueprints(form.source_id, bps.map(({blueprint_id,source_id,created_at,...r})=>r));
      setBpSaved(true);
      toast('Blueprints saved!','success');
    } catch(e) { toast(e?.response?.data?.detail||'Save failed','error'); }
    finally { setBpSaving(false); }
  };

  // Step 4: add DQ rule
  const addRule = async () => {
    if (!dqForm.rule_name||!dqForm.rule_logic) { toast('Name and logic required','error'); return; }
    setDqAdding(true);
    try {
      const r = await addDQRule(form.source_id, dqForm);
      setRules(arr=>[...arr,r]);
      setDqForm({ rule_name:'', rule_logic:'', action_on_fail:'QUARANTINE', severity:'ERROR' });
      toast('Rule added!','success');
    } catch(e) { toast(e?.response?.data?.detail||'Failed','error'); }
    finally { setDqAdding(false); }
  };

  // Load existing DQ rules when entering step 4
  useEffect(() => {
    if (step===4 && form.source_id) { getDQRules(form.source_id).then(setRules).catch(()=>{}); }
  }, [step]);

  // Step 5: register API and start polling
  const launch = async () => {
    setLoading(true);
    try {
      let headers={}, body=null;
      try { headers=JSON.parse(form.headers||'{}'); } catch {}
      try { body=form.body_template?JSON.parse(form.body_template):null; } catch {}
      const res = await registerApiSource({ source_id:form.source_id, api_url:form.api_url, method:form.method, headers, body_template:body, extraction_path:form.extraction_path||null, poll_interval_seconds:parseInt(form.poll_interval_seconds), description:form.description||null });
      setResult(res); setStep(6); toast('API registered & polling started!','success');
    } catch(e) { toast(e?.response?.data?.detail||'Registration failed','error'); }
    finally { setLoading(false); }
  };

  const reset = () => { setStep(0); setResult(null); setPreview(null); setBPs([blankBP()]); setRules([]); setBpSaved(false); setForm({ source_id:'', api_url:'', method:'GET', headers:'{}', body_template:'{}', extraction_path:'', poll_interval_seconds:300, description:'' }); };

  const canNext = () => {
    if (step===0) return form.source_id.trim().length>0 && form.api_url.trim().length>0;
    if (step===1) return true;
    if (step===2) return preview && preview.total_records>0;
    if (step===3) return bpSaved;
    return true;
  };

  const upd = (i,k,v) => { setBPs(arr=>arr.map((b,idx)=>idx===i?{...b,[k]:v}:b)); setBpSaved(false); };

  return (
    <div className="card" style={{ padding:28, maxWidth:720 }}>
      <h2 style={{ marginBottom:4 }}>API Ingestion Wizard</h2>
      <p style={{ fontSize:'0.82rem', color:'var(--text-muted)', marginBottom:20 }}>Preview → Blueprint → DQ Rules → Launch Polling</p>
      {step<6 && <Steps current={step} steps={wizardSteps} />}

      {/* Step 0: API Config */}
      {step===0 && <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div className="field"><label>Source ID <span style={{color:'var(--rose)'}}>*</span></label><input value={form.source_id} onChange={e=>set('source_id',e.target.value.replace(/\s/g,'_').toLowerCase())} placeholder="e.g. bangalore_military" autoFocus /><p className="field-hint">Unique pipeline ID — becomes your Iceberg table name.</p></div>
        <div className="field"><label>API URL <span style={{color:'var(--rose)'}}>*</span></label><input value={form.api_url} onChange={e=>set('api_url',e.target.value)} placeholder="https://overpass-api.de/api/interpreter?..." /></div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div className="field"><label>Method</label><select value={form.method} onChange={e=>set('method',e.target.value)}><option>GET</option><option>POST</option></select></div>
          <div className="field"><label>Description</label><input value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Optional" /></div>
        </div>
        {form.method==='POST' && <div className="field"><label>Request Body (JSON)</label><textarea value={form.body_template} onChange={e=>set('body_template',e.target.value)} rows={3} /></div>}
        <div className="field"><label>Headers (JSON)</label><textarea value={form.headers} onChange={e=>set('headers',e.target.value)} rows={3} placeholder='{"Authorization":"Bearer TOKEN"}' /></div>
      </div>}

      {/* Step 1: Extraction */}
      {step===1 && <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div className="field"><label>Extraction Path (JSONPath)</label><input value={form.extraction_path} onChange={e=>set('extraction_path',e.target.value)} placeholder="$.elements" autoFocus /><p className="field-hint">Path to the array in the API response. Leave blank if root is already an array.</p></div>
        <div className="field"><label>Poll Interval (seconds)</label><input type="number" value={form.poll_interval_seconds} onChange={e=>set('poll_interval_seconds',e.target.value)} min={10} max={86400} /><p className="field-hint">How often the poller will fetch new data once activated.</p></div>
      </div>}

      {/* Step 2: Preview */}
      {step===2 && <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        {!preview && !previewErr && <div style={{ textAlign:'center', padding:20 }}>
          <p style={{ color:'var(--text-secondary)', marginBottom:16 }}>Fetch raw data from the API to inspect before defining your schema.</p>
          <button className="btn btn-primary" onClick={fetchPreview} disabled={loading}>{loading?<><span className="spinner"/>Fetching...</>:'🔍 Fetch Preview'}</button>
        </div>}
        {previewErr && <div style={{ background:'var(--rose-dim)', border:'1px solid hsla(352,85%,50%,0.3)', borderRadius:8, padding:'10px 14px', fontSize:'0.8rem', color:'var(--rose)' }}>{previewErr}<br/><button className="btn btn-ghost" style={{marginTop:8}} onClick={()=>{setPreviewErr(null);setStep(1);}}>← Fix extraction path</button></div>}
        {preview && <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <span style={{ color:'var(--emerald)', fontWeight:600 }}>✓ {preview.total_records} records found</span>
            <span style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>Keys: {preview.sample_keys?.join(', ')}</span>
          </div>
          <div style={{ maxHeight:280, overflowY:'auto', background:'var(--bg-elevated)', borderRadius:8, padding:12, fontFamily:'JetBrains Mono', fontSize:'0.72rem', color:'var(--text-secondary)' }}>
            <pre style={{ margin:0, whiteSpace:'pre-wrap', wordBreak:'break-all' }}>{JSON.stringify(preview.preview?.slice(0,5), null, 2)}</pre>
          </div>
        </div>}
      </div>}

      {/* Step 3: Blueprints */}
      {step===3 && <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div><h3>Mapping Blueprints</h3><p style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>Map raw JSON fields to typed Iceberg columns</p></div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-ghost" onClick={()=>setBPs(a=>[...a,blankBP()])}>+ Field</button>
            <button className="btn btn-primary" onClick={saveBPs} disabled={bpSaving}>{bpSaving?<span className="spinner"/>:bpSaved?'✓ Saved':'💾 Save'}</button>
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1.2fr 90px 50px 50px 28px', gap:6, fontSize:'0.68rem', color:'var(--text-muted)', textTransform:'uppercase', padding:'0 4px' }}>
            <span>Field</span><span>JSON Path</span><span>Type</span><span>PK</span><span>Req</span><span/>
          </div>
          {bps.map((bp,i)=>(
            <div key={i} className="card" style={{ display:'grid', gridTemplateColumns:'1fr 1.2fr 90px 50px 50px 28px', gap:6, padding:'8px 10px', alignItems:'center', background:'var(--bg-elevated)' }}>
              <input value={bp.target_field} onChange={e=>upd(i,'target_field',e.target.value)} placeholder="latitude" />
              <input value={bp.json_path} onChange={e=>upd(i,'json_path',e.target.value)} placeholder="$.lat" style={{fontFamily:'JetBrains Mono',fontSize:'0.76rem'}} />
              <select value={bp.data_type} onChange={e=>upd(i,'data_type',e.target.value)}>{TYPES.map(t=><option key={t}>{t}</option>)}</select>
              <div style={{display:'flex',justifyContent:'center'}}><input type="checkbox" checked={bp.is_primary_key} onChange={e=>upd(i,'is_primary_key',e.target.checked)} /></div>
              <div style={{display:'flex',justifyContent:'center'}}><input type="checkbox" checked={bp.is_required} onChange={e=>upd(i,'is_required',e.target.checked)} /></div>
              <button onClick={()=>setBPs(a=>a.filter((_,j)=>j!==i))} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:'0.9rem'}}>✕</button>
            </div>
          ))}
        </div>
      </div>}

      {/* Step 4: DQ Rules */}
      {step===4 && <div>
        <h3 style={{marginBottom:4}}>Data Quality Rules</h3>
        <p style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:14}}>Python expressions that firewall records before Silver. Optional — skip if not needed.</p>
        {rules.length>0 && <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
          {rules.map(r=>(
            <div key={r.rule_id} className="card" style={{padding:'10px 12px',background:'var(--bg-elevated)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><strong style={{fontSize:'0.82rem'}}>{r.rule_name}</strong><br/><code style={{fontSize:'0.75rem',color:'var(--cyan)',fontFamily:'JetBrains Mono'}}>{r.rule_logic}</code></div>
              <span className="badge badge-amber" style={{fontSize:'0.65rem'}}>{r.action_on_fail}</span>
            </div>
          ))}
        </div>}
        <div className="card" style={{padding:14,background:'var(--bg-elevated)'}}>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div className="field"><label>Rule Name</label><input value={dqForm.rule_name} onChange={e=>setDqForm(f=>({...f,rule_name:e.target.value}))} placeholder="Must have valid id" /></div>
            <div className="field"><label>Logic (Python)</label><input value={dqForm.rule_logic} onChange={e=>setDqForm(f=>({...f,rule_logic:e.target.value}))} placeholder="latitude > 0" style={{fontFamily:'JetBrains Mono'}} /></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <div className="field"><label>Action</label><select value={dqForm.action_on_fail} onChange={e=>setDqForm(f=>({...f,action_on_fail:e.target.value}))}><option>QUARANTINE</option><option>DROP</option><option>FLAG</option></select></div>
              <div className="field"><label>Severity</label><select value={dqForm.severity} onChange={e=>setDqForm(f=>({...f,severity:e.target.value}))}><option>ERROR</option><option>WARNING</option><option>INFO</option></select></div>
            </div>
            <button className="btn btn-primary" onClick={addRule} disabled={dqAdding} style={{alignSelf:'flex-end'}}>{dqAdding?<span className="spinner"/>:'+ Add Rule'}</button>
          </div>
        </div>
      </div>}

      {/* Step 5: Review & Launch */}
      {step===5 && <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div className="card" style={{padding:16,background:'var(--bg-elevated)'}}>
          {[['Source ID',form.source_id],['API URL',form.api_url],['Method',form.method],['Poll Interval',`${form.poll_interval_seconds}s`],['Extraction',form.extraction_path||'(root)'],['Blueprints',`${bps.length} fields`],['DQ Rules',`${rules.length} rules`]].map(([k,v])=>(
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid var(--border-subtle)',fontSize:'0.82rem'}}>
              <span style={{color:'var(--text-muted)'}}>{k}</span>
              <span style={{fontFamily:'JetBrains Mono',color:'var(--text-primary)',maxWidth:320,overflow:'hidden',textOverflow:'ellipsis'}}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{background:'var(--amber-dim)',border:'1px solid hsla(38,95%,58%,0.3)',borderRadius:8,padding:'10px 14px',fontSize:'0.78rem',color:'var(--amber)'}}>⚠ Clicking Launch will start the background poller immediately.</div>
      </div>}

      {/* Step 6: Done */}
      {step===6 && result && <div style={{textAlign:'center',padding:'16px 0'}}>
        <div style={{fontSize:'2.5rem'}}>✅</div>
        <h2 style={{marginTop:8}}>API Registered & Polling!</h2>
        <p style={{fontSize:'0.82rem',color:'var(--text-muted)',marginTop:4}}>Pipeline active for <strong style={{color:'var(--cyan)'}}>{result.source_id}</strong></p>
        {result.total_records_found>0 && <p style={{fontSize:'0.78rem',color:'var(--emerald)',marginTop:8}}>First fetch: {result.total_records_found} records found</p>}
        <button className="btn btn-ghost" style={{width:'100%',marginTop:16}} onClick={reset}>Register Another</button>
      </div>}

      {/* Nav buttons */}
      {step<6 && <div style={{display:'flex',justifyContent:'space-between',marginTop:24}}>
        <button className="btn btn-ghost" onClick={()=>setStep(s=>s-1)} disabled={step===0}>{step>0?'← Back':''}</button>
        {step===2 && !preview ? <button className="btn btn-primary" onClick={fetchPreview} disabled={loading}>{loading?<span className="spinner"/>:'🔍 Fetch'}</button>
         : step===5 ? <button className="btn btn-primary" onClick={launch} disabled={loading}>{loading?<span className="spinner"/>:'🚀 Launch'}</button>
         : <button className="btn btn-primary" onClick={()=>setStep(s=>s+1)} disabled={!canNext()}>{step===4?'Continue (skip OK) →':'Continue →'}</button>}
      </div>}
    </div>
  );
}
