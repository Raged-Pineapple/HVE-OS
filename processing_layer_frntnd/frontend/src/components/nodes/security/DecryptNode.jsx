import React, { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position, useEdges, useNodes, useReactFlow } from 'reactflow';
import { Unlock } from 'lucide-react';
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
    if (Array.isArray(n.data.rows) && n.data.rows.length > 0) {
      return n.data.rows;
    }
    if (Array.isArray(n.data.columns)) {
      return [];
    }
  }
  return [];
};

export const config = {
  type: 'decryptNode',
  category: 'security',
  label: 'Decrypt',
  icon: Unlock,
  color: 'var(--emerald)',
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const [providers, setProviders] = useState({});
    const [loading, setLoading] = useState(true);
    const [availableFields, setAvailableFields] = useState([]);

    useEffect(() => {
      if (formData.action !== 'decrypt') {
        handleChange('action', 'decrypt');
      }

      discoverSecurityProviders()
        .then(data => {
          setProviders(data);
          setLoading(false);
          if (!formData.provider && Object.keys(data).length > 0) {
            handleChange('provider', Object.keys(data)[0]);
          }
        })
        .catch(err => {
          console.error("Failed to load security providers", err);
          setLoading(false);
        });
    }, []);

    useEffect(() => {
      const incomingEdges = edges.filter(e => e.target === nodeId);
      const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
      const dataList = resolveUpstreamData(incomingNodes);
      const sample = dataList[0];
      if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
        setAvailableFields(Object.keys(sample));
      } else {
        for (const n of incomingNodes) {
          if (Array.isArray(n.data?.columns) && n.data.columns.length > 0) {
            setAvailableFields(n.data.columns);
            break;
          }
        }
      }
    }, [edges, nodes, nodeId]);

    const selectedProviderId = formData.provider;
    const providerMeta = providers[selectedProviderId];

    return (
      <>
        <div className="field">
          <label>Decryption Engine</label>
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
              <label>Encrypted Field to Decrypt</label>
              {availableFields.length > 0 ? (
                <select
                  value={formData.field || ''}
                  onChange={(e) => handleChange('field', e.target.value)}
                >
                  <option value="">-- Select a field --</option>
                  {availableFields.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              ) : (
                <input 
                  value={formData.field || ''} 
                  onChange={(e) => handleChange('field', e.target.value)}
                  placeholder="e.g. encrypted_revenue"
                />
              )}
            </div>
            
            <div className="field">
              <label>New Field Name (Plaintext)</label>
              <input 
                value={formData.target_field || ''} 
                onChange={(e) => handleChange('target_field', e.target.value)}
                placeholder="e.g. revenue"
              />
            </div>

            {/* Render dynamic parameters for decryption */}
            {providerMeta.params_schema && providerMeta.params_schema['decrypt'] && (
              <div style={{ padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4, marginTop: 8 }}>
                <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                  Decryption Parameters
                </p>
                {Object.entries(providerMeta.params_schema['decrypt']).map(([paramName, paramType]) => {
                  const paramValue = (formData.params && formData.params[paramName]) || '';
                  
                  return (
                    <div className="field" key={paramName} style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: '0.65rem' }}>{paramName}</label>
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
                    </div>
                  );
                })}
              </div>
            )}
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
    const dataList = resolveUpstreamData(incomingNodes);
    const previewData = dataList.length > 0 ? dataList.slice(0, 10) : null;

    let columnsSchema = null;
    let snapshotPath = null;
    for (const n of incomingNodes) {
      if (Array.isArray(n.data?.columns) && n.data.columns.length > 0) columnsSchema = n.data.columns;
      if (n.data?.snapshotPath) snapshotPath = n.data.snapshotPath;
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
            return { ...n, data: { ...n.data, ...updates } };
          }
          return n;
        }));
      }
    }
  }, [edges, id, nodes, setNodes]);

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
      <Handle type="target" position={Position.Left} id="data" style={{ left: -6, top: '50%', background: 'var(--emerald)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
      
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>
          Engine: <span style={{ color: 'var(--emerald)' }}>{data.provider || 'Unconfigured'}</span>
        </p>
        {data.field && (
          <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>
            Source: <span style={{ color: '#fff' }}>{data.field}</span>
          </p>
        )}
      </div>
      
      <Handle type="source" position={Position.Right} id="data" style={{ right: -6, top: '50%', background: 'var(--cyan)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
    </BaseNode>
  );
});
