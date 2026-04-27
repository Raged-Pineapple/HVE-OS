import React, { memo, useState } from 'react';
import { Plus } from 'lucide-react';
import BaseNode from '../BaseNode';

export const AddNode = memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <BaseNode
      label="Add"
      icon={Plus}
      type="logic"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color="var(--accent-blue)"
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Operation: <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>ADDITION</span>
        </p>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Constant Value: <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{data.value || 0}</span>
        </p>
      </div>
    </BaseNode>
  );
});
