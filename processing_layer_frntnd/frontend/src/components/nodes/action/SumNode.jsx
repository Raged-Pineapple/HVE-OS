import React, { memo, useState } from 'react';
import { Sigma } from 'lucide-react';
import BaseNode from '../BaseNode';

export const SumNode = memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <BaseNode
      label="Sum"
      icon={Sigma}
      type="action"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color="var(--accent-teal)"
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Mode: <span style={{ color: 'var(--accent-teal)', fontWeight: 600 }}>CUMULATIVE SUM</span>
        </p>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Offset: <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{data.offset || 0}</span>
        </p>
      </div>
    </BaseNode>
  );
});
