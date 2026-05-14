import React, { memo, useState } from 'react';
import { Handle, Position, useReactFlow } from 'reactflow';
import { Type } from 'lucide-react';
import BaseNode from '../BaseNode';

export const config = {
  type: 'stringNode',
  category: 'logic',
  label: 'String',
  icon: Type,
  color: '#3B82F6',
  SettingsForm: ({ formData, handleChange }) => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>String Value</label>
          <textarea 
            value={formData.stringValue || ''}
            onChange={(e) => {
              const val = e.target.value;
              handleChange('stringValue', val);
              
              let preview = { text: val };
              try {
                const parsed = JSON.parse(val);
                if (parsed && typeof parsed === 'object') preview = parsed;
              } catch (err) {}
              
              handleChange('resolvedEntity', preview);
            }}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem', minHeight: '60px', resize: 'vertical' }}
            placeholder="Enter your string here..."
          />
        </div>
      </div>
    );
  }
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const { setNodes } = useReactFlow();
  const handleNodeValueChange = (e) => {
    const val = e.target.value;
    let preview = { text: val };
    try {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === 'object') {
        preview = parsed;
      }
    } catch (err) {}
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, stringValue: val, resolvedEntity: preview } } : n)));
  };

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
      collapsedInfo={
        <span style={{ color: 'var(--cyan)' }}>
          {data.stringValue ? `"${data.stringValue.substring(0, 15)}${data.stringValue.length > 15 ? '...' : ''}"` : 'Empty'}
        </span>
      }
    >
      {/* Input Handle for optional upstream connections */}
      <Handle type="target" position={Position.Left} id="data" style={{ left: -6, top: '50%', background: 'var(--amber)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
      
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <textarea
          className="nodrag nopan"
          value={data.stringValue || ''}
          onChange={handleNodeValueChange}
          placeholder="Enter string..."
          style={{ width: '100%', padding: '4px 6px', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-primary)', fontSize: '0.7rem', minHeight: '40px', resize: 'vertical' }}
        />
      </div>
      
      {/* Output Handle */}
      <Handle type="source" position={Position.Right} id="data" style={{ right: -6, top: '50%', background: 'var(--cyan)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
    </BaseNode>
  );
});