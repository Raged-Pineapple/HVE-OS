import React, { memo } from 'react';
import { Handle, Position, useEdges, useNodes, useReactFlow } from 'reactflow';
import { Calculator, X } from 'lucide-react';
import BaseNode from '../BaseNode';

export const config = {
  type: 'math',
  category: 'logic',
  label: 'Math Operation',
  icon: Calculator,
  color: '#fbbf24',
  hideInSidebar: false,
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const incomingEdges = edges.filter(e => e.target === nodeId);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);

    const availableKeys = new Set();
    incomingEdges.forEach(edge => {
      const node = nodes.find(n => n.id === edge.source);
      if (!node) return;
      
      let dataToProcess = null;
      if (node.data && edge.sourceHandle && node.data[edge.sourceHandle] !== undefined) {
        dataToProcess = node.data[edge.sourceHandle];
      } else {
        dataToProcess = node.data?.data ?? node.data?.resolvedEntity ?? node.data?.extracted ?? null;
      }

      const entitiesToProcess = Array.isArray(dataToProcess) 
        ? dataToProcess 
        : (dataToProcess && typeof dataToProcess === 'object' ? [dataToProcess] : []);
      
      entitiesToProcess.forEach(item => {
        if (item && typeof item === 'object') {
          Object.keys(item).forEach(k => availableKeys.add(k));
        }
      });
    });

    const operations = formData.mathOperations || [];
    operations.forEach(op => {
      if (op.field) availableKeys.add(op.field);
    });

    const keyOptions = Array.from(availableKeys).sort();

    const addOperation = (field) => {
      if (!field) return;
      if (operations.find(o => o.field === field)) return;
      handleChange('mathOperations', [...operations, { field, operation: 'add', constant: 0 }]);
    };

    const updateOperation = (idx, key, val) => {
      const newOps = [...operations];
      newOps[idx] = { ...newOps[idx], [key]: val };
      handleChange('mathOperations', newOps);
    };

    const removeOperation = (idx) => {
      const newOps = [...operations];
      newOps.splice(idx, 1);
      handleChange('mathOperations', newOps);
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Add Target Field</label>
          <select 
            value=""
            onChange={(e) => addOperation(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          >
            <option value="" disabled>-- Select field to mutate --</option>
            {keyOptions.map(k => (
              <option key={k} value={k} disabled={operations.some(o => o.field === k)}>{k}</option>
            ))}
          </select>
        </div>

        {operations.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {operations.map((op, idx) => (
              <div key={idx} style={{ padding: '8px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--cyan)' }}>{op.field}</span>
                  <button 
                    onClick={() => removeOperation(idx)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  >
                    <X size={12} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select 
                    value={op.operation || 'add'} 
                    onChange={(e) => updateOperation(idx, 'operation', e.target.value)}
                    style={{ flex: 1, padding: '4px 6px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-primary)', fontSize: '0.7rem' }}
                  >
                    <option value="add">+</option>
                    <option value="subtract">-</option>
                    <option value="multiply">×</option>
                    <option value="divide">÷</option>
                  </select>
                  <input 
                    type="number" 
                    value={op.constant !== undefined ? op.constant : 0}
                    onChange={(e) => updateOperation(idx, 'constant', parseFloat(e.target.value) || 0)}
                    style={{ flex: 2, padding: '4px 6px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-primary)', fontSize: '0.7rem', fontFamily: 'monospace' }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {operations.length === 0 && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 4 }}>
            <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.05em' }}>Scalar Fallback</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <select 
                value={formData.operation || 'add'} 
                onChange={(e) => handleChange('operation', e.target.value)}
                style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
              >
                <option value="add">Add (+)</option>
                <option value="subtract">Subtract (-)</option>
                <option value="multiply">Multiply (×)</option>
                <option value="divide">Divide (÷)</option>
              </select>
              <input 
                type="number" 
                value={formData.constant !== undefined ? formData.constant : 0}
                onChange={(e) => handleChange('constant', parseFloat(e.target.value) || 0)}
                style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem', fontFamily: 'monospace' }}
              />
            </div>
            <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 8 }}>
              If no target fields are selected, this operation will be applied to the incoming scalar value.
            </p>
          </div>
        )}
      </div>
    );
  }
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = React.useState(true);
  
  const edges = useEdges();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();
  const prevInputRef = React.useRef(undefined);

  React.useEffect(() => {
    const incomingEdges = edges.filter(e => e.target === id);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    
    let sampleEntity = null;
    for (const node of incomingNodes) {
      const ent = node.data?.data || node.data?.extracted || node.data?.resolvedEntity || node.data?.pinned || node.data?.unpinned;
      const candidates = Array.isArray(ent) ? ent : (ent && typeof ent === 'object' ? [ent] : []);
      if (candidates.length > 0) {
        sampleEntity = candidates[0];
        break;
      }
    }

    if (sampleEntity) {
      const serialised = JSON.stringify(sampleEntity);
      if (prevInputRef.current !== serialised) {
        prevInputRef.current = serialised;
        setNodes(nds => nds.map(n => 
          n.id === id ? { ...n, data: { ...n.data, previewInput: sampleEntity } } : n
        ));
      }
    }
  }, [edges, id, nodes, setNodes]);

  const getOpSymbol = (op) => ({ 'add': '+', 'subtract': '-', 'multiply': '×', 'divide': '÷' }[op || 'add']);
  
  const operations = data.mathOperations || [];

  // Fallback info rendering for scalars
  const legacyOpSymbol = getOpSymbol(data.operation);
  const legacyConstant = data.constant !== undefined ? data.constant : 0;
  
  // Preview the result from the backend's metadata preview
  let resultPreview = null;
  if (data.resolvedEntity) {
    if (Array.isArray(data.resolvedEntity)) {
      resultPreview = `[...] Array (${data.resolvedEntity.length} items)`;
    } else {
      resultPreview = Object.keys(data.resolvedEntity).length > 1 ? "{...} Multi-field" : Object.values(data.resolvedEntity)[0];
    }
  }

  const collapsedContent = operations.length > 0 ? (
    <span style={{ color: 'var(--cyan)' }}>{operations.length} targets</span>
  ) : (
    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{legacyOpSymbol} {legacyConstant}</span>
  );

  return (
    <BaseNode
      label={data.label || config.label}
      icon={config.icon}
      type={config.type}
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color={config.color}
      hideDefaultSource={true}
      hideDefaultTarget={true}
      collapsedInfo={collapsedContent}
    >
      <Handle type="target" position={Position.Left} id="data" style={{ left: -6, top: '50%', background: 'var(--amber)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
      
      <div style={{ padding: '8px 0 0 0', borderTop: '1px solid var(--border-subtle)', marginTop: 8 }}>
        
        {operations.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
             {operations.map((op, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--cyan)', maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.field}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', padding: '2px 6px', borderRadius: 4 }}>
                    {getOpSymbol(op.operation)} {op.constant}
                  </span>
                </div>
             ))}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
             <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Scalar Op:</span>
             <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', padding: '2px 6px', borderRadius: 4 }}>
               {legacyOpSymbol} {legacyConstant}
             </span>
          </div>
        )}
        
        {resultPreview !== null && resultPreview !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-surface)', padding: '4px 8px', borderRadius: 4 }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Result:</span>
            <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--cyan)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(resultPreview)}</span>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="data" style={{ right: -6, top: '50%', background: 'var(--cyan)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
    </BaseNode>
  );
});