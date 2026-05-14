import React, { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position } from 'reactflow';
import { AlertTriangle, Pin, PinOff, Search } from 'lucide-react';
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

    const tabs = [
      { key: 'all', label: 'All Data', data: allData, color: 'var(--text-primary)' },
      { key: 'high', label: 'High', data: highRisk, color: '#EF4444' },
      { key: 'medium', label: 'Medium', data: mediumRisk, color: '#F59E0B' },
      { key: 'low', label: 'Low', data: lowRisk, color: '#10B981' }
    ];

    const activeData = tabs.find(t => t.key === activeTab)?.data || [];
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
            {tabs.map(tab => (
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
              return (
                <div 
                  key={`pin-${idx}-${name}`} 
                  onClick={() => {
                    const currentPinned = formData.pinnedEntities || [];
                    if (isPinned) {
                      handleChange('pinnedEntities', currentPinned.filter(n => n !== name));
                    } else {
                      handleChange('pinnedEntities', [...currentPinned, name]);
                    }
                  }}
                  style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: '0.7rem', 
                    color: isPinned ? 'var(--cyan)' : 'var(--text-primary)', 
                    cursor: 'pointer', padding: '6px 10px', borderRadius: 6,
                    background: isPinned ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface)',
                    border: `1px solid ${isPinned ? 'var(--cyan)' : 'var(--border-subtle)'}`,
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isPinned ? 600 : 400 }}>{name}</span>
                  {isPinned ? <Pin size={12} fill="var(--cyan)" color="var(--cyan)" style={{ flexShrink: 0 }} /> : <PinOff size={12} color="var(--text-muted)" style={{ flexShrink: 0, opacity: 0.5 }} />}
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

  return (
    <BaseNode
      label={data.label || config.label}
      icon={config.icon}
      type={config.type}
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color={config.color}
      collapsedInfo={<span style={{ color: 'var(--text-muted)' }}>Analyzes Risk Exposure</span>}
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        
        {/* Universal Input Handle */}
        <Handle type="target" position={Position.Left} id="data" style={{ left: -6 }} />
        
        {/* Distributed Routing Handles */}
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