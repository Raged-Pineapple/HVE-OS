import React, { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position } from 'reactflow';
import { AlertTriangle, Pin, PinOff, Search, ChevronDown, ChevronRight } from 'lucide-react';
import BaseNode from '../BaseNode';

const getEntityName = (entity, displayProperty) => {
  if (!displayProperty) {
    return entity.name || entity.title || entity.id || entity._hve_id || 'Unknown';
  }
  
  const parts = displayProperty.split('.');
  let current = entity;
  
  for (const part of parts) {
    if (current === null || current === undefined) break;
    current = current[part];
  }
  
  if (current !== null && current !== undefined && typeof current !== 'object') {
    return String(current);
  }
  
  return entity.name || entity.title || entity.id || entity._hve_id || 'Unknown';
};

export const config = {
  type: 'riskCalculator',
  category: 'logic',
  label: 'Risk Calculator',
  icon: AlertTriangle,
  color: '#EF4444',
  hideInSidebar: false,
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('all');
    const [expandedEntities, setExpandedEntities] = useState(new Set());
    const prevPropRef = useRef(formData.displayNameProperty);

    useEffect(() => {
      if (formData.displayNameProperty !== prevPropRef.current) {
        const oldProp = prevPropRef.current;
        const newProp = formData.displayNameProperty;
        
        const sourceData = formData.data || [];
        const allData = Array.isArray(sourceData) ? sourceData : [sourceData];
        
        if (formData.pinnedEntities && formData.pinnedEntities.length > 0 && allData.length > 0) {
           const newPinnedNames = allData
              .filter(ent => formData.pinnedEntities.includes(getEntityName(ent, oldProp)))
              .map(ent => getEntityName(ent, newProp));
           
           if (JSON.stringify(newPinnedNames) !== JSON.stringify(formData.pinnedEntities)) {
             handleChange('pinnedEntities', newPinnedNames);
           }
        }
        prevPropRef.current = newProp;
      }
    }, [formData.displayNameProperty, formData.data, formData.pinnedEntities, handleChange]);

    const availableKeys = new Set();
    const sourceData = formData.data || formData.previewInput || [];
    const dataArray = Array.isArray(sourceData) ? sourceData : (sourceData && typeof sourceData === 'object' ? [sourceData] : []);
    dataArray.forEach(item => {
      Object.keys(item).forEach(k => {
        availableKeys.add(k);
        let val = item[k];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          Object.keys(val).forEach(nk => availableKeys.add(`${k}.${nk}`));
        }
      });
    });
    const keyOptions = Array.from(availableKeys).sort();

    const allData = Array.isArray(formData.data) ? formData.data : (formData.data ? [formData.data] : []);
    const highRisk = Array.isArray(formData.high_risk) ? formData.high_risk : [];
    const mediumRisk = Array.isArray(formData.medium_risk) ? formData.medium_risk : [];
    const lowRisk = Array.isArray(formData.low_risk) ? formData.low_risk : [];

    const riskTabs = [
      { key: 'all', label: 'All Data', data: allData, color: 'var(--text-primary)' },
      { key: 'high', label: 'High', data: highRisk, color: '#EF4444' },
      { key: 'medium', label: 'Medium', data: mediumRisk, color: '#F59E0B' },
      { key: 'low', label: 'Low', data: lowRisk, color: '#10B981' }
    ];

    const activeData = riskTabs.find(t => t.key === activeTab)?.data || [];
    const filteredData = activeData.filter(e => getEntityName(e, formData.displayNameProperty).toLowerCase().includes(searchTerm.toLowerCase()));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Target Field</label>
          <input 
            type="text" 
            value={formData.targetField || 'risk_score'}
            onChange={(e) => handleChange('targetField', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
            placeholder="e.g. risk_score"
          />
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Analysis Depth (Max Hops)</label>
          <input 
            type="number" 
            min="1"
            max="10"
            value={formData.maxHops ?? 3}
            onChange={(e) => {
              const val = e.target.value;
              handleChange('maxHops', val === '' ? '' : parseInt(val, 10));
            }}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          />
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Display Name Property</label>
          <select 
            value={formData.displayNameProperty || ''}
            onChange={(e) => handleChange('displayNameProperty', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          >
            <option value="">-- Default (name, id, title) --</option>
            {keyOptions.map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
            {riskTabs.map(tab => (
              <div
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '4px 8px',
                  fontSize: '0.65rem',
                  cursor: 'pointer',
                  borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : '2px solid transparent',
                  color: activeTab === tab.key ? tab.color : 'var(--text-muted)',
                  fontWeight: activeTab === tab.key ? 600 : 400
                }}
              >
                {tab.label} ({tab.data.length})
              </div>
            ))}
          </div>

          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
            <input 
              placeholder="Search entities..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '4px 8px 4px 26px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-primary)', fontSize: '0.65rem' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, padding: '0 2px' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
              {filteredData.length} results
            </span>
            <div style={{ display: 'flex', gap: 10, fontSize: '0.6rem' }}>
              <span onClick={(e) => { 
                  e.preventDefault(); 
                  const currentPinned = new Set(formData.pinnedEntities || []);
                  filteredData.forEach(ent => currentPinned.add(getEntityName(ent, formData.displayNameProperty)));
                  handleChange('pinnedEntities', Array.from(currentPinned));
                }} style={{ color: 'var(--cyan)', cursor: 'pointer', fontWeight: 600 }}>Pin All</span>
              <span onClick={(e) => { 
                  e.preventDefault(); 
                  const currentPinned = new Set(formData.pinnedEntities || []);
                  filteredData.forEach(ent => currentPinned.delete(getEntityName(ent, formData.displayNameProperty)));
                  handleChange('pinnedEntities', Array.from(currentPinned));
                }} style={{ color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}>Unpin All</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
            {filteredData.map((entity, idx) => {
              const name = getEntityName(entity, formData.displayNameProperty);
              const isPinned = (formData.pinnedEntities || []).includes(name);
              const trace = entity._path_trace || [];
              const isExpanded = expandedEntities.has(name);
              
              return (
                <div key={`pin-${idx}-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div 
                    style={{ 
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: '0.7rem', 
                      color: isPinned ? 'var(--cyan)' : 'var(--text-primary)', 
                      padding: '6px 10px', borderRadius: 6,
                      background: isPinned ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface)',
                      border: `1px solid ${isPinned ? 'var(--cyan)' : 'var(--border-subtle)'}`,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div 
                      onClick={() => {
                        const newExpanded = new Set(expandedEntities);
                        if (isExpanded) newExpanded.delete(name);
                        else newExpanded.add(name);
                        setExpandedEntities(newExpanded);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, cursor: 'pointer', overflow: 'hidden' }}
                    >
                      {trace.length > 0 ? (
                        isExpanded ? <ChevronDown size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} /> : <ChevronRight size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 14, height: 14, flexShrink: 0 }} />
                      )}
                      
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isPinned ? 600 : 400 }}>
                        {name}
                        {entity._risk_score !== undefined && (
                          <span style={{ marginLeft: 8, fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                            Risk: {entity._risk_score} (Base: {entity._base_score})
                          </span>
                        )}
                      </span>
                    </div>

                    <div 
                      onClick={(e) => {
                        e.stopPropagation();
                        const currentPinned = formData.pinnedEntities || [];
                        if (isPinned) {
                          handleChange('pinnedEntities', currentPinned.filter(n => n !== name));
                        } else {
                          handleChange('pinnedEntities', [...currentPinned, name]);
                        }
                      }}
                      style={{ cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
                    >
                      {isPinned ? <Pin size={12} fill="var(--cyan)" color="var(--cyan)" /> : <PinOff size={12} color="var(--text-muted)" style={{ opacity: 0.5 }} />}
                    </div>
                  </div>
                  
                  {isExpanded && trace.length > 0 && (
                    <div style={{ 
                      padding: '8px 10px', 
                      background: 'var(--bg-elevated)', 
                      borderRadius: 6, 
                      borderLeft: '2px solid var(--cyan)',
                      borderRight: '1px solid var(--border-subtle)',
                      borderTop: '1px solid var(--border-subtle)',
                      borderBottom: '1px solid var(--border-subtle)',
                      fontSize: '0.65rem',
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: 8,
                      marginBottom: 8,
                      marginLeft: 14
                    }}>
                      <div style={{ color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>Path Trace Analysis</div>
                      {trace.map((step, sIdx) => (
                        <div key={sIdx} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-primary)' }}>
                            <span style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ color: 'var(--cyan)' }}>[{step.step}]</span>
                              {step.relation}
                            </span>
                            <span style={{ color: step.score > 70 ? '#EF4444' : step.score > 35 ? '#F59E0B' : '#10B981', fontWeight: 600 }}>
                              {step.score}%
                            </span>
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', paddingLeft: 16 }}>
                            ↳ {step.from}
                          </div>
                          {step.reason && (
                            <div style={{ color: 'var(--text-muted)', paddingLeft: 16, marginTop: 2, lineHeight: 1.3 }}>
                              {step.reason}
                            </div>
                          )}
                          {(step.src_node || step.tgt_node) && (
                            <details style={{ paddingLeft: 16, marginTop: 4 }}>
                              <summary style={{ cursor: 'pointer', fontSize: '0.55rem', color: 'var(--cyan)', outline: 'none' }}>View Node Attributes</summary>
                              <div style={{ marginTop: 4, padding: 6, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 4, fontSize: '0.55rem', fontFamily: 'monospace', overflowX: 'auto' }}>
                                {step.src_node && (
                                  <div style={{ marginBottom: 6 }}>
                                    <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 2 }}>Source Node:</strong>
                                    <pre style={{ margin: 0, color: 'var(--text-primary)' }}>{JSON.stringify(step.src_node, null, 2)}</pre>
                                  </div>
                                )}
                                {step.tgt_node && (
                                  <div>
                                    <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 2 }}>Target Node:</strong>
                                    <pre style={{ margin: 0, color: 'var(--text-primary)' }}>{JSON.stringify(step.tgt_node, null, 2)}</pre>
                                  </div>
                                )}
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
};

// Upstream Data Resolver (Do NOT modify this function per Principle 6)
const resolveUpstreamData = (incomingNodes) => {
  for (const n of incomingNodes) {
    if (!n.data) continue;
    const candidates = [n.data.data, n.data.extracted, n.data.resolvedEntity, n.data.pinned, n.data.unpinned];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) return c;
    }
    for (const c of candidates) {
      if (c && typeof c === 'object' && !Array.isArray(c)) return [c];
    }
  }
  return [];
};

export default memo(({ id, data, selected, edges, nodes, setNodes }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // The previewInput Sync Hook
  const prevInputRef = useRef(undefined);
  useEffect(() => {
    if (!edges || !nodes || !setNodes) return;
    
    const incomingEdges = edges.filter(e => e.target === id);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    
    const dataList = resolveUpstreamData(incomingNodes);
    const sampleEntity = dataList.length > 0 ? dataList[0] : null;

    if (sampleEntity) {
      const serialised = JSON.stringify(sampleEntity);
      if (prevInputRef.current !== serialised) {
        prevInputRef.current = serialised;
        setNodes(nds => nds.map(n => 
          n.id === id ? { ...n, data: { ...n.data, previewInput: sampleEntity } } : n
        ));
      }
    }
  }, [edges, id, nodes, setNodes]);

  const pinnedNames = data.pinnedEntities || [];
  const allData = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
  const pinnedEntities = allData.filter(e => pinnedNames.includes(getEntityName(e, data.displayNameProperty)));

  const highRisk   = Array.isArray(data.high_risk)   ? data.high_risk   : [];
  const mediumRisk = Array.isArray(data.medium_risk) ? data.medium_risk : [];
  const lowRisk    = Array.isArray(data.low_risk)    ? data.low_risk    : [];
  const total = highRisk.length + mediumRisk.length + lowRisk.length;

  // Derive query info from the last run's entity metadata
  const sampleEntity = highRisk[0] || mediumRisk[0] || lowRisk[0];
  const targetConcept = sampleEntity?._target_concept || null;
  const relationType  = sampleEntity?._relation_type  || null;
  const topPathScore  = sampleEntity?._path_score     || null;
  const topRiskScore  = sampleEntity?._risk_score     || null;

  // Score range across last run
  const allScored = [...highRisk, ...mediumRisk, ...lowRisk];
  const scores = allScored.map(e => e._risk_score).filter(s => s != null);
  const maxScore = scores.length ? Math.max(...scores).toFixed(1) : null;
  const minScore = scores.length ? Math.min(...scores).toFixed(1) : null;

  // Top high-risk path trace preview
  const topTrace = highRisk[0]?._path_trace;

  const statBar = (color, count, label) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: '0.65rem', color, fontWeight: 700 }}>{count}</span>
      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );

  return (
    <BaseNode
      label={config.label}
      icon={config.icon}
      type={config.type}
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color={config.color}
      collapsedInfo={
        total > 0
          ? <span style={{ display: 'flex', gap: 8, fontSize: '0.65rem' }}>
              <span style={{ color: '#EF4444', fontWeight: 700 }}>{highRisk.length}H</span>
              <span style={{ color: '#F59E0B', fontWeight: 700 }}>{mediumRisk.length}M</span>
              <span style={{ color: '#10B981', fontWeight: 700 }}>{lowRisk.length}L</span>
            </span>
          : <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>No results yet</span>
      }
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>

        {/* Input Handle */}
        <Handle type="target" position={Position.Left} id="data" style={{ left: -6 }} />

        {/* ── Live Stats Bar ── */}
        {total > 0 && (
          <div style={{
            display: 'flex', gap: 4, padding: '6px 8px', marginBottom: 8,
            background: 'var(--bg-surface)', borderRadius: 6,
            border: '1px solid var(--border-subtle)'
          }}>
            {statBar('#EF4444', highRisk.length,   'High')}
            {statBar('#F59E0B', mediumRisk.length, 'Med')}
            {statBar('#10B981', lowRisk.length,    'Low')}
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 4 }}>
              / {total} total
            </span>
          </div>
        )}

        {/* ── Active Query Info ── */}
        {(targetConcept || relationType) && (
          <div style={{
            padding: '6px 8px', marginBottom: 8, borderRadius: 6,
            background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)'
          }}>
            <p style={{ fontSize: '0.6rem', color: 'rgba(139,92,246,0.7)', margin: '0 0 4px' }}>LAST QUERY</p>
            {relationType && (
              <p style={{ fontSize: '0.65rem', color: 'var(--text-primary)', margin: '0 0 2px', fontFamily: 'monospace' }}>
                <span style={{ color: 'rgba(139,92,246,0.9)' }}>[{relationType}]</span>
              </p>
            )}
            {targetConcept && (
              <p style={{ fontSize: '0.65rem', color: 'var(--cyan)', margin: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                → "{targetConcept}"
              </p>
            )}
          </div>
        )}

        {/* ── Score Range ── */}
        {scores.length > 0 && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 8,
            background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border-subtle)'
          }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
              Score range: <span style={{ color: '#10B981' }}>{minScore}</span>
              <span style={{ color: 'var(--text-muted)' }}> → </span>
              <span style={{ color: '#EF4444' }}>{maxScore}</span>
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
              {allScored[0]?._hops != null ? `max ${Math.max(...allScored.map(e => e._hops || 0))} hops` : ''}
            </span>
          </div>
        )}

        {/* ── Top High-Risk Path Trace Preview ── */}
        {topTrace && topTrace.length > 0 && (
          <div style={{
            padding: '6px 8px', marginBottom: 8, borderRadius: 6,
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)'
          }}>
            <p style={{ fontSize: '0.6rem', color: 'rgba(239,68,68,0.7)', margin: '0 0 4px' }}>
              TOP HIGH-RISK PATH — score {topRiskScore}
            </p>
            {topTrace.slice(0, 3).map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 2 }}>
                <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', minWidth: 12, paddingTop: 1 }}>{step.step}.</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '0.6rem', color: 'var(--cyan)', fontFamily: 'monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {step.from}
                  </span>
                  {step.reason && (
                    <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {step.reason.slice(0, 60)}{step.reason.length > 60 ? '…' : ''}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '0.55rem', color: step.score >= 80 ? '#EF4444' : step.score >= 50 ? '#F59E0B' : '#10B981',
                  fontWeight: 700, flexShrink: 0 }}>{step.score}%</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Output Handles ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.75rem', marginTop: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ marginRight: '8px', color: 'var(--text-main)' }}>All Data</span>
            <Handle type="source" position={Position.Right} id="data" style={{ position: 'relative', right: -6, transform: 'none' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ marginRight: '8px', color: '#EF4444' }}>High Risk</span>
            <Handle type="source" position={Position.Right} id="high_risk" style={{ position: 'relative', right: -6, transform: 'none', background: '#EF4444' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ marginRight: '8px', color: '#F59E0B' }}>Medium Risk</span>
            <Handle type="source" position={Position.Right} id="medium_risk" style={{ position: 'relative', right: -6, transform: 'none', background: '#F59E0B' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ marginRight: '8px', color: '#10B981' }}>Low Risk</span>
            <Handle type="source" position={Position.Right} id="low_risk" style={{ position: 'relative', right: -6, transform: 'none', background: '#10B981' }} />
          </div>
        </div>
        
        {pinnedEntities.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>
              <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>
                Pinned — {pinnedEntities.length} entities
              </p>
              <Handle type="source" id="pinned" position={Position.Right} style={{ right: -6, background: 'var(--cyan)', width: 10, height: 10, border: '2px solid var(--bg-surface)' }} />
            </div>
            {pinnedEntities.map((entity, idx) => {
              const name = getEntityName(entity, data.displayNameProperty);
              const uniqueId = entity._hve_id != null ? `hve_${entity._hve_id}` : entity.hve_id != null ? `hve_${entity.hve_id}` : entity.id != null ? `id_${entity.id}` : `idx_${idx}`;
              return (
                <div key={`pinned-${uniqueId}-${name}`} style={{ 
                  position: 'relative', 
                  background: 'var(--bg-elevated)', 
                  padding: '4px 8px', 
                  borderRadius: 4, 
                  fontSize: '0.65rem',
                  border: '1px solid var(--cyan)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  <Pin size={10} color="var(--cyan)" fill="var(--cyan)" />
                  <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                    {name}
                  </span>
                  <Handle 
                    type="source" 
                    id={`entity-out-pinned-${uniqueId}::${name}`}
                    position={Position.Right} 
                    style={{ right: -6, background: 'var(--cyan)', width: 10, height: 10, border: '2px solid var(--bg-surface)', zIndex: 10 }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BaseNode>
  );
});