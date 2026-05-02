import React from 'react';
import { Handle, Position } from 'reactflow';
import { ChevronDown, ChevronUp } from 'lucide-react';

const BaseNode = ({ 
  label, 
  icon: Icon, 
  type, 
  data, 
  selected, 
  isExpanded, 
  setIsExpanded, 
  children,
  color = "var(--cyan)"
}) => {
  return (
    <div className={`card custom-node ${type} ${selected ? 'selected' : ''}`} style={{ 
        minWidth: 200, 
        padding: 0, 
        overflow: 'visible',
        position: 'relative' 
    }}>
      {/* Header with Background Color */}
      <div className="node-header" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          background: `linear-gradient(to right, ${color}22, transparent)`,
          borderTopLeftRadius: '11px',
          borderTopRightRadius: '11px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={16} color={color} />
          <span className="node-title" style={{ fontWeight: 600, fontSize: '0.85rem' }}>{label}</span>
        </div>
        {setIsExpanded && (
          <button 
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
          >
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      
      <div className="node-content" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isExpanded ? 8 : 0 }}>
            <span className="node-tag" style={{ fontSize: '0.6rem', opacity: 0.6, textTransform: 'uppercase' }}>
                {type}
            </span>
            <span style={{ fontSize: '0.65rem', fontFamily: 'JetBrains Mono', opacity: 0.5 }}>{data.id}</span>
        </div>
        {isExpanded && children}
      </div>

      {/* Global Handles when Collapsed */}
      {!isExpanded && (
        <>
            <Handle 
                type="target" 
                position={Position.Left} 
                style={{ left: -8, background: 'var(--text-muted)', width: 10, height: 10, border: '2px solid var(--bg-surface)' }} 
            />
            <Handle 
                type="source" 
                position={Position.Right} 
                style={{ right: -8, background: color, width: 10, height: 10, border: '2px solid var(--bg-surface)' }} 
            />
        </>
      )}
    </div>
  );
};

export default BaseNode;
