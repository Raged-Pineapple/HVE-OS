import React, { memo, useState, useEffect, useRef } from 'react';
import { useEdges, useNodes, Handle, Position, useReactFlow } from 'reactflow';
import { Plus, AlertTriangle } from 'lucide-react';
import BaseNode from '../BaseNode';
import { attrKeyFromHandle, resolveAttrValue } from '../../../utils/pipelineUtils.js';

export const config = {
  type: 'add',
  category: 'logic',
  label: 'Add',
  icon: Plus,
  color: 'var(--accent-blue)',
  SettingsForm: ({ formData, handleChange }) => (
    <div className="field">
      <label>Constant to Add</label>
      <input
        type="number"
        value={formData.constant ?? 0}
        onChange={e => handleChange('constant', Number(e.target.value))}
        placeholder="Enter integer"
      />
      <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>
        This value is added to every connected attribute individually.
      </p>
    </div>
  ),
};

const detectType = (val) => {
  if (val === null || val === undefined || val === 'null' || val === 'None') return 'null';
  if (!isNaN(val) && String(val).trim() !== '') return 'number';
  return 'string';
};


export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [rows, setRows] = useState([]); // { handle, attrKey, inputValue, result, error }

  const edges = useEdges();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();
  // Keep a ref to nodes so the effect can read current node data
  // without including `nodes` in the dep array (which causes infinite loops via setNodes)
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; });
  const prevResultsRef = useRef(null);

  const constant = data.constant ?? 0;

  useEffect(() => {
    const incomingEdges = edges.filter(e => e.target === id);

    const computed = incomingEdges.map(edge => {
      const sourceNode = nodesRef.current.find(n => n.id === edge.source);
      const handle = edge.sourceHandle || 'default';
      const attrKey = attrKeyFromHandle(handle);

      const entity = sourceNode?.data?.resolvedEntity ?? null;
      const inputValue = resolveAttrValue(entity, attrKey);
      const type = detectType(inputValue);

      let result = null;
      let error = null;

      if (type === 'null') {
        error = 'NULL INPUT';
      } else if (type !== 'number') {
        error = 'TYPE ERROR: NOT NUMERIC';
      } else {
        result = Number(inputValue) + Number(constant);
      }

      return { handle, attrKey, inputValue, result, error };
    });

    setRows(computed);

    // Push results into node data so downstream nodes can read them.
    // Only call setNodes if the output actually changed — prevents infinite loop.
    const resolvedResults = {};
    computed.forEach(r => {
      if (r.result !== null) resolvedResults[r.attrKey] = r.result;
    });
    const serialised = JSON.stringify(resolvedResults);
    if (prevResultsRef.current !== serialised) {
      prevResultsRef.current = serialised;
      setNodes(nds => nds.map(n =>
        n.id === id ? { ...n, data: { ...n.data, resolvedEntity: resolvedResults } } : n
      ));
    }
  }, [edges, id, constant, setNodes]);

  return (
    <BaseNode
      label="Add"
      icon={Plus}
      type="add"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color="var(--accent-blue)"
      hideDefaultSource={true}
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8, position: 'relative' }}>

        {/* Constant input badge — shown inline on the node */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginBottom: 10, padding: '4px 8px',
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: 6,
        }}>
          <Plus size={12} color="var(--accent-blue)" />
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', flex: 1 }}>Constant</span>
          <input
            type="number"
            value={constant}
            onMouseDown={e => e.stopPropagation()}
            onChange={e => {
              const val = Number(e.target.value);
              setNodes(nds => nds.map(n =>
                n.id === id ? { ...n, data: { ...n.data, constant: val } } : n
              ));
            }}
            style={{
              width: 52,
              padding: '2px 6px',
              fontSize: '0.65rem',
              fontFamily: 'JetBrains Mono',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 4,
              color: 'var(--accent-blue)',
              fontWeight: 700,
              textAlign: 'center',
            }}
          />
        </div>

        {rows.length === 0 ? (
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Connect attr-out handles to add the constant.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map((row, idx) => (
              <div key={`${row.handle}-${idx}`} style={{ position: 'relative' }}>
                {/* Left input handle */}
                <Handle
                  type="target"
                  id={row.handle}
                  position={Position.Left}
                  style={{
                    left: -6,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'var(--accent-blue)',
                    width: 10, height: 10,
                    border: '2px solid var(--bg-surface)',
                    position: 'absolute',
                  }}
                />

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 8px 5px 10px',
                  background: row.error ? 'rgba(239,68,68,0.07)' : 'rgba(0,0,0,0.15)',
                  borderRadius: 6,
                  border: `1px solid ${row.error ? 'rgba(239,68,68,0.35)' : 'var(--border-subtle)'}`,
                  fontSize: '0.6rem',
                  minWidth: 220,
                }}>
                  {/* Attribute key */}
                  <span style={{ color: 'var(--cyan)', fontWeight: 600, minWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.attrKey}
                  </span>

                  {/* Input value */}
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'JetBrains Mono', minWidth: 36, textAlign: 'right' }}>
                    {row.inputValue !== null ? String(row.inputValue) : <span style={{ opacity: 0.4, fontStyle: 'italic' }}>null</span>}
                  </span>

                  {row.error ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto', color: '#ef4444', fontSize: '0.55rem', fontWeight: 600 }}>
                      <AlertTriangle size={9} />
                      {row.error}
                    </span>
                  ) : (
                    <>
                      {/* Arrow + constant */}
                      <span style={{ color: 'var(--text-muted)', opacity: 0.5, margin: '0 2px' }}>→</span>
                      <span style={{ color: 'var(--accent-blue)', fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
                        +{constant}
                      </span>
                      <span style={{ color: 'var(--text-muted)', opacity: 0.5, margin: '0 2px' }}>→</span>

                      {/* Result value */}
                      <span style={{
                        color: 'var(--emerald)',
                        fontFamily: 'JetBrains Mono',
                        fontWeight: 700,
                        marginLeft: 'auto',
                        marginRight: 14,
                      }}>
                        {row.result}
                      </span>
                    </>
                  )}
                </div>

                {/* Right output handle per attribute — only if valid result */}
                {!row.error && (
                  <Handle
                    type="source"
                    id={`add-out-${row.attrKey}`}
                    position={Position.Right}
                    style={{
                      right: -6,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'var(--emerald)',
                      width: 10, height: 10,
                      border: '2px solid var(--bg-surface)',
                      position: 'absolute',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </BaseNode>
  );
});
