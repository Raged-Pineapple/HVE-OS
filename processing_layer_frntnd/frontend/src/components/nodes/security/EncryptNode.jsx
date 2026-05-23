import React, { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position, useEdges, useNodes, useReactFlow } from 'reactflow';
import { Lock, X } from 'lucide-react';
import BaseNode from '../BaseNode';
import { discoverSecurityProviders } from '../../../api/client';

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
    // Check for snapshot/table format (silverTable node: n.data.rows = row objects, n.data.columns = schema)
    if (Array.isArray(n.data.rows) && n.data.rows.length > 0) {
      return n.data.rows;
    }
    if (Array.isArray(n.data.columns)) {
      return []; // known snapshot format but no rows yet
    }
  }
  return [];
};

export const config = {
  type: 'encryptNode',
  category: 'security',
  label: 'Encrypt',
  icon: Lock,
  color: 'var(--accent-red)',
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const [providers, setProviders] = useState({});
    const [loading, setLoading] = useState(true);
    const [availableFields, setAvailableFields] = useState([]);

    // Local state for UI selection before explicit execution
    const [localFields, setLocalFields] = useState(formData.fields || (formData.field ? [formData.field] : []));
    const localFieldsRef = useRef(localFields);
    const [isEncrypting, setIsEncrypting] = useState(false);

    useEffect(() => {
      localFieldsRef.current = localFields;
    }, [localFields]);

    useEffect(() => {
      const currentFormDataFields = formData.fields || (formData.field ? [formData.field] : []);
      if (JSON.stringify(currentFormDataFields) !== JSON.stringify(localFieldsRef.current)) {
        setLocalFields(currentFormDataFields);
      }
    }, [formData.fields, formData.field]);

    const handleLocalFieldsChange = (newFields) => {
      setLocalFields(newFields);
    };

    // Listen for the backend to finish processing and echo our exact execution trigger
    useEffect(() => {
      if (isEncrypting && formData.metadata?.config_used?._execute_trigger === formData._execute_trigger) {
        setIsEncrypting(false);
      }
    }, [formData.metadata, formData._execute_trigger, isEncrypting]);

    const handleEncryptClick = () => {
      setIsEncrypting(true);
      handleChange({
        fields: localFields,
        field: null,
        _execute_trigger: Date.now()
      });
      
      // Safety fallback just in case the network drops or backend crashes
      setTimeout(() => setIsEncrypting(false), 15000);
    };

    console.log('[EncryptNode SettingsForm] formData:', formData);
    console.log('[EncryptNode SettingsForm] previewInput:', formData?.previewInput);
    console.log('[EncryptNode SettingsForm] nodes passed to form:', nodes?.length);

    useEffect(() => {
      // Force the action to always be 'encrypt' for this node
      if (formData.action !== 'encrypt') {
        handleChange('action', 'encrypt');
      }

      discoverSecurityProviders()
        .then(data => {
          setProviders(data);
          setLoading(false);
          // Auto-select first available provider if none selected
          if (!formData.provider && Object.keys(data).length > 0) {
            handleChange('provider', Object.keys(data)[0]);
          }
        })
        .catch(err => {
          console.error("Failed to load security providers", err);
          setLoading(false);
        });
    }, []);

    // Detect columns from previewInput (set by main component from upstream data)
    useEffect(() => {
      let detectedFields = [];
      
      // Method 1: Get from previewInput (set by main component from upstream nodes)
      const previewData = formData?.previewInput;
      if (previewData && typeof previewData === 'object' && !Array.isArray(previewData)) {
        detectedFields = Object.keys(previewData);
        console.log('[EncryptNode] fields from previewInput:', detectedFields);
      }
      
      // Method 2: Get from columns (silver table node stores columns schema)
      if (detectedFields.length === 0 && Array.isArray(formData?.columns) && formData.columns.length > 0) {
        detectedFields = formData.columns;
        console.log('[EncryptNode] fields from formData.columns:', detectedFields);
      }
      
      // Method 3: Try direct nodes lookup as fallback
      if (detectedFields.length === 0 && nodes && edges) {
        const incomingEdges = edges.filter(e => e.target === nodeId);
        console.log('[EncryptNode] looking for source nodes, edges:', incomingEdges.length);
        for (const edge of incomingEdges) {
          const sourceNode = nodes.find(n => n.id === edge.source);
          console.log('[EncryptNode] source node:', sourceNode?.id, 'type:', sourceNode?.type, 'data keys:', Object.keys(sourceNode?.data || {}));
          if (sourceNode?.data) {
            // Try columns
            if (Array.isArray(sourceNode.data.columns) && sourceNode.data.columns.length > 0) {
              console.log('[EncryptNode] Found columns!', sourceNode.data.columns);
              detectedFields = sourceNode.data.columns;
              console.log('[EncryptNode] fields from sourceNode.data.columns:', detectedFields);
              break;
            }
            // Log what data IS there
            console.log('[EncryptNode] Source node has these data keys:', Object.keys(sourceNode.data));
          }
        }
      }

      // Enrich detected fields with data types from the preview row
      let previewRow = null;
      if (Array.isArray(formData?.previewInput) && formData.previewInput.length > 0) {
        previewRow = formData.previewInput[0];
      } else if (formData?.previewInput && typeof formData.previewInput === 'object') {
        previewRow = formData.previewInput;
      }
      
      // Fallback: If previewRow is missing, dig it out of the upstream nodes directly
      if (!previewRow && nodes && edges) {
        const incomingEdges = edges.filter(e => e.target === nodeId);
        for (const edge of incomingEdges) {
          const sourceNode = nodes.find(n => n.id === edge.source);
          if (sourceNode?.data) {
            const candidates = [sourceNode.data.data, sourceNode.data.extracted, sourceNode.data.resolvedEntity, sourceNode.data.rows, sourceNode.data.previewInput];
            for (const c of candidates) {
              if (Array.isArray(c) && c.length > 0) {
                previewRow = c[0];
                break;
              } else if (c && typeof c === 'object' && !Array.isArray(c)) {
                 if (Object.keys(c).length > 0 && detectedFields.some(f => f in c)) {
                   previewRow = c;
                   break;
                 }
              }
            }
          }
          if (previewRow) break;
        }
      }

      if (detectedFields.length > 0) {
        const fieldsWithMeta = detectedFields.map(f => {
          let valType = 'unknown';
          let encryptable = true;
          if (previewRow && f in previewRow) {
            const val = previewRow[f];
            if (val === null || val === undefined) {
              valType = 'null';
            } else if (typeof val === 'object' && val.__type__ === 'tenseal_encrypted') {
              valType = 'encrypted';
              encryptable = false;
            } else if (Array.isArray(val)) {
              valType = 'array';
              if (val.length > 0 && typeof val[0] === 'number') {
                valType = 'vector';
              }
            } else if (typeof val === 'number') {
              valType = Number.isInteger(val) ? 'int' : 'float';
            } else if (typeof val === 'boolean') {
              valType = 'boolean';
              encryptable = false;
            } else if (typeof val === 'string') {
              const isDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val);
              valType = isDate ? 'timestamp' : 'string';
              encryptable = false;
            } else {
              valType = typeof val;
            }
          }
          return { name: f, type: valType, encryptable };
        });
        
        console.log('[EncryptNode] Setting availableFields meta:', fieldsWithMeta);
        setAvailableFields(fieldsWithMeta);
      }
    }, [formData?.previewInput, formData?.columns, nodes, edges, nodeId]);

    const selectedProviderId = formData.provider;
    const providerMeta = providers[selectedProviderId];

    return (
      <>
        <div className="field">
          <label>Encryption Engine</label>
          {loading ? (
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Loading engines...</p>
          ) : (
            <select 
              value={selectedProviderId || ''} 
              onChange={(e) => handleChange('provider', e.target.value)}
            >
              {Object.entries(providers).map(([id, meta]) => (
                <option key={id} value={id} disabled={!meta.available}>
                  {meta.name} {!meta.available && '(Unavailable)'}
                </option>
              ))}
            </select>
          )}
        </div>

        {providerMeta && providerMeta.available && (
          <>
            <div className="field">
              <label>Target Fields to Encrypt</label>

              {availableFields.length > 0 ? (
                <select
                  value=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    const current = new Set(localFields);
                    current.add(val);
                    handleLocalFieldsChange(Array.from(current));
                  }}
                  style={{ fontSize: '0.65rem' }}
                >
                  <option value="">-- Add a column to encrypt --</option>
                  {availableFields
                    .filter(f => !localFields.includes(f.name))
                    .map(f => {
                      const isWarn = !f.encryptable && f.type !== 'null' && f.type !== 'encrypted';
                      const isEnc = f.type === 'encrypted';
                      return (
                        <option key={f.name} value={f.name}>
                          {f.name}  [{f.type}] {isEnc ? ' 🔒 (Encrypted)' : (isWarn ? ' ⚠️ (Not numeric)' : '')}
                        </option>
                      );
                    })}
                </select>
              ) : (
                <input 
                  value={localFields.join(', ')} 
                  onChange={(e) => handleLocalFieldsChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  placeholder="No columns detected, type comma separated manually"
                  style={{ fontSize: '0.65rem' }}
                />
              )}
              
              {localFields.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {localFields.map(f => {
                    const meta = availableFields.find(af => af.name === f) || { type: 'unknown', encryptable: true };
                    const isWarn = !meta.encryptable && meta.type !== 'null' && meta.type !== 'encrypted';
                    const isEnc = meta.type === 'encrypted';
                    
                    return (
                      <div key={f} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: isWarn ? 'rgba(245, 158, 11, 0.15)' : isEnc ? 'rgba(20, 184, 166, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                        border: `1px solid ${isWarn ? 'rgba(245, 158, 11, 0.4)' : isEnc ? 'rgba(20, 184, 166, 0.4)' : 'rgba(59, 130, 246, 0.4)'}`,
                        color: isWarn ? '#fcd34d' : isEnc ? '#5eead4' : '#93c5fd',
                        padding: '4px 8px', borderRadius: 6, fontSize: '0.65rem'
                      }}>
                        <span style={{ fontWeight: 600 }}>{f}</span>
                        <span style={{ opacity: 0.7, fontSize: '0.55rem', borderLeft: '1px solid currentColor', paddingLeft: 6 }}>
                          {meta.type}
                        </span>
                        {isWarn && <span title="TenSEAL natively supports numbers">⚠️</span>}
                        {isEnc && <Lock size={10} />}
                        <X 
                          size={12} 
                          style={{ cursor: 'pointer', opacity: 0.8, marginLeft: 4 }} 
                          onClick={() => {
                            const current = new Set(localFields);
                            current.delete(f);
                            handleLocalFieldsChange(Array.from(current));
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Render dynamic parameters for encryption based on schema */}
            {providerMeta.params_schema && providerMeta.params_schema['encrypt'] && (
              <div style={{ padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4, marginTop: 8 }}>
                <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                  Encryption Parameters
                </p>
                {Object.entries(providerMeta.params_schema['encrypt']).map(([paramName, paramType]) => {
                  const paramValue = (formData.params && formData.params[paramName]) || '';
                  
                  return (
                    <div className="field" key={paramName} style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: '0.65rem' }}>{paramName}</label>
                      {Array.isArray(paramType) ? (
                        <select 
                          style={{ fontSize: '0.65rem', padding: '4px' }}
                          value={paramValue || paramType[0]}
                          onChange={(e) => {
                            const newParams = { ...(formData.params || {}), [paramName]: e.target.value };
                            handleChange('params', newParams);
                          }}
                        >
                          {paramType.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input 
                          style={{ fontSize: '0.65rem', padding: '4px' }}
                          type="text"
                          value={paramValue}
                          onChange={(e) => {
                            const newParams = { ...(formData.params || {}), [paramName]: e.target.value };
                            handleChange('params', newParams);
                          }}
                          placeholder={paramType}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={handleEncryptClick}
              disabled={isEncrypting || localFields.length === 0}
              className="btn btn-primary"
              style={{
                marginTop: 16,
                width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: isEncrypting || localFields.length === 0 ? 0.7 : 1
              }}
            >
              {isEncrypting ? (
                <><span className="spinner" style={{ width: 14, height: 14 }} /> Encrypting...</>
              ) : (
                <><Lock size={14} /> Run Encryption</>
              )}
            </button>
          </>
        )}
      </>
    );
  }
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const edges = useEdges();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();
  const prevInputRef = useRef(undefined);

  useEffect(() => {
    const incomingEdges = edges.filter(e => e.target === id);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    
    console.log('[EncryptNode main] incomingNodes:', incomingNodes.length, incomingNodes.map(n => ({ id: n.id, type: n.type, dataKeys: Object.keys(n.data || {}) })));
    
    const dataList = resolveUpstreamData(incomingNodes);
    console.log('[EncryptNode main] dataList:', dataList.length, dataList[0]);
    
    const previewData = dataList.length > 0 ? dataList.slice(0, 10) : null;

    // Also check for columns schema from silver table nodes
    let columnsSchema = null;
    let snapshotPath = null;

    for (const n of incomingNodes) {
      if (Array.isArray(n.data?.columns) && n.data.columns.length > 0) {
        columnsSchema = n.data.columns;
        console.log('[EncryptNode main] found columns schema:', columnsSchema);
      }
      if (n.data?.snapshotPath) {
        snapshotPath = n.data.snapshotPath;
      }
    }

    if (previewData || columnsSchema || snapshotPath) {
      const serialised = JSON.stringify({ previewData, columnsSchema, snapshotPath });
      if (prevInputRef.current !== serialised) {
        prevInputRef.current = serialised;
        setNodes(nds => nds.map(n => {
          if (n.id === id) {
            const updates = {};
            if (previewData) updates.previewInput = previewData;
            if (columnsSchema) updates.columns = columnsSchema;
            if (snapshotPath) updates.inputSnapshotPath = snapshotPath;
            console.log('[EncryptNode main] setting previewInput and columns:', updates);
            return { ...n, data: { ...n.data, ...updates } };
          }
          return n;
        }));
      }
    }
  }, [edges, id, nodes, setNodes]);

  const displayFields = data.fields?.length ? data.fields.join(', ') : data.field;

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
      <Handle type="target" position={Position.Left} id="data" style={{ left: -6, top: '50%', background: 'var(--amber)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
      
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>
          Engine: <span style={{ color: 'var(--cyan)' }}>{data.provider || 'Unconfigured'}</span>
        </p>
        {displayFields && (
          <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>
            Target: <span style={{ color: '#fff', wordBreak: 'break-all' }}>{displayFields}</span>
          </p>
        )}
      </div>
      
      <Handle type="source" position={Position.Right} id="data" style={{ right: -6, top: '50%', background: 'var(--cyan)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
    </BaseNode>
  );
});
