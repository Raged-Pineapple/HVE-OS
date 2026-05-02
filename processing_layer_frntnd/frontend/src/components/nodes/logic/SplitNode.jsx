import React, { memo, useState, useEffect } from 'react';
import { Split, Database, Key } from 'lucide-react';
import { getEntityKeys } from '../../../api/client.js';
import BaseNode from '../BaseNode';

export const config = {
  type: 'split',
  category: 'logic',
  label: 'Split',
  icon: Split,
  color: 'var(--accent-blue)',
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const [incomingSchema, setIncomingSchema] = useState({});
    const [loading, setLoading] = useState(false);

    const incomingEdges = edges.filter(e => e.target === nodeId);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    
    const outgoingEdges = edges.filter(e => e.source === nodeId);
    const outgoingNodes = outgoingEdges.map(e => nodes.find(n => n.id === e.target)).filter(Boolean);

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
          <label>Split Logic</label>
          <select 
            value={formData.logic || 'Balanced'} 
            onChange={(e) => handleChange('logic', e.target.value)}
          >
            <option>Balanced</option>
            <option>Round Robin</option>
            <option>Conditional</option>
            <option>Random</option>
          </select>
        </div>

        <div className="field">
          <label>Partitions</label>
          <input 
            type="number" 
            min="2" max="10"
            value={formData.partitions || 2}
            onChange={(e) => handleChange('partitions', parseInt(e.target.value))}
          />
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
          <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, letterSpacing: '0.05em' }}>Incoming Stream Schema</p>
          
          <div style={{ marginBottom: 12 }}>
            {incomingNodes.length > 0 ? (
              incomingNodes.map(n => (
                <div key={n.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--bg-elevated)', borderRadius: 4, fontSize: '0.7rem', marginBottom: 6 }}>
                    <Database size={12} color="var(--emerald)" />
                    <span style={{ fontWeight: 600 }}>{n.data.id || n.id}</span>
                  </div>
                  
                  {loading ? (
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 8 }}>Loading schema...</p>
                  ) : incomingSchema[n.data.id] ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginLeft: 8 }}>
                      {incomingSchema[n.data.id].map(key => (
                        <span key={key} style={{ 
                          fontSize: '0.6rem', 
                          padding: '2px 6px', 
                          background: 'rgba(52, 211, 153, 0.1)', 
                          color: 'var(--emerald)', 
                          borderRadius: 4,
                          border: '1px solid rgba(52, 211, 153, 0.2)',
                          fontFamily: 'JetBrains Mono'
                        }}>
                          {key}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 8, fontStyle: 'italic' }}>No schema keys found.</p>
                  )}
                </div>
              ))
            ) : (
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No input connected.</p>
            )}
          </div>

          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Output Targets</label>
            {outgoingNodes.length > 0 ? (
              outgoingNodes.map(n => (
                <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--bg-elevated)', borderRadius: 4, fontSize: '0.7rem', marginBottom: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--cyan)' }} />
                  <span>{n.data.id || n.id}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem' }}>({n.type})</span>
                </div>
              ))
            ) : (
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No outputs connected.</p>
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
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Split logic: <span style={{ color: config.color, fontWeight: 600 }}>{data.logic || 'Balanced'}</span>
        </p>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Partitions: <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{data.partitions || 2}</span>
        </p>
      </div>
    </BaseNode>
  );
});
