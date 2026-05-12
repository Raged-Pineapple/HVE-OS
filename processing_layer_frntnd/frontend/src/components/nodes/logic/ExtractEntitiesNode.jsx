import React, { memo, useState, useEffect, useMemo, useRef } from 'react';
import { Handle, Position, useEdges, useUpdateNodeInternals } from 'reactflow';
import { Fingerprint, Tags, Layers, Pin, PinOff, Search } from 'lucide-react';
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
  type: 'extractEntities',
  category: 'logic',
  label: 'Extract Entities',
  icon: Fingerprint,
  color: '#3B82F6',
  hideInSidebar: false,
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const prevPropRef = useRef(formData.displayNameProperty);

    useEffect(() => {
      if (formData.displayNameProperty !== prevPropRef.current) {
        const oldProp = prevPropRef.current;
        const newProp = formData.displayNameProperty;
        
        if (formData.pinnedEntities && formData.pinnedEntities.length > 0 && formData.extracted) {
           const newPinnedNames = formData.extracted
              .filter(ent => formData.pinnedEntities.includes(getEntityName(ent, oldProp)))
              .map(ent => getEntityName(ent, newProp));
           
           if (JSON.stringify(newPinnedNames) !== JSON.stringify(formData.pinnedEntities)) {
             handleChange('pinnedEntities', newPinnedNames);
           }
        }
        prevPropRef.current = newProp;
      }
    }, [formData.displayNameProperty, formData.extracted, formData.pinnedEntities, handleChange]);

    const incomingEdges = edges.filter(e => e.target === nodeId);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);

    const availableKeys = new Set();
    const sourceData = formData.extracted || formData.data || [];
    sourceData.forEach(item => {
      Object.keys(item).forEach(k => {
        availableKeys.add(k);
        let val = item[k];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          Object.keys(val).forEach(nk => availableKeys.add(`${k}.${nk}`));
        }
      });
    });
    const keyOptions = Array.from(availableKeys).sort();

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Strategy</label>
          <select 
            value={formData.strategy || 'NER'} 
            onChange={(e) => handleChange('strategy', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          >
            <option value="NER">NER (Named Entity Recognition)</option>
            <option value="KeyPath">KeyPath</option>
            <option value="Label">Label</option>
            <option value="Regex">Regex</option>
          </select>
        </div>

        {(formData.strategy === 'KeyPath' || formData.strategy === 'Label' || formData.strategy === 'Regex') && (
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              {formData.strategy === 'KeyPath' ? 'Key Path' : formData.strategy === 'Regex' ? 'Regex Pattern' : 'Label Filter'}
            </label>
            <input 
              type="text" 
              value={formData.keyPath || formData.label || formData.regexPattern || ''}
              onChange={(e) => {
                if (formData.strategy === 'KeyPath') handleChange('keyPath', e.target.value);
                else if (formData.strategy === 'Regex') handleChange('regexPattern', e.target.value);
                else handleChange('label', e.target.value);
              }}
              style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem', fontFamily: 'monospace' }}
              placeholder={formData.strategy === 'KeyPath' ? 'e.g. origin_country' : 'pattern...'}
            />
          </div>
        )}

        {formData.strategy === 'Label' && (
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Entity Label</label>
            <input 
              type="text" 
              value={formData.label || ''}
              onChange={(e) => handleChange('label', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
              placeholder="e.g. aircraft"
            />
          </div>
        )}

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Display Name Property</label>
          <select 
            value={formData.displayNameProperty || ''}
            onChange={(e) => {
              handleChange('displayNameProperty', e.target.value);
            }}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          >
            <option value="">-- Default (name, id, title) --</option>
            {keyOptions.map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        {formData.extracted && formData.extracted.length > 0 && (
          <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', margin: 0 }}>Pin Entities</label>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                <span>{(formData.pinnedEntities || []).length} pinned</span>
                {(formData.pinnedEntities || []).length > 0 && (
                  <span 
                    onClick={(e) => { e.preventDefault(); handleChange('pinnedEntities', []); }}
                    style={{ color: 'var(--accent-blue)', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Clear
                  </span>
                )}
              </div>
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
                {formData.extracted.filter(e => getEntityName(e, formData.displayNameProperty).toLowerCase().includes(searchTerm.toLowerCase())).length} results
              </span>
              <div style={{ display: 'flex', gap: 10, fontSize: '0.6rem' }}>
                <span onClick={(e) => { 
                    e.preventDefault(); 
                    const currentPinned = new Set(formData.pinnedEntities || []);
                    formData.extracted.filter(ent => getEntityName(ent, formData.displayNameProperty).toLowerCase().includes(searchTerm.toLowerCase())).forEach(ent => currentPinned.add(getEntityName(ent, formData.displayNameProperty)));
                    handleChange('pinnedEntities', Array.from(currentPinned));
                  }} style={{ color: 'var(--cyan)', cursor: 'pointer', fontWeight: 600 }}>Pin All</span>
                <span onClick={(e) => { 
                    e.preventDefault(); 
                    const currentPinned = new Set(formData.pinnedEntities || []);
                    formData.extracted.filter(ent => getEntityName(ent, formData.displayNameProperty).toLowerCase().includes(searchTerm.toLowerCase())).forEach(ent => currentPinned.delete(getEntityName(ent, formData.displayNameProperty)));
                    handleChange('pinnedEntities', Array.from(currentPinned));
                  }} style={{ color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}>Unpin All</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
              {formData.extracted
                .filter(entity => getEntityName(entity, formData.displayNameProperty).toLowerCase().includes(searchTerm.toLowerCase()))
                .map((entity, idx) => {
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
        )}

        {incomingNodes.length > 0 && (
          <div style={{ padding: '8px', background: 'var(--bg-elevated)', borderRadius: 6, fontSize: '0.65rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Source: </span>
            <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{incomingNodes[0].data.source_id || incomingNodes[0].data.id}</span>
          </div>
        )}
      </div>
    );
  }
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [inputData, setInputData] = useState(null);
  const edges = useEdges();
  const updateNodeInternals = useUpdateNodeInternals();

  const extracted = data.extracted || [];
  const pinned = data.pinned || [];
  const unpinned = data.unpinned || [];
  const pinnedNames = data.pinnedEntities || [];

  const myIncomingEdges = useMemo(() => edges.filter(e => e.target === id), [edges, id]);
  const connectedSourceIds = useMemo(() => myIncomingEdges.map(e => e.source), [myIncomingEdges]);

  useEffect(() => {
    const handleInputUpdate = (event) => {
      const { outputs, nodeId } = event.detail;
      
      if (!connectedSourceIds.includes(nodeId)) return;
      
      if (outputs && outputs.data) {
        setInputData(outputs.data);
      }
    };
    
    window.addEventListener('source-node-updated', handleInputUpdate);
    return () => window.removeEventListener('source-node-updated', handleInputUpdate);
  }, [connectedSourceIds]);

  const pinnedEntities = pinned.length > 0 ? pinned : extracted.filter(e => pinnedNames.includes(getEntityName(e, data.displayNameProperty)));

  const strategy = data.strategy || 'NER';
  const totalEntities = extracted.length;

  const effectiveData = inputData || extracted;
  const effectiveCount = effectiveData.length;

  useEffect(() => {
    updateNodeInternals(id);
  }, [
    id,
    updateNodeInternals,
    isExpanded,
    data.displayNameProperty,
    data.extracted,
    data.pinnedEntities,
    data.pinned,
    data.unpinned
  ]);

  return (
    <div style={{ position: 'relative' }}>
      <Handle 
        type="target" 
        position={Position.Left} 
        id="data" 
        style={{ 
          left: -6, 
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'var(--amber)', 
          width: 12, 
          height: 12, 
          border: '2px solid var(--bg-surface)',
          zIndex: 10
        }} 
      />
      
      <BaseNode
        label={data.label || config.label}
        icon={config.icon}
        type={config.type}
        data={data}
        selected={selected}
        isExpanded={isExpanded}
        setIsExpanded={setIsExpanded}
        color={config.color}
        hideDefaultSource={true}
        hideDefaultTarget={true}
        collapsedInfo={<><span style={{ textTransform: 'uppercase' }}>{strategy}</span>{totalEntities > 0 ? <span style={{ marginLeft: 8, color: 'var(--cyan)' }}>· {totalEntities} extracted</span> : inputData ? <span style={{ marginLeft: 8, color: 'var(--amber)' }}>· {inputData.length} input</span> : null}</>}
      >
        {extracted.length > 0 && (
          <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, padding: '4px 8px', background: 'rgba(59,130,246,0.05)', borderRadius: 4, border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tags size={12} color="var(--accent-blue)" />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  All Extracted: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{totalEntities}</span>
                </span>
              </div>
              <Handle type="source" id="extracted" position={Position.Right} style={{ right: -6, background: 'var(--accent-blue)', width: 10, height: 10, border: '2px solid var(--bg-surface)' }} />
            </div>

            {(extracted.length > 0 || pinnedEntities.length > 0) && (
              <>
                {pinnedEntities.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
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

                {unpinned.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>
                      <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>
                        Unpinned — {unpinned.length} entities
                      </p>
                      <Handle type="source" id="unpinned" position={Position.Right} style={{ right: -6, background: 'var(--text-muted)', width: 10, height: 10, border: '2px solid var(--bg-surface)' }} />
                    </div>
                    {unpinned.slice(0, 10).map((entity, idx) => {
                      const name = getEntityName(entity, data.displayNameProperty);
                      const uniqueId = entity._hve_id != null ? `hve_${entity._hve_id}` : entity.hve_id != null ? `hve_${entity.hve_id}` : entity.id != null ? `id_${entity.id}` : `idx_${idx}`;
                      return (
                        <div key={`unpinned-${uniqueId}-${name}`} style={{ 
                          position: 'relative', 
                          background: 'var(--bg-elevated)', 
                          padding: '4px 8px', 
                          borderRadius: 4, 
                          fontSize: '0.65rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}>
                          <Layers size={10} color="var(--text-muted)" />
                          <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                            {name}
                          </span>
                          <Handle 
                            type="source" 
                            id={`entity-out-${uniqueId}::${name}`}
                            position={Position.Right} 
                            style={{ right: -6, background: 'var(--cyan)', width: 10, height: 10, border: '2px solid var(--bg-surface)', zIndex: 10 }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </BaseNode>
    </div>
  );
});