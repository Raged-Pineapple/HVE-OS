import React, { memo, useState, useEffect } from 'react';
import { useEdges, useNodes, Handle, Position } from 'reactflow';
import { Fingerprint, Database, Tags, FileJson, Layers } from 'lucide-react';
import { getEntityKeys, getEntitiesByLabel } from '../../../api/client.js';
import BaseNode from '../BaseNode';

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

    const incomingEdges = edges.filter(e => e.target === nodeId);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);

    useEffect(() => {
      const sources = incomingNodes.filter(n => n.type === 'dataTrigger' && n.data?.id);
      if (sources.length > 0) {
        setLoading(true);
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
                          {sampleData[n.data.id].map((item, idx) => (
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
      </div>
    );
  }
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [entities, setEntities] = useState([]);
  
  const edges = useEdges();
  const nodes = useNodes();

  useEffect(() => {
    const incomingEdges = edges.filter(e => e.target === id);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    const sources = incomingNodes.filter(n => n.type === 'dataTrigger' && n.data?.id);
    
    if (sources.length > 0) {
      // Just take the first connected source for simplicity
      const sourceId = sources[0].data.id;
      getEntitiesByLabel(sourceId).then(dataList => {
        // Limit to 5 for UI performance on the canvas
        setEntities(dataList.slice(0, 5));
      }).catch(() => setEntities([]));
    } else {
      setEntities([]);
    }
  }, [edges.length, id, nodes]);

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
      hideDefaultSource={entities.length > 0} // Hide default if we have dynamic ones
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Tags size={12} color="var(--accent-blue)" />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>
            Strategy: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{data.strategy || 'NER'}</span>
          </p>
        </div>
        
        {entities.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 4px 0' }}>Extracted Output</p>
            {entities.map((entity, idx) => (
              <div key={idx} style={{ 
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
                <Layers size={10} color="var(--cyan)" />
                <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                  {entity.name || entity.id || entity.title || `Entity ${idx + 1}`}
                </span>
                
                {/* Dynamic Output Handle for this specific entity */}
                <Handle 
                  type="source" 
                  id={`entity-out-${idx}`}
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
            {entities.length >= 5 && (
               <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', margin: 0, textAlign: 'center', fontStyle: 'italic' }}>+ more (limited to 5)</p>
            )}
          </div>
        )}

        {entities.length === 0 && (
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: 0 }}>
            Extracting: <span style={{ color: 'var(--cyan)' }}>{(data.selectedFields || []).length} fields</span>
          </p>
        )}
      </div>
    </BaseNode>
  );
});
