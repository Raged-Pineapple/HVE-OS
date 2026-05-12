import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Database, Eye, EyeOff } from 'lucide-react';
import BaseNode from '../BaseNode';

export const config = {
  type: 'source',
  category: 'input',
  label: 'Source',
  icon: Database,
  color: '#3B82F6',
  hideInSidebar: false
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  const sourceId = data.source_id || data.id;
  const keys = data.keys || [];
  const entityCount = data.count || 0;

  if (!sourceId) {
    return (
      <BaseNode
        label="Source (unconfigured)"
        icon={Database}
        type={config.type}
        data={data}
        selected={selected}
        isExpanded={isExpanded}
        setIsExpanded={setIsExpanded}
        color={config.color}
      />
    );
  }

  const displayedKeys = showMeta ? keys : keys.filter(k => !k.startsWith('_'));

  const customSourceHandle = (
    <Handle 
      type="source" 
      position={Position.Right} 
      id="data" 
      style={{ 
        right: -6, 
        background: 'var(--cyan)', 
        width: 14, 
        height: 14, 
        border: '2px solid var(--bg-surface)',
        boxShadow: '0 0 4px var(--cyan)'
      }} 
    />
  );

  return (
    <BaseNode
      label={sourceId}
      icon={Database}
      type={config.type}
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color={config.color}
      hideDefaultSource={true}
      hideDefaultTarget={true}
      customSourceHandle={customSourceHandle}
      collapsedInfo={<><span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{sourceId}</span>{entityCount > 0 && <span style={{ marginLeft: 8 }}> · {entityCount} entities</span>}</>}
    >
      <div>
        {displayedKeys.length > 0 && (
          <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <button 
                  onClick={() => setShowMeta(!showMeta)}
                  style={{ background: 'none', border: 'none', color: showMeta ? 'var(--cyan)' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0, fontSize: '0.55rem' }}
                >
                  {showMeta ? <Eye size={12} /> : <EyeOff size={12} />}
                  META
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {displayedKeys.map((key) => (
                  <div key={key} style={{ 
                    padding: '2px 8px', 
                    background: 'var(--bg-elevated)', 
                    borderRadius: 4,
                    fontSize: '0.7rem',
                    fontFamily: 'JetBrains Mono'
                  }}>
                    {key}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
    </BaseNode>
  );
});