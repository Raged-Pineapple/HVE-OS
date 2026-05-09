import React, { memo, useState, useEffect, useMemo } from 'react';
import { Handle, Position, useEdges } from 'reactflow';
import { Fingerprint, Tags, Layers, Pin, PinOff } from 'lucide-react';
import BaseNode from '../BaseNode';

export const config = {
  type: 'extractEntities',
  category: 'logic',
  label: 'Extract Entities',
  icon: Fingerprint,
  color: '#3B82F6',
  hideInSidebar: false,
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const incomingEdges = edges.filter(e => e.target === nodeId);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);

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

const getEntityName = (entity, displayProperty) => {
  if (!displayProperty) {
    return entity.name || entity.id || entity.title || 'Unknown';
  }
  
  const parts = displayProperty.split('.');
  let current = entity;
  
  for (const part of parts) {
    if (current === null || current === undefined) break;
    if (typeof current === 'string' && current.trim().startsWith('{')) {
      try {
        current = JSON.parse(current);
      } catch (e) {}
    }
    current = current[part];
  }
  
  if (current !== null && current !== undefined && typeof current !== 'object') {
    return String(current);
  }
  
  return entity.name || entity.id || 'Unknown';
};

export default memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputData, setInputData] = useState(null);
  const edges = useEdges();

  const extracted = data.extracted || [];
  const pinned = data.pinned || [];
  const unpinned = data.unpinned || [];
  const pinnedNames = data.pinnedEntities || [];

  const myIncomingEdges = useMemo(() => edges.filter(e => e.target === data.id), [edges, data.id]);
  const connectedSourceIds = useMemo(() => myIncomingEdges.map(e => e.source), [myIncomingEdges]);

  useEffect(() => {
    const handleInputUpdate = (event) => {
      const { outputs, nodeId } = event.detail;
      
      if (!connectedSourceIds.includes(nodeId)) return;
      
      if (outputs && outputs.data) {
        setInputData(outputs.data);
        
        if (outputs.data.length > 0 && extracted.length === 0) {
          fetch('http://localhost:8000/api/v1/nodes/execute/extractEntities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              inputs: { data: outputs.data }, 
              config: { strategy: data.strategy || 'NER' } 
            })
          }).then(r => r.json()).then(result => {
            if (result.success && result.outputs) {
              window.dispatchEvent(new CustomEvent('node-output-updated', {
                detail: { nodeId: data.id, outputs: result.outputs }
              }));
            }
          }).catch(err => console.error('Auto-execute failed:', err));
        }
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
      <Handle 
        type="source" 
        position={Position.Right} 
        id="extracted" 
        style={{ 
          right: -6, 
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'var(--cyan)', 
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
        {isExpanded && extracted.length > 0 && (
          <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Tags size={12} color="var(--accent-blue)" />
              <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>
                Extracted: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{totalEntities}</span>
              </p>
            </div>

            {(extracted.length > 0 || pinnedEntities.length > 0) && (
              <>
                {pinnedEntities.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 4px 0' }}>
                      Pinned — {pinnedEntities.length} entities
                    </p>
                    {pinnedEntities.slice(0, 3).map((entity, idx) => {
                      const name = getEntityName(entity, data.displayNameProperty);
                      return (
                        <div key={`pinned-${idx}-${name}`} style={{ 
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
                            id={`entity-out-pinned-${name}`}
                            position={Position.Right} 
                            style={{ right: -6, background: 'var(--cyan)', width: 10, height: 10, border: '2px solid var(--bg-surface)' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {unpinned.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                    <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 4px 0' }}>
                      Unpinned — {unpinned.length} entities
                    </p>
                    {unpinned.slice(0, 5).map((entity, idx) => {
                      const name = getEntityName(entity, data.displayNameProperty);
                      return (
                        <div key={`unpinned-${idx}-${name}`} style={{ 
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
                            id={`entity-out-${name}`}
                            position={Position.Right} 
                            style={{ right: -6, background: 'var(--cyan)', width: 10, height: 10, border: '2px solid var(--bg-surface)' }}
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