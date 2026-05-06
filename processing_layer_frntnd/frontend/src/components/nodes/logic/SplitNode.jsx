import React, { memo, useState, useEffect, useRef } from 'react';
import { useEdges, useNodes, Handle, Position, useReactFlow } from 'reactflow';
import { Split, Database, FileJson, Layers } from 'lucide-react';
import { getEntitiesByLabel, getEntityKeys } from '../../../api/client.js';
import BaseNode from '../BaseNode';
import { parsePythonLiteral } from '../../../utils/pipelineUtils.js';

const resolveUpstreamData = async (incomingNodes, nodes, edges) => {
  let sources = incomingNodes.filter(n => n.type === 'dataTrigger' && n.data?.id);
  if (sources.length > 0) {
    const dataList = await getEntitiesByLabel(sources[0].data.id).catch(() => []);
    return dataList;
  }
  
  let extractNodes = incomingNodes.filter(n => n.type === 'extractEntities');
  if (extractNodes.length > 0) {
    const extNode = extractNodes[0];
    const upEdges = edges.filter(e => e.target === extNode.id);
    const upNodes = upEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    const trig = upNodes.find(n => n.type === 'dataTrigger' && n.data?.id);
    
    if (trig) {
      let dataList = await getEntitiesByLabel(trig.data.id).catch(() => []);
      const strategy = extNode.data?.strategy || 'NER';
      const label = extNode.data?.label || '';
      
      if (strategy === 'KeyPath' && label) {
        dataList = dataList.flatMap(item => {
          const parts = label.split('.');
          let current = item;
          for (let p of parts) {
            if (current === null || current === undefined) break;
            current = current[p];
          }
          return Array.isArray(current) ? current : (current ? [current] : []);
        });
      }
      return dataList;
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
    const [neo4jKeys, setNeo4jKeys] = useState([]);
    const [loading, setLoading] = useState(false);

    const incomingEdges = edges.filter(e => e.target === nodeId);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    const pinnedEdge = incomingEdges.find(e => e.sourceHandle && e.sourceHandle.startsWith('entity-out-pinned-'));

    useEffect(() => {
      if (incomingNodes.length > 0) {
        setLoading(true);
        
        // Find source ID for Neo4j keys
        let sourceId = null;
        let sources = incomingNodes.filter(n => n.type === 'dataTrigger' && n.data?.id);
        if (sources.length > 0) sourceId = sources[0].data.id;
        else {
          let extractNodes = incomingNodes.filter(n => n.type === 'extractEntities');
          if (extractNodes.length > 0) {
            const extNode = extractNodes[0];
            const upEdges = edges.filter(e => e.target === extNode.id);
            const upNodes = upEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
            const trig = upNodes.find(n => n.type === 'dataTrigger' && n.data?.id);
            if (trig) sourceId = trig.data.id;
          }
        }

        if (sourceId) {
          getEntityKeys(sourceId).then(keys => setNeo4jKeys(keys)).catch(() => setNeo4jKeys([]));
        }

        resolveUpstreamData(incomingNodes, nodes, edges)
          .then(dataList => {
            setEntities(dataList);
            if (pinnedEdge) {
              const pinnedName = pinnedEdge.sourceHandle.replace('entity-out-pinned-', '');
              const extNode = incomingNodes.find(n => n.type === 'extractEntities');
              const propToUse = extNode?.data?.displayNameProperty || formData.displayNameProperty;
              
              const idx = dataList.findIndex((e, i) => {
                let customName = null;
                if (propToUse) {
                  const parts = propToUse.split('.');
                  let current = e;
                  for (let p of parts) {
                    if (current === null || current === undefined) break;
                    if (typeof current === 'string' && current.trim().startsWith('{')) {
                      try { current = JSON.parse(current.replace(/'/g, '"')); } catch (err) {}
                    }
                    current = current[p];
                  }
                  if (current !== null && current !== undefined && typeof current !== 'object') {
                    customName = String(current);
                  }
                }
                const name = customName || e.name || e.title || e.id || `Entity ${i + 1}`;
                return name === pinnedName;
              });
              
              if (idx !== -1 && formData.selectedEntityIndex !== idx) {
                // Auto update selected index
                setTimeout(() => handleChange('selectedEntityIndex', idx), 0);
              }
            }
          })
          .catch(() => setEntities([]))
          .finally(() => setLoading(false));
      } else {
        setEntities([]);
      }
    }, [incomingNodes.length, nodes, edges, pinnedEdge, formData.displayNameProperty, formData.selectedEntityIndex]);

    const selectedEntityIndex = formData.selectedEntityIndex;
    const selectedEntity = selectedEntityIndex !== undefined && selectedEntityIndex !== '' ? entities[selectedEntityIndex] : null;

    // Use Neo4j keys if available, fallback to entity parsing if not
    const availableKeys = neo4jKeys.length > 0 ? new Set(neo4jKeys) : new Set();
    if (neo4jKeys.length === 0) {
      entities.forEach(item => {
        Object.keys(item).forEach(k => {
          availableKeys.add(k);
          let val = item[k];
          if (typeof val === 'string' && val.trim().startsWith('{')) {
            try { 
              const parsed = parsePythonLiteral(val);
              if (parsed) val = parsed;
            } catch (e) {}
          }
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            Object.keys(val).forEach(nk => availableKeys.add(`${k}.${nk}`));
          }
        });
      });
    }
    const keyOptions = Array.from(availableKeys).sort();

    const getDisplayName = (ent, idx) => {
      if (formData.displayNameProperty) {
        const parts = formData.displayNameProperty.split('.');
        let current = ent;
        for (let i = 0; i < parts.length; i++) {
          if (current === null || current === undefined) break;
          if (typeof current === 'string' && current.trim().startsWith('{')) {
            try { current = JSON.parse(current.replace(/'/g, '"')); } catch (e) {}
          }
          current = current[parts[i]];
        }
        if (current !== null && current !== undefined && typeof current !== 'object') {
          return String(current);
        }
      }
      return ent.name || ent.title || ent.id || `Entity ${idx + 1}`;
    };

    const isAutoSelected = !!pinnedEdge;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {!isAutoSelected && (
          <>
            <div className="field">
              <label>Display Name Property</label>
              <select 
                value={formData.displayNameProperty || ''} 
                onChange={(e) => handleChange('displayNameProperty', e.target.value)}
              >
                <option value="">-- Default (name, id, title) --</option>
                {keyOptions.map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Select Entity to Explode</label>
              {loading ? (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Loading entities...</p>
              ) : entities.length > 0 ? (
                <select
                  value={formData.selectedEntityIndex !== undefined ? formData.selectedEntityIndex : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    handleChange('selectedEntityIndex', val);
                  }}
                >
                  <option value="">-- Select an Entity --</option>
                  {entities.map((ent, idx) => (
                    <option key={idx} value={idx}>
                      {getDisplayName(ent, idx)}
                    </option>
                  ))}
                </select>
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
              {neo4jKeys.length > 0 && (
                <span style={{ fontSize: '0.55rem', padding: '2px 6px', background: 'rgba(52, 211, 153, 0.1)', color: 'var(--emerald)', borderRadius: 12, border: '1px solid var(--emerald)' }}>
                  Neo4j Schema Live
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(neo4jKeys.length > 0 ? neo4jKeys : Object.keys(selectedEntity || {})).map((k) => {
                // Try to safely get the value from selectedEntity (even if it's nested or inside a stringified json)
                let v = selectedEntity ? selectedEntity[k] : undefined;
                if (v === undefined && k.includes('.') && selectedEntity) {
                  const parts = k.split('.');
                  let current = selectedEntity;
                  for (let p of parts) {
                    if (current === null || current === undefined) break;
                    if (typeof current === 'string' && current.trim().startsWith('{')) {
                      try { current = JSON.parse(current.replace(/'/g, '"').replace(/: None/g, ': null').replace(/: True/g, ': true').replace(/: False/g, ': false')); } catch (e) {}
                    }
                    current = current[p];
                  }
                  if (current !== undefined) v = current;
                }

                return (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 8px', background: 'rgba(0,0,0,0.15)', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: '0.6rem' }}>
                    <span style={{ color: 'var(--cyan)', marginRight: 8, whiteSpace: 'nowrap', fontWeight: 600 }}>{k}</span>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'JetBrains Mono', textAlign: 'right', wordBreak: 'break-all' }}>
                      {v !== undefined ? (typeof v === 'object' ? JSON.stringify(v) : String(v)) : <span style={{ fontStyle: 'italic', opacity: 0.5 }}>null</span>}
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
  const [neo4jKeys, setNeo4jKeys] = useState([]);
  
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
    
    // Fetch Neo4j keys
    let sourceId = null;
    let sources = incomingNodes.filter(n => n.type === 'dataTrigger' && n.data?.id);
    if (sources.length > 0) sourceId = sources[0].data.id;
    else {
      let extractNodes = incomingNodes.filter(n => n.type === 'extractEntities');
      if (extractNodes.length > 0) {
        const extNode = extractNodes[0];
        const upEdges = edges.filter(e => e.target === extNode.id);
        const upNodes = upEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
        const trig = upNodes.find(n => n.type === 'dataTrigger' && n.data?.id);
        if (trig) sourceId = trig.data.id;
      }
    }

    if (sourceId) {
      getEntityKeys(sourceId).then(keys => setNeo4jKeys(keys)).catch(() => setNeo4jKeys([]));
    }

    const pinnedEdge = incomingEdges.find(e => e.sourceHandle && e.sourceHandle.startsWith('entity-out-pinned-'));

    if (incomingNodes.length > 0) {
      resolveUpstreamData(incomingNodes, nodes, edges).then(dataList => {
        let ent = null;
        let entName = null;

        if (pinnedEdge) {
          const pinnedName = pinnedEdge.sourceHandle.replace('entity-out-pinned-', '');
          const extNode = incomingNodes.find(n => n.type === 'extractEntities');
          const propToUse = extNode?.data?.displayNameProperty || data.displayNameProperty;

          ent = dataList.find((e, idx) => {
            let customName = null;
            if (propToUse) {
              const parts = propToUse.split('.');
              let current = e;
              for (let i = 0; i < parts.length; i++) {
                if (current === null || current === undefined) break;
                if (typeof current === 'string' && current.trim().startsWith('{')) {
                  try { current = JSON.parse(current.replace(/'/g, '"')); } catch (err) {}
                }
                current = current[parts[i]];
              }
              if (current !== null && current !== undefined && typeof current !== 'object') {
                customName = String(current);
              }
            }
            const name = customName || e.name || e.title || e.id || `Entity ${idx + 1}`;
            return name === pinnedName;
          });
          entName = pinnedName;
        } else if (data.selectedEntityIndex !== undefined && data.selectedEntityIndex !== '') {
          ent = dataList[data.selectedEntityIndex];
          if (ent) {
            let customName = null;
            if (data.displayNameProperty) {
              const parts = data.displayNameProperty.split('.');
              let current = ent;
              for (let i = 0; i < parts.length; i++) {
                if (current === null || current === undefined) break;
                if (typeof current === 'string' && current.trim().startsWith('{')) {
                  try { current = JSON.parse(current.replace(/'/g, '"')); } catch (err) {}
                }
                current = current[parts[i]];
              }
              if (current !== null && current !== undefined && typeof current !== 'object') {
                customName = String(current);
              }
            }
            entName = customName || ent.name || ent.title || ent.id || `Entity ${parseInt(data.selectedEntityIndex) + 1}`;
          }
        }

        setSelectedEntity(ent || null);
        setSelectedEntityName(entName || null);
      }).catch(() => {
        setSelectedEntity(null);
        setSelectedEntityName(null);
      });
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
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8, position: 'relative' }}>
        {(() => {
          const keysToShow = neo4jKeys.length > 0 ? neo4jKeys : (selectedEntity ? Object.keys(selectedEntity) : []);
          
          if (keysToShow.length > 0) {
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  {neo4jKeys.length > 0 ? <Database size={12} color="var(--emerald)" /> : <Layers size={12} color="var(--accent-blue)" />}
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>
                    {selectedEntity ? (
                      <>Exploded: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{selectedEntityName}</span></>
                    ) : (
                      <>Schema: <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>Neo4j Live</span></>
                    )}
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {keysToShow.map((k) => {
                    // Try to safely get the value if an entity is selected
                    let v = undefined;
                    if (selectedEntity) {
                      v = selectedEntity[k];
                      if (v === undefined && k.includes('.')) {
                        const parts = k.split('.');
                        let current = selectedEntity;
                        for (let p of parts) {
                          if (current === null || current === undefined) break;
                          if (typeof current === 'string' && current.trim().startsWith('{')) {
                            try { 
                              const parsed = parsePythonLiteral(current);
                              if (parsed) current = parsed;
                            } catch (e) {}
                          }
                          current = current[p];
                        }
                        if (current !== undefined) v = current;
                      }
                    }

                    return (
                      <div key={k} style={{ 
                        position: 'relative', 
                        background: 'var(--bg-elevated)', 
                        padding: '4px 8px', 
                        borderRadius: 4, 
                        fontSize: '0.65rem',
                        border: '1px solid',
                        borderColor: neo4jKeys.includes(k) ? 'rgba(52, 211, 153, 0.3)' : 'var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: neo4jKeys.includes(k) ? 'var(--emerald)' : 'var(--cyan)' }} />
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{k}</span>
                        {selectedEntity && (
                          <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: 'JetBrains Mono', fontSize: '0.55rem', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {v !== undefined ? (typeof v === 'object' ? '{...}' : String(v)) : 'null'}
                          </span>
                        )}
                        
                        {/* Dynamic Output Handle for Attribute */}
                        <Handle 
                          type="source" 
                          id={`attr-out-${k}`}
                          position={Position.Right} 
                          style={{ 
                            right: -6, 
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: neo4jKeys.includes(k) ? 'var(--emerald)' : 'var(--cyan)', 
                            width: 10, 
                            height: 10, 
                            border: '2px solid var(--bg-surface)' 
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
