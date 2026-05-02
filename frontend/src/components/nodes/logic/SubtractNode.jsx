import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Minus } from 'lucide-react';
import BaseNode from '../BaseNode';

export const SubtractNode = memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const valA = data.a !== undefined ? data.a : 1.0;
  const valB = data.b !== undefined ? data.b : 1.0;

  return (
    <BaseNode
      label={`Subtract(${valA}, ${valB})`}
      icon={Minus}
      type="logic"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color="#34d399"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
        {/* Input A Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Handle 
              type="target" 
              position={Position.Left} 
              id="a" 
              style={{ 
                left: -22, 
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'var(--text-muted)', 
                width: 12, 
                height: 12, 
                border: '2px solid var(--bg-surface)' 
              }} 
            />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: 12 }}>A</span>
            <div style={{ 
              background: 'rgba(0,0,0,0.15)', 
              border: '1px solid var(--border-subtle)', 
              borderRadius: 4, 
              padding: '2px 10px',
              fontSize: '0.8rem',
              fontFamily: 'JetBrains Mono',
              minWidth: 44,
              textAlign: 'center',
              color: 'var(--text-primary)'
            }}>
              {valA}
            </div>
          </div>
          {/* Result Handle */}
          <Handle 
            type="source" 
            position={Position.Right} 
            id="result" 
            style={{ 
              right: -22, 
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'var(--cyan)', 
              width: 14, 
              height: 14, 
              border: '2px solid var(--bg-surface)' 
            }} 
          />
        </div>

        {/* Input B Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
          <Handle 
            type="target" 
            position={Position.Left} 
            id="b" 
            style={{ 
              left: -22, 
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'var(--text-muted)', 
              width: 12, 
              height: 12, 
              border: '2px solid var(--bg-surface)' 
            }} 
          />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: 12 }}>B</span>
          <div style={{ 
            background: 'rgba(0,0,0,0.15)', 
            border: '1px solid var(--border-subtle)', 
            borderRadius: 4, 
            padding: '2px 10px',
            fontSize: '0.8rem',
            fontFamily: 'JetBrains Mono',
            minWidth: 44,
            textAlign: 'center',
            color: 'var(--text-primary)'
          }}>
            {valB}
          </div>
        </div>
      </div>
    </BaseNode>
  );
});
