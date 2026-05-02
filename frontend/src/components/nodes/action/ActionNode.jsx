import React, { memo, useState } from 'react';
import { Zap } from 'lucide-react';
import BaseNode from '../BaseNode';

export const ActionNode = memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <BaseNode
      label="Action Executor"
      icon={Zap}
      type="action"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color="var(--accent-teal)"
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Endpoint: <span style={{ color: 'var(--accent-teal)', fontWeight: 600 }}>{data.webhook || 'System Default'}</span>
        </p>
      </div>
    </BaseNode>
  );
});
