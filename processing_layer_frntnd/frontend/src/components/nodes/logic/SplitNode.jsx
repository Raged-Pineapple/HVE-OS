import React, { memo, useState, useEffect, useRef } from 'react';
import { useEdges, useNodes, Handle, Position, useReactFlow } from 'reactflow';
import { Split, FileJson, Layers, Search, CheckCircle2 } from 'lucide-react';
import BaseNode from '../BaseNode';

const parseNestedValue = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const isEncryptedValue = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) && value.__type__ === 'tenseal_encrypted'
);

const getExplodedAttributes = (entity) => {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return [];

  const attributes = [];

  Object.entries(entity).forEach(([key, rawValue]) => {
    const parsedValue = parseNestedValue(rawValue);
    attributes.push({ key, value: parsedValue, handleId: `attr-out-${key}` });

    if (
      parsedValue &&
      typeof parsedValue === 'object' &&
      !Array.isArray(parsedValue) &&
      !isEncryptedValue(parsedValue)
    ) {
      Object.entries(parsedValue).forEach(([subKey, subValue]) => {
        attributes.push({
          key: `${key}.${subKey}`,
          value: subValue,
          handleId: `attr-out-${key}.${subKey}`,
        });
      });
    }
  });

  return attributes;
};

const formatAttributeValue = (value, autoEncryptNumericals = false) => {
  if (value === undefined) return 'null';
  if (autoEncryptNumericals && typeof value === 'number') {
    return '{"__type__": "tenseal_..."}';
  }
  if (isEncryptedValue(value)) {
    return '{"__type__": "tenseal_..."}';
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
};

const resolveUpstreamData = (incomingNodes, specificEntityEdge = null) => {
  for (const n of incomingNodes) {
    if (!n.data) continue;
    
    // PRIORITY 1: If we have a specific connected handle, and its data exists, return it immediately as an array of 1
    if (specificEntityEdge && n.id === specificEntityEdge.source && n.data[specificEntityEdge.sourceHandle]) {
      return [n.data[specificEntityEdge.sourceHandle]];
    }

    const candidates = [n.data.data, n.data.extracted, n.data.resolvedEntity, n.data.pinned, n.data.unpinned];
    
    // PRIORITY 2: Look for any non-empty array in the generic outputs
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) return c;
    }
    
    // PRIORITY 3: Look for any valid object in the generic outputs
    for (const c of candidates) {
      if (c && typeof c === 'object' && !Array.isArray(c)) return [c];
    }
  }
  return [];
};

export const config = {
  type: 'split',
  category: 'logic',
  label: 'Explode Attributes',
  icon: Split,
  color: 'var(--accent-blue)',
  SettingsForm: SplitSettingsForm,
};

function SplitSettingsForm({ nodeId, formData, handleChange, nodes, edges }) {
    const [entities, setEntities] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const incomingEdges = edges.filter(e => e.target === nodeId);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    const specificEntityEdge = incomingEdges.find(e => e.sourceHandle && e.sourceHandle.startsWith('entity-out-'));

    useEffect(() => {
      if (incomingNodes.length > 0) {
        setLoading(true);
        
        const dataList = resolveUpstreamData(incomingNodes, specificEntityEdge);
            setEntities(dataList);
            if (specificEntityEdge) {
              let specificName = specificEntityEdge.sourceHandle;
              let specificId = null;
              
              if (specificName.startsWith('entity-out-pinned-')) {
                specificName = specificName.replace('entity-out-pinned-', '');
              } else if (specificName.startsWith('entity-out-')) {
                specificName = specificName.replace('entity-out-', '');
              }
              
              if (specificName.includes('::')) {
                const parts = specificName.split('::');
                specificId = parts[0];
                specificName = parts.slice(1).join('::');
              }
              
              // Generically attempt to respect the display name property of the immediate parent
              const sourceNode = incomingNodes.find(n => n.data?.displayNameProperty);
              const propToUse = sourceNode?.data?.displayNameProperty || formData.displayNameProperty;
              
              const idx = dataList.findIndex((e, i) => {
                const eUniqueId = e._hve_id != null ? `hve_${e._hve_id}` : e.hve_id != null ? `hve_${e.hve_id}` : e.id != null ? `id_${e.id}` : `idx_${i}`;
                if (specificId !== null && eUniqueId === specificId) return true;
                let customName = null;
                if (propToUse) {
                  const parts = propToUse.split('.');
                  let current = e;
                  for (let p of parts) {
                    if (current === null || current === undefined) break;
                    current = current[p];
                  }
                  if (current !== null && current !== undefined && typeof current !== 'object') {
                    customName = String(current);
                  }
                }
                const name = customName || e.name || e.title || e.id || e._hve_id || `Entity ${i + 1}`;
                return name === specificName;
              });
              
              if (idx !== -1 && formData.selectedEntityIndex !== idx) {
                // Auto update selected index
                setTimeout(() => handleChange('selectedEntityIndex', idx), 0);
              }
            }
            else if (dataList.length > 0 && (formData.selectedEntityIndex === undefined || formData.selectedEntityIndex === '')) {
              setTimeout(() => handleChange('selectedEntityIndex', 0), 0);
            }
        
        setLoading(false);
      } else {
        setEntities([]);
      }
    }, [incomingNodes.length, nodes, edges, specificEntityEdge, formData.displayNameProperty, formData.selectedEntityIndex]);

    const selectedEntityIndex = formData.selectedEntityIndex;
    const selectedEntity = selectedEntityIndex !== undefined && selectedEntityIndex !== '' ? entities[selectedEntityIndex] : null;
    const explodedAttributes = getExplodedAttributes(selectedEntity);

    // Parse keys directly from entities
    const availableKeys = new Set();
    entities.forEach(item => {
      Object.keys(item).forEach(k => {
        availableKeys.add(k);
        let val = item[k];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          Object.keys(val).forEach(nk => availableKeys.add(`${k}.${nk}`));
        }
      });
    });
    const keyOptions = Array.from(availableKeys).sort();

    const getDisplayName = (ent, idx) => {
      if (formData.displayNameProperty) {
        const parts = formData.displayNameProperty.split('.');
        let current = ent;
        for (let i = 0; i < parts.length; i++) {
          if (current === null || current === undefined) break;
          current = current[parts[i]];
        }
        if (current !== null && current !== undefined && typeof current !== 'object') {
          return String(current);
        }
      }
      return ent.name || ent.title || ent.id || ent._hve_id || `Entity ${idx + 1}`;
    };

    const isAutoSelected = !!specificEntityEdge;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input 
            type="checkbox" 
            id={`auto-encrypt-${nodeId}`}
            checked={formData.autoEncryptNumericals || false}
            onChange={(e) => handleChange('autoEncryptNumericals', e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor={`auto-encrypt-${nodeId}`} style={{ fontSize: '0.75rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
            Auto Encrypt Numericals
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input 
            type="checkbox" 
            id={`auto-decrypt-${nodeId}`}
            checked={formData.autoDecryptValues || false}
            onChange={(e) => handleChange('autoDecryptValues', e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor={`auto-decrypt-${nodeId}`} style={{ fontSize: '0.75rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
            Auto Decrypt Encrypted Values
          </label>
        </div>
        {!isAutoSelected && (
          <>
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

                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>Select Entity to Explode</label>
              {loading ? (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Loading entities...</p>
              ) : entities.length > 0 ? (
                    <>
                      <div style={{ position: 'relative', marginBottom: 8 }}>
                        <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                        <input 
                          placeholder="Search entities..."
                          value={searchTerm}
                          onChange={e => setSearchTerm(e.target.value)}
                          style={{ width: '100%', padding: '4px 8px 4px 26px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-primary)', fontSize: '0.65rem' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto', paddingRight: 4 }}>
                        {entities
                          .map((ent, idx) => ({ ent, idx, name: getDisplayName(ent, idx) }))
                          .filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
                          .map(({ ent, idx, name }) => {
                            const isSelected = String(formData.selectedEntityIndex) === String(idx);
                            return (
                              <div 
                                key={idx} 
                                onClick={() => handleChange('selectedEntityIndex', idx)}
                                style={{ 
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: '0.7rem', 
                                  color: isSelected ? 'var(--cyan)' : 'var(--text-primary)', 
                                  cursor: 'pointer', padding: '6px 10px', borderRadius: 6,
                                  background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface)',
                                  border: `1px solid ${isSelected ? 'var(--cyan)' : 'var(--border-subtle)'}`,
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 600 : 400 }}>{name}</span>
                                {isSelected && <CheckCircle2 size={14} color="var(--cyan)" style={{ flexShrink: 0 }} />}
                              </div>
                            );
                        })}
                      </div>
                    </>
              ) : (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Connect a data source to see available entities.
                </p>
              )}
            </div>
          </>
        )}

        {(selectedEntity || isAutoSelected) && (
          <div style={{ borderTop: isAutoSelected ? 'none' : '1px solid var(--border-subtle)', paddingTop: isAutoSelected ? 0 : 16 }}>
            {isAutoSelected && (
              <div style={{ marginBottom: 12, padding: '8px', background: 'rgba(52, 211, 153, 0.1)', border: '1px solid var(--emerald)', borderRadius: 6 }}>
                <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--emerald)' }}>✓ Automatically destructured from connected entity.</p>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0, letterSpacing: '0.05em' }}>Extracted Attributes Preview</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {explodedAttributes.map(({ key, value }) => {
                return (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: '0.65rem' }}>
                    <span style={{ color: 'var(--accent-blue)', marginRight: 8, whiteSpace: 'nowrap', fontWeight: 600 }}>{key}</span>
                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono', textAlign: 'right', wordBreak: 'break-all' }}>
                      {value !== undefined ? 
                        (formData.autoDecryptValues && isEncryptedValue(value) ? 
                          <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>[Decrypted on Output]</span> : 
                          formatAttributeValue(value, formData.autoEncryptNumericals)
                        ) : <span style={{ fontStyle: 'italic', opacity: 0.5 }}>null</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
}

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [selectedEntityName, setSelectedEntityName] = useState(null);
  
  const edges = useEdges();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();
  const prevEntityRef = useRef(undefined);

  // Whenever selectedEntity changes, push it into the node's data so
  // downstream nodes (like AddNode) can read it from nodes store.
  // Guard with JSON comparison to prevent infinite re-render loop.
  useEffect(() => {
    const serialised = JSON.stringify(selectedEntity);
    if (prevEntityRef.current !== serialised) {
      prevEntityRef.current = serialised;
      setNodes(nds => nds.map(n => 
        n.id === id ? { ...n, data: { ...n.data, resolvedEntity: selectedEntity } } : n
      ));
    }
  }, [selectedEntity, id, setNodes]);

  useEffect(() => {
    const incomingEdges = edges.filter(e => e.target === id);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    
    const specificEntityEdge = incomingEdges.find(e => e.sourceHandle && e.sourceHandle.startsWith('entity-out-'));

    if (incomingNodes.length > 0) {
        const dataList = resolveUpstreamData(incomingNodes, specificEntityEdge);
        let ent = null;
        let entName = null;

        if (specificEntityEdge) {
          let specificName = specificEntityEdge.sourceHandle;
          let specificId = null;
          
          if (specificName.startsWith('entity-out-pinned-')) {
            specificName = specificName.replace('entity-out-pinned-', '');
          } else if (specificName.startsWith('entity-out-')) {
            specificName = specificName.replace('entity-out-', '');
          }
          
          if (specificName.includes('::')) {
            const parts = specificName.split('::');
            specificId = parts[0];
            specificName = parts.slice(1).join('::');
          }
          
          const sourceNode = incomingNodes.find(n => n.data?.displayNameProperty);
          const propToUse = sourceNode?.data?.displayNameProperty || data.displayNameProperty;

          ent = dataList.find((e, idx) => {
            const eUniqueId = e._hve_id != null ? `hve_${e._hve_id}` : e.hve_id != null ? `hve_${e.hve_id}` : e.id != null ? `id_${e.id}` : `idx_${idx}`;
            if (specificId !== null && eUniqueId === specificId) return true;
            let customName = null;
            if (propToUse) {
              const parts = propToUse.split('.');
              let current = e;
              for (let i = 0; i < parts.length; i++) {
                if (current === null || current === undefined) break;
                current = current[parts[i]];
              }
              if (current !== null && current !== undefined && typeof current !== 'object') {
                customName = String(current);
              }
            }
            const name = customName || e.name || e.title || e.id || e._hve_id || `Entity ${idx + 1}`;
            return name === specificName;
          });
          entName = specificName;
        } else if (data.selectedEntityIndex !== undefined && data.selectedEntityIndex !== '') {
          ent = dataList[data.selectedEntityIndex];
          if (ent) {
            let customName = null;
            if (data.displayNameProperty) {
              const parts = data.displayNameProperty.split('.');
              let current = ent;
              for (let i = 0; i < parts.length; i++) {
                if (current === null || current === undefined) break;
                current = current[parts[i]];
              }
              if (current !== null && current !== undefined && typeof current !== 'object') {
                customName = String(current);
              }
            }
            entName = customName || ent.name || ent.title || ent.id || ent._hve_id || `Entity ${parseInt(data.selectedEntityIndex) + 1}`;
          }
        } else if (dataList.length > 0) {
          ent = dataList[0];
          if (ent) {
            let customName = null;
            if (data.displayNameProperty) {
              const parts = data.displayNameProperty.split('.');
              let current = ent;
              for (let i = 0; i < parts.length; i++) {
                if (current === null || current === undefined) break;
                current = current[parts[i]];
              }
              if (current !== null && current !== undefined && typeof current !== 'object') {
                customName = String(current);
              }
            }
            entName = customName || ent.name || ent.title || ent.id || ent._hve_id || 'Entity 1';
          }
        }

        setSelectedEntity(ent || null);
        setSelectedEntityName(entName || null);
    } else {
      setSelectedEntity(null);
      setSelectedEntityName(null);
    }
  }, [data.selectedEntityIndex, data.displayNameProperty, edges, id, nodes]);

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
      hideDefaultSource={true}
      hideDefaultTarget={true}
    >
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
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8, position: 'relative' }}>
        {(() => {
          const attributesToShow = getExplodedAttributes(selectedEntity);
          
          if (attributesToShow.length > 0) {
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Layers size={12} color="var(--accent-blue)" />
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>
                    {selectedEntity ? (
                      <>Exploded: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{selectedEntityName}</span></>
                    ) : (
                      <>Waiting for input data...</>
                    )}
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {attributesToShow.map(({ key, value, handleId }) => {
                    return (
                      <div key={handleId} style={{ 
                        position: 'relative', 
                        background: 'var(--bg-elevated)', 
                        padding: '4px 8px', 
                        borderRadius: 4, 
                        fontSize: '0.65rem',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--cyan)' }} />
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{key}</span>
                        {selectedEntity && (
                          <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: 'JetBrains Mono', fontSize: '0.55rem', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {formatAttributeValue(value, data.autoEncryptNumericals)}
                          </span>
                        )}
                        
                        {/* Dynamic Output Handle for Attribute */}
                        <Handle 
                          type="source" 
                          id={handleId}
                          position={Position.Right} 
                          style={{ 
                            right: -6, 
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'var(--cyan)', 
                            width: 10, 
                            height: 10, 
                    border: '2px solid var(--bg-surface)',
                    zIndex: 10
                          }} 
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            );
          }

          return <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Select an entity to explode attributes.</p>;
        })()}
      </div>
    </BaseNode>
  );
});
