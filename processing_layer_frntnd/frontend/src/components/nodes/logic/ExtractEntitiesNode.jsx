import React, { memo, useState, useEffect } from 'react';
import { Fingerprint, Database, Tags } from 'lucide-react';
import { getEntityKeys } from '../../../api/client.js';
import BaseNode from '../BaseNode';

export const config = {
  type: 'extractEntities',
  category: 'logic',
  label: 'Extract Entities',
  icon: Fingerprint,
  color: 'var(--accent-blue)',
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const [incomingSchema, setIncomingSchema] = useState({});
    const [loading, setLoading] = useState(false);

    const incomingEdges = edges.filter(e => e.target === nodeId);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);

    useEffect(() => {
      const sources = incomingNodes.filter(n => n.type === 'dataTrigger' && n.data?.id);
      if (sources.length > 0) {
        setLoading(true);
        Promise.all(sources.map(s => 
          getEntityKeys(s.data.id).then(keys => ({ id: s.data.id, keys }))
        )).then(results => {
          const schemaMap = {};
          results.forEach(res => schemaMap[res.id] = res.keys);
          setIncomingSchema(schemaMap);
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

export default memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

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
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Tags size={12} color="var(--accent-blue)" />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>
            Strategy: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{data.strategy || 'NER'}</span>
          </p>
        </div>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: 0 }}>
          Extracting: <span style={{ color: 'var(--cyan)' }}>{(data.selectedFields || []).length} fields</span>
        </p>
      </div>
    </BaseNode>
  );
});
