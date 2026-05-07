import React, { memo, useState, useEffect, useRef } from 'react';
import { useEdges, useNodes, Handle, Position, useReactFlow } from 'reactflow';
import { Fingerprint, Database, Tags, FileJson, Layers, Pin, PinOff, Search } from 'lucide-react';
import { getEntityKeys, getEntitiesByLabel, getEntityPreview } from '../../../api/client.js';
import BaseNode from '../BaseNode';
import { parsePythonLiteral } from '../../../utils/pipelineUtils.js';

const SourcePreview = ({ node, formData, dataList, searchQuery, handleChange }) => {
  const [cypherResults, setCypherResults] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (formData.displayNameProperty) {
      setLoadingPreview(true);
      getEntityPreview(node.data.id, formData.displayNameProperty)
        .then(res => setCypherResults(res))
        .catch(() => setCypherResults([]))
        .finally(() => setLoadingPreview(false));
    } else {
      setCypherResults([]);
    }
  }, [formData.displayNameProperty, node.data.id]);

  if (loadingPreview) return <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Running Cypher query...</p>;

  const finalData = formData.displayNameProperty && cypherResults.length > 0 
    ? cypherResults.map(r => ({ original: r.original, entityName: String(r.value) }))
    : dataList.map((item, idx) => {
        let customName = null;
        if (formData.displayNameProperty) {
          const parts = formData.displayNameProperty.split('.');
          let current = item;
          for (let i = 0; i < parts.length; i++) {
            if (current === null || current === undefined) break;
            if (typeof current === 'string' && current.trim().startsWith('{')) {
              try { 
                const parsed = parsePythonLiteral(current);
                if (parsed) current = parsed;
              } catch (e) {}
            }
            current = current[parts[i]];
          }
          if (current !== null && current !== undefined && typeof current !== 'object') {
            customName = String(current);
          }
        }
        const name = customName || item.name || item.id || item.title || `Entity ${idx + 1}`;
        return { original: item, entityName: name };
      });

  return finalData
    .filter(item => {
      if (!searchQuery) return true;
      return item.entityName.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .map(({ original: item, entityName }, idx) => {
      const isPinned = (formData.pinnedEntities || []).includes(entityName);
      return (
        <div key={idx} style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          padding: '6px 8px', 
          background: 'rgba(0,0,0,0.15)', 
          borderRadius: 6, 
          border: '1px solid',
          borderColor: isPinned ? 'var(--cyan)' : 'var(--border-subtle)'
        }}>
          <span style={{ fontSize: '0.65rem', color: isPinned ? 'var(--cyan)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entityName}
          </span>
          <button 
            type="button"
            onClick={(e) => {
              e.preventDefault();
              const currentPinned = formData.pinnedEntities || [];
              const nextPinned = isPinned 
                ? currentPinned.filter(name => name !== entityName)
                : [...currentPinned, entityName];
              handleChange('pinnedEntities', nextPinned);
            }}
            style={{ 
              background: 'none', 
              border: 'none', 
              cursor: 'pointer', 
              color: isPinned ? 'var(--cyan)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              padding: 4
            }}
          >
            {isPinned ? <Pin size={12} fill="currentColor" /> : <PinOff size={12} />}
          </button>
        </div>
      );
    });
};

const applyExtraction = (dataList, strategy, label) => {
  if (strategy === 'KeyPath' && label) {
    return dataList.flatMap(item => {
      const parts = label.split('.');
      let current = item;
      for (let p of parts) {
        if (current === null || current === undefined) break;
        
        // Handle case where parent might be a stringified JSON
        if (typeof current === 'string' && current.trim().startsWith('{')) {
          try {
            const parsed = parsePythonLiteral(current);
            if (parsed) current = parsed;
          } catch (e) {}
        }
        
        current = current[p];
      }

      // Final result could also be stringified JSON
      if (typeof current === 'string' && (current.trim().startsWith('[') || current.trim().startsWith('{'))) {
        try {
          const parsed = parsePythonLiteral(current);
          if (parsed) current = parsed;
        } catch (e) {}
      }

      return Array.isArray(current) ? current : (current ? [current] : []);
    });
  }
  return dataList || [];
};

export const config = {
  type: 'extractEntities',
  category: 'logic',
  label: 'Extract Entities',
  icon: Fingerprint,
  color: 'var(--accent-blue)',
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const [incomingSchema, setIncomingSchema] = useState({});
    const [sampleData, setSampleData] = useState({});
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState({});
    const [searchQuery, setSearchQuery] = useState('');

    const [neo4jKeys, setNeo4jKeys] = useState([]);

    const incomingEdges = edges.filter(e => e.target === nodeId);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);

    // Compute available keys for Display Name Property
    const availableKeys = new Set(neo4jKeys);
    incomingNodes.forEach(n => {
      const rawList = sampleData[n.data.id] || [];
      const dataList = applyExtraction(rawList, formData.strategy, formData.label).slice(0, 100); // cap for performance
      dataList.forEach(item => {
        if (!item || typeof item !== 'object') return;
        
        const extractKeys = (obj, prefix = '') => {
          Object.keys(obj).forEach(k => {
            const fullKey = prefix ? `${prefix}.${k}` : k;
            availableKeys.add(fullKey);
            
            let val = obj[k];
            if (typeof val === 'string' && (val.trim().startsWith('{') || val.trim().startsWith('['))) {
              try {
                const parsed = parsePythonLiteral(val);
                if (parsed) val = parsed;
              } catch (e) {}
            }
            
            if (val && typeof val === 'object' && !Array.isArray(val) && prefix.split('.').length < 3) {
              extractKeys(val, fullKey);
            }
          });
        };
        
        extractKeys(item);
      });
    });
    const keyOptions = Array.from(availableKeys).sort();

    useEffect(() => {
      const sources = incomingNodes.filter(n => n.type === 'dataTrigger' && n.data?.id);
      if (sources.length > 0) {
        setLoading(true);
        // Also fetch Neo4j keys to enrich the dropdown
        getEntityKeys(sources[0].data.id).then(keys => setNeo4jKeys(keys)).catch(() => setNeo4jKeys([]));
        Promise.all(sources.map(async (s) => {
          const keys = await getEntityKeys(s.data.id);
          const dataList = await getEntitiesByLabel(s.data.id).catch(() => []);
          return { id: s.data.id, keys, data: dataList };
        })).then(results => {
          const schemaMap = {};
          const dataMap = {};
          results.forEach(res => {
            schemaMap[res.id] = res.keys;
            dataMap[res.id] = res.data;
          });
          setIncomingSchema(schemaMap);
          setSampleData(dataMap);
        }).finally(() => setLoading(false));
      }
    }, [incomingNodes.length]);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="field">
          <label>Extraction Strategy</label>
          <select 
            value={formData.strategy || 'NER'} 
            onChange={(e) => handleChange('strategy', e.target.value)}
          >
            <option value="NER">Named Entity Recognition (NLP)</option>
            <option value="Regex">Pattern Match (Regex)</option>
            <option value="KeyPath">Key-Path Extraction</option>
          </select>
        </div>

        <div className="field">
          <label>Target Label</label>
          <input 
            placeholder="e.g. PERSON, LOCATION"
            value={formData.label || ''}
            onChange={(e) => handleChange('label', e.target.value)}
          />
        </div>

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

        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
          <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, letterSpacing: '0.05em' }}>Available Input Fields</p>
          
          <div style={{ marginBottom: 12 }}>
            {incomingNodes.length > 0 ? (
              incomingNodes.map(n => (
                <div key={n.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--bg-elevated)', borderRadius: 4, fontSize: '0.7rem', marginBottom: 6 }}>
                    <Database size={12} color="var(--emerald)" />
                    <span style={{ fontWeight: 600 }}>{n.data.id || n.id}</span>
                  </div>
                  
                  {loading ? (
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 8 }}>Loading fields...</p>
                  ) : incomingSchema[n.data.id] ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginLeft: 8 }}>
                      {incomingSchema[n.data.id].map(key => (
                        <span 
                          key={key} 
                          onClick={() => {
                            const current = formData.selectedFields || [];
                            const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
                            handleChange('selectedFields', next);
                          }}
                          style={{ 
                            fontSize: '0.6rem', 
                            padding: '2px 8px', 
                            background: (formData.selectedFields || []).includes(key) ? 'var(--accent-blue)' : 'rgba(52, 211, 153, 0.05)', 
                            color: (formData.selectedFields || []).includes(key) ? 'white' : 'var(--text-muted)', 
                            borderRadius: 12,
                            border: '1px solid',
                            borderColor: (formData.selectedFields || []).includes(key) ? 'var(--accent-blue)' : 'var(--border-subtle)',
                            fontFamily: 'JetBrains Mono',
                            cursor: 'pointer'
                          }}
                        >
                          {key}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 8, fontStyle: 'italic' }}>No fields detected.</p>
                  )}

                  {sampleData[n.data.id] && sampleData[n.data.id].length > 0 && (
                    <div style={{ marginTop: 12, marginLeft: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <FileJson size={10} color="var(--text-secondary)" />
                          <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actual Source Data</span>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button 
                            type="button"
                            onClick={(e) => { e.preventDefault(); setViewMode(prev => ({ ...prev, [n.data.id]: 'structured' })) }} 
                            style={{ 
                              fontSize: '0.55rem', padding: '2px 6px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-subtle)',
                              background: (viewMode[n.data.id] || 'structured') === 'structured' ? 'var(--cyan-dim)' : 'transparent',
                              color: (viewMode[n.data.id] || 'structured') === 'structured' ? 'var(--cyan)' : 'var(--text-muted)'
                            }}
                          >
                            Structured
                          </button>
                          <button 
                            type="button"
                            onClick={(e) => { e.preventDefault(); setViewMode(prev => ({ ...prev, [n.data.id]: 'raw' })) }} 
                            style={{ 
                              fontSize: '0.55rem', padding: '2px 6px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-subtle)',
                              background: viewMode[n.data.id] === 'raw' ? 'var(--cyan-dim)' : 'transparent',
                              color: viewMode[n.data.id] === 'raw' ? 'var(--cyan)' : 'var(--text-muted)'
                            }}
                          >
                            Raw
                          </button>
                        </div>
                      </div>

                      {viewMode[n.data.id] === 'raw' ? (
                        <pre style={{ 
                          margin: 0, 
                          padding: '8px', 
                          background: 'rgba(0,0,0,0.2)', 
                          borderRadius: 6, 
                          border: '1px solid var(--border-subtle)',
                          fontSize: '0.65rem',
                          color: 'var(--text-muted)',
                          fontFamily: 'JetBrains Mono',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          maxHeight: '160px',
                          overflowY: 'auto'
                        }}>
                          {JSON.stringify(sampleData[n.data.id], null, 2)}
                        </pre>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '160px', overflowY: 'auto', paddingRight: 4 }}>
                          {applyExtraction(sampleData[n.data.id] || [], formData.strategy, formData.label).slice(0, 100).map((item, idx) => (
                            <div key={idx} style={{ padding: '6px 8px', background: 'rgba(0,0,0,0.15)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                              <div style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                Entity {idx + 1}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {Object.entries(item).map(([k, v]) => (
                                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '0.6rem' }}>
                                    <span style={{ color: 'var(--cyan)', marginRight: 8, whiteSpace: 'nowrap' }}>{k}</span>
                                    <span style={{ 
                                      color: 'var(--text-muted)', 
                                      fontFamily: 'JetBrains Mono', 
                                      textAlign: 'right',
                                      wordBreak: 'break-all'
                                    }}>
                                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Connect an input to see fields.</p>
            )}
          </div>
        </div>

        {/* Extracted Entities Preview */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0, letterSpacing: '0.05em' }}>Extracted Entities Preview</p>
            {formData.displayNameProperty && (
              <span style={{ fontSize: '0.55rem', padding: '2px 6px', background: 'rgba(52, 211, 153, 0.1)', color: 'var(--emerald)', borderRadius: 12, border: '1px solid var(--emerald)' }}>
                Cypher Preview Live
              </span>
            )}
          </div>

          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }} />
            <input 
              type="text" 
              placeholder="Search entities..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 28, width: '100%' }}
            />
          </div>
          
          {incomingNodes.length > 0 ? incomingNodes.map(n => {
            const rawList = sampleData[n.data.id] || [];
            const dataList = applyExtraction(rawList, formData.strategy, formData.label).slice(0, 100);
            if (dataList.length === 0) return null;

            return (
              <div key={`preview-${n.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '250px', overflowY: 'auto', paddingRight: 4 }}>
                <SourcePreview 
                  node={n} 
                  formData={formData} 
                  dataList={dataList} 
                  searchQuery={searchQuery} 
                  handleChange={handleChange} 
                />
              </div>
            );
          }) : (
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Connect an input to preview entities.</p>
          )}
        </div>
      </div>
    );
  }
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [entities, setEntities] = useState([]);
  const prevResolvedRef = useRef(null);
  
  const edges = useEdges();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();

  useEffect(() => {
    const incomingEdges = edges.filter(e => e.target === id);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    const sources = incomingNodes.filter(n => n.type === 'dataTrigger' && n.data?.id);
    
    if (sources.length > 0) {
      const sourceId = sources[0].data.id;
      
      if (data.displayNameProperty) {
        // Fetch specific property values for names
        getEntityPreview(sourceId, data.displayNameProperty).then(results => {
          setEntities(results.map(r => ({ ...r.original, __resolvedName: String(r.value) })));
        }).catch(() => setEntities([]));
      } else {
        // Fallback to general label fetch
        getEntitiesByLabel(sourceId).then(dataList => {
          setEntities(applyExtraction(dataList, data.strategy, data.label));
        }).catch(() => setEntities([]));
      }
    } else {
      setEntities([]);
    }
  }, [edges.length, id, nodes, data.strategy, data.label, data.displayNameProperty]);

  // Propagate pinned entities to node.data.resolvedEntity so downstream nodes can read the objects
  useEffect(() => {
    if (!data.pinnedEntities || data.pinnedEntities.length === 0) {
      if (prevResolvedRef.current !== 'null') {
        prevResolvedRef.current = 'null';
        setNodes(nds => nds.map(n => n.id === id && n.data?.resolvedEntity ? { ...n, data: { ...n.data, resolvedEntity: null } } : n));
      }
      return;
    }
    const resolvedMap = {};
    
    // Use the exact same name resolution logic as the preview to ensure we find the pinned entity
    entities.forEach((entity, idx) => {
      let customName = entity.__resolvedName || null;
      if (!customName && data.displayNameProperty) {
        const parts = data.displayNameProperty.split('.');
        let current = entity;
        for (let i = 0; i < parts.length; i++) {
          if (current === null || current === undefined) break;
          if (typeof current === 'string' && current.trim().startsWith('{')) {
            try { 
              const parsed = parsePythonLiteral(current);
              if (parsed) current = parsed;
            } catch (e) {}
          }
          current = current[parts[i]];
        }
        if (current !== null && current !== undefined && typeof current !== 'object') {
          customName = String(current);
        }
      }
      const name = customName || entity.name || entity.id || entity.title || `Entity ${idx + 1}`;
      
      if (data.pinnedEntities.includes(name)) {
        resolvedMap[name] = entity;
      }
    });
    
    const str = JSON.stringify(resolvedMap);
    if (prevResolvedRef.current !== str) {
      prevResolvedRef.current = str;
      setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, resolvedEntity: resolvedMap } } : n));
    }
  }, [entities, data.pinnedEntities, data.displayNameProperty, id, setNodes]);

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
      hideDefaultSource={false} // Always show bulk output handle
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Tags size={12} color="var(--accent-blue)" />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>
            Strategy: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{data.strategy || 'NER'}</span>
          </p>
        </div>
        
        {/* Pinned entities — always visible from saved data, with output handles */}
        {(data.pinnedEntities || []).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 4px 0' }}>
              Pinned — {(data.pinnedEntities || []).length} entities
            </p>
            {(data.pinnedEntities || []).map((name, idx) => (
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
                  style={{ 
                    right: -6, 
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'var(--cyan)', 
                    width: 10, 
                    height: 10, 
                    border: '2px solid var(--bg-surface)' 
                  }} 
                />
              </div>
            ))}
          </div>
        )}

        {/* Unpinned preview from fetched entities */}
        {entities.length > 0 && (() => {
          const pinnedNames = data.pinnedEntities || [];
          const resolvedEntities = entities.map((entity, idx) => {
            let customName = entity.__resolvedName || null;
            if (!customName && data.displayNameProperty) {
              const parts = data.displayNameProperty.split('.');
              let current = entity;
              for (let i = 0; i < parts.length; i++) {
                if (current === null || current === undefined) break;
                if (typeof current === 'string' && current.trim().startsWith('{')) {
                  try { 
                    const parsed = parsePythonLiteral(current);
                    if (parsed) current = parsed;
                  } catch (e) {}
                }
                current = current[parts[i]];
              }
              if (current !== null && current !== undefined && typeof current !== 'object') {
                customName = String(current);
              }
            }
            const name = customName || entity.name || entity.id || entity.title || `Entity ${idx + 1}`;
            return { name, idx };
          });
          const unpinned = resolvedEntities.filter(e => !pinnedNames.includes(e.name));
          const preview = unpinned.slice(0, 3);
          const hiddenCount = unpinned.length - preview.length;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: (data.pinnedEntities || []).length > 0 ? 8 : 0 }}>
              {preview.map((item) => (
                <div key={`preview-${item.idx}-${item.name}`} style={{ 
                  background: 'var(--bg-surface)', 
                  padding: '4px 8px', 
                  borderRadius: 4, 
                  fontSize: '0.65rem',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  opacity: 0.7
                }}>
                  <Layers size={10} color="var(--text-muted)" />
                  <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                    {item.name}
                  </span>
                </div>
              ))}
              {hiddenCount > 0 && (
                <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', margin: 0, textAlign: 'center', fontStyle: 'italic' }}>
                  + {hiddenCount} more unpinned
                </p>
              )}
            </div>
          );
        })()}

        {(data.pinnedEntities || []).length === 0 && entities.length === 0 && (
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: 0 }}>
            Extracting: <span style={{ color: 'var(--cyan)' }}>{(data.selectedFields || []).length} fields</span>
          </p>
        )}
      </div>
    </BaseNode>
  );
});
