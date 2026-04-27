import React, { memo, useState } from 'react';
import { Brain } from 'lucide-react';
import BaseNode from '../BaseNode';

export const AIAnalysisNode = memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <BaseNode
      label="AI Analysis"
      icon={Brain}
      type="ai"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color="var(--accent-purple)"
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Model: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{data.model || 'Kalman Filter'}</span>
        </p>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Confidence: <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{data.threshold || 0.8}</span>
        </p>
      </div>
    </BaseNode>
  );
});
