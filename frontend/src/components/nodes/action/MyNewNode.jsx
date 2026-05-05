import { Sparkles } from 'lucide-react';
import React, { memo, useState } from 'react';
import BaseNode from '../BaseNode';

export const config = {
  type: 'myNewNode',           // A unique string identifier for React Flow
  category: 'action',          // The sidebar tab it belongs in ('logic', 'ai', 'decision', 'action')
  label: 'My New Node',        // The text displayed on the draggable card
  icon: Sparkles,              // An icon component (usually from lucide-react)
  color: 'var(--accent-purple)',// (Optional) The primary accent color for the node
  // (Optional) Define a custom settings form for the Settings Panel
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => (
    <div className="field">
      <label>My Custom Setting</label>
      <input 
        value={formData.mySetting || ''}
        onChange={(e) => handleChange('mySetting', e.target.value)}
        placeholder="Enter a value"
      />
      <p style={{ fontSize: '0.6rem' }}>Connected nodes: {edges.filter(e => e.target === nodeId).length}</p>
    </div>
  )
};

// The default export MUST be the React component
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
      {/* Your custom node content goes here */}
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Status: <span style={{ color: config.color, fontWeight: 600 }}>Active</span>
        </p>
      </div>
    </BaseNode>
  );
});
