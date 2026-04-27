import React, { memo, useState, useEffect } from 'react';
import { Handle, Position } from 'reactflow';
import { Activity, Eye, EyeOff } from 'lucide-react';
import { getEntityKeys } from '../../../api/client.js';
import BaseNode from '../BaseNode';

export const LogicTriggerNode = memo(({ data, selected }) => {
  const [keys, setKeys] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  useEffect(() => {
    if (data.id && data.id !== "Unconfigured") {
      getEntityKeys(data.id)
        .then(setKeys)
        .catch(err => console.error("Error fetching keys:", err));
    }
  }, [data.id]);

  const displayedKeys = showMeta ? keys : keys.filter(k => !k.startsWith('_'));

  return (
    <BaseNode
      label={data.id || "Logic Trigger"}
      icon={Activity}
      type="input"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color="var(--accent-blue)"
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingLeft: 4, paddingRight: 4 }}>
          <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0 }}>Graph Properties</p>
          <button 
            onClick={() => setShowMeta(!showMeta)}
            style={{ background: 'none', border: 'none', color: showMeta ? 'var(--cyan)' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
          >
            {showMeta ? <Eye size={12} /> : <EyeOff size={12} />}
            <span style={{ fontSize: '0.55rem' }}>META</span>
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {displayedKeys.map((key) => (
            <div key={key} style={{ 
              position: 'relative', 
              padding: '4px 8px', 
              background: 'var(--bg-elevated)', 
              borderRadius: 4,
              fontSize: '0.7rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              margin: '0 8px'
            }}>
              <Handle 
                type="target" 
                position={Position.Left} 
                id={`${key}-target`} 
                style={{ left: -6, background: 'var(--amber)', width: 12, height: 12, border: '2px solid var(--bg-surface)' }} 
              />
              <span style={{ fontFamily: 'JetBrains Mono' }}>{key}</span>
              <Handle 
                type="source" 
                position={Position.Right} 
                id={`${key}-source`} 
                style={{ right: -6, background: 'var(--cyan)', width: 12, height: 12, border: '2px solid var(--bg-surface)' }} 
              />
            </div>
          ))}
        </div>
      </div>
    </BaseNode>
  );
});
