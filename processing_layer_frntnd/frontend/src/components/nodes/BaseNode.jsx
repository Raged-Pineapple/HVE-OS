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
  color = "var(--cyan)",
  hideDefaultSource = false
}) => {
  return (
    <div className={`card custom-node ${type} ${selected ? 'selected' : ''}`} style={{ minWidth: 200 }}>
      <div className="node-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={18} color={color} />
          <span className="node-title" style={{ fontWeight: 600 }}>{label}</span>
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
      
      <div className="node-content" style={{ padding: '8px 0' }}>
        <span className="node-tag" style={{ fontSize: '0.65rem', opacity: 0.8 }}>
          {type.toUpperCase()}: {data.id}
        </span>
        {isExpanded && children}
      </div>

      {!hideDefaultSource && (
        <Handle 
          type="source" 
          position={Position.Right} 
          style={{ 
            right: -6, 
            background: 'var(--cyan)', 
            width: 12, 
            height: 12, 
            border: '2px solid var(--bg-surface)' 
          }} 
        />
      )}
      
      {/* Default target handle for non-input nodes */}
      {type !== 'input' && (
        <Handle 
          type="target" 
          position={Position.Left} 
          style={{ 
            left: -6, 
            background: 'var(--amber)', 
            width: 12, 
            height: 12, 
            border: '2px solid var(--bg-surface)' 
          }} 
        />
      )}
    </div>
  );
};

export default BaseNode;
