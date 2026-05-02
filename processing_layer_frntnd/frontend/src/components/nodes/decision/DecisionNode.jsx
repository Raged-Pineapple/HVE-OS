import React, { memo, useState } from 'react';
import { Filter } from 'lucide-react';
import BaseNode from '../BaseNode';

export const config = {
  type: 'decision',
  category: 'decision',
  label: 'Decision',
  icon: Filter,
  color: 'var(--accent-orange)',
  SettingsForm: ({ formData, handleChange }) => (
    <div className="field">
      <label>Logic Rules (JSON)</label>
      <textarea 
        style={{ minHeight: '120px', fontFamily: 'JetBrains Mono', fontSize: '0.8rem' }}
        value={formData.rules || JSON.stringify({ "condition": "value > 100", "then": "alert" }, null, 2)}
        onChange={(e) => handleChange('rules', e.target.value)}
      />
    </div>
  )
};

export default memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <BaseNode
      label="Decision Engine"
      icon={Filter}
      type="decision"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color="var(--accent-orange)"
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Rules</p>
        <div style={{ 
          fontSize: '0.65rem', 
          fontFamily: 'JetBrains Mono', 
          background: 'rgba(0,0,0,0.3)', 
          padding: 8, 
          borderRadius: 4,
          color: 'var(--accent-orange)'
        }}>
          {data.rules ? (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{data.rules}</pre>
          ) : (
            "No rules defined."
          )}
        </div>
      </div>
    </BaseNode>
  );
});
