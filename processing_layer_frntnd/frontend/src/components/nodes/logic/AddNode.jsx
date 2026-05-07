import React, { memo, useState, useEffect, useRef } from 'react';
import { useEdges, useNodes, Handle, Position, useReactFlow } from 'reactflow';
import { PlusCircle } from 'lucide-react';
import BaseNode from '../BaseNode';
import { attrKeyFromHandle, resolveAttrValue } from '../../../utils/pipelineUtils.js';

export const config = {
  type: 'add',
  category: 'logic',
  label: 'Add',
  icon: PlusCircle,
  color: 'var(--accent-blue)',
};

const detectType = (val) => {
  if (val === null || val === undefined || val === 'null' || val === 'None') return 'null';
  if (!isNaN(val) && String(val).trim() !== '') return 'number';
  return 'string';
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputRows, setInputRows] = useState([]);

  const edges = useEdges();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();

  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; });
  const prevSumRef = useRef(null);

  const activeInputs = data.activeInputs || [];
  const constant = data.constant ?? 0;
  const constantType = data.constantType || 'int';

  // Resolve incoming edges → attribute rows
  useEffect(() => {
    const incomingEdges = edges.filter(e => e.target === id);
    const rows = incomingEdges.map(edge => {
      const sourceNode = nodesRef.current.find(n => n.id === edge.source);
      const handle = edge.sourceHandle || 'default';
      const attrKey = attrKeyFromHandle(handle);
      const entity = sourceNode?.data?.resolvedEntity ?? null;
      const value = resolveAttrValue(entity, attrKey);
      return { handle, attrKey, value, rowKey: edge.id };
    });
    setInputRows(rows);
  }, [edges, id]);

  // Compute sum: active rows + constant
  const computeSum = () => {
    let sum = 0;
    for (const row of inputRows) {
      if (activeInputs.includes(row.rowKey)) {
        const n = Number(row.value);
        if (!isNaN(n)) sum += n;
      }
    }
    const c = constantType === 'float' ? parseFloat(constant) : parseInt(constant, 10);
    if (!isNaN(c)) sum += c;
    return sum;
  };
  const sum = computeSum();

  // Push sum into node store for downstream propagation (guarded)
  useEffect(() => {
    const s = String(sum);
    if (prevSumRef.current !== s) {
      prevSumRef.current = s;
      setNodes(nds => nds.map(n =>
        n.id === id ? { ...n, data: { ...n.data, resolvedEntity: { sum } } } : n
      ));
    }
  }, [sum, id, setNodes]);

  const setData = (patch) => {
    setNodes(nds => nds.map(n =>
      n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
    ));
  };

  const handleClick = (rowKey) => {
    if (activeInputs.includes(rowKey)) return;
    setData({ activeInputs: [...activeInputs, rowKey] });
  };

  const handleDoubleClick = (e, rowKey) => {
    e.preventDefault();
    e.stopPropagation();
    setData({ activeInputs: activeInputs.filter(k => k !== rowKey) });
  };

  return (
    <BaseNode
      label="Add"
      icon={PlusCircle}
      type="add"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color="var(--accent-blue)"
      hideDefaultSource={true}
    >
      <div style={{
        display: 'flex',
        marginTop: 12,
        borderTop: '1px solid var(--border-subtle)',
        paddingTop: 10,
        minWidth: 320,
      }}>

        {/* ── LEFT COLUMN: inputs + constant ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 12 }}>

          {inputRows.length === 0 && (
            <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: '0 0 4px 4px' }}>
              Connect attr-out handles
            </p>
          )}

          {inputRows.map((row) => {
            const isActive = activeInputs.includes(row.rowKey);
            const numVal = Number(row.value);
            const isNumeric = row.value !== null && row.value !== undefined && !isNaN(numVal);
            const type = detectType(row.value);

            return (
              // ⚠ NO position:relative here — Handle must anchor to node root, not this div
              <div
                key={row.rowKey}
                onClick={() => handleClick(row.rowKey)}
                onDoubleClick={(e) => handleDoubleClick(e, row.rowKey)}
                title={isActive ? 'Double-click to remove from sum' : 'Click to include in sum'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px 4px 6px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  userSelect: 'none',
                  background: isActive ? 'rgba(59,130,246,0.08)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(59,130,246,0.3)' : 'transparent'}`,
                  transition: 'background 0.15s, border 0.15s',
                }}
              >
                {/* Per-row target handle — no positioned ancestor → anchors to node left edge */}
                <Handle
                  type="target"
                  id={row.handle}
                  position={Position.Left}
                  style={{
                    background: isActive ? 'var(--accent-blue)' : 'var(--bg-surface)',
                    width: 10, height: 10,
                    border: `2px solid ${isActive ? 'var(--accent-blue)' : 'var(--text-muted)'}`,
                    transition: 'all 0.15s',
                  }}
                />

                {/* Active state dot */}
                <div style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: isActive ? 'var(--accent-blue)' : 'var(--border-subtle)',
                  transition: 'background 0.15s',
                }} />

                {/* Attr name */}
                <span style={{
                  fontSize: '0.65rem',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: isActive ? 600 : 400,
                  flex: 1,
                }}>
                  {row.attrKey}
                </span>

                {/* Value + type badge */}
                <span style={{ fontSize: '0.55rem', color: isNumeric ? 'var(--cyan)' : '#ef4444', fontFamily: 'JetBrains Mono' }}>
                  {row.value !== null && row.value !== undefined
                    ? (isNumeric ? numVal : '⚠ NaN')
                    : <span style={{ opacity: 0.4, fontStyle: 'italic' }}>null</span>}
                </span>
                <span style={{
                  fontSize: '0.45rem', padding: '1px 4px', borderRadius: 3,
                  background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)',
                  fontFamily: 'JetBrains Mono',
                }}>
                  {type}
                </span>
              </div>
            );
          })}

          {/* ── Constant row ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginTop: 6, paddingTop: 6, paddingLeft: 4,
            borderTop: '1px dashed var(--border-subtle)',
          }}>
            <PlusCircle size={13} color="var(--accent-blue)" style={{ flexShrink: 0 }} />
            <input
              type="number"
              value={constant}
              onMouseDown={e => e.stopPropagation()}
              onChange={e => setData({ constant: e.target.value })}
              style={{
                width: 56, padding: '2px 6px',
                fontSize: '0.65rem', fontFamily: 'JetBrains Mono',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)', borderRadius: 4,
                color: 'var(--accent-blue)', fontWeight: 700, textAlign: 'center',
              }}
            />
            <select
              value={constantType}
              onMouseDown={e => e.stopPropagation()}
              onChange={e => setData({ constantType: e.target.value })}
              style={{
                fontSize: '0.55rem', padding: '2px 4px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)', borderRadius: 4,
                color: 'var(--text-muted)',
              }}
            >
              <option value="int">int</option>
              <option value="float">float</option>
            </select>
          </div>
        </div>

        {/* ── DIVIDER ── */}
        <div style={{ width: 1, background: 'var(--border-subtle)', margin: '0 2px', alignSelf: 'stretch' }} />

        {/* ── RIGHT COLUMN: fin_val + SUM output ── */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 4, paddingLeft: 10, paddingRight: 22,
          minWidth: 90,
        }}>
          <span style={{
            fontSize: '0.48rem', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>
            fin_val
          </span>

          {/* Live SUM value box */}
          <div style={{
            padding: '5px 12px',
            background: 'rgba(52,211,153,0.1)',
            border: '1.5px solid rgba(52,211,153,0.4)',
            borderRadius: 8,
            textAlign: 'center',
            minWidth: 60,
          }}>
            <span style={{
              fontSize: '1rem', fontWeight: 800,
              fontFamily: 'JetBrains Mono',
              color: 'var(--emerald)',
            }}>
              {Number.isInteger(sum) ? sum : parseFloat(sum.toFixed(4))}
            </span>
          </div>

          <span style={{
            fontSize: '0.48rem', color: 'var(--emerald)',
            fontWeight: 700, letterSpacing: '0.12em',
          }}>
            SUM
          </span>

          {/* Prominent output source handle — no positioned ancestor → right edge of node */}
          <Handle
            type="source"
            id="sum-out"
            position={Position.Right}
            style={{
              background: 'var(--emerald)',
              width: 14, height: 14,
              border: '3px solid var(--bg-surface)',
              boxShadow: '0 0 0 2px var(--emerald)',
            }}
          />
        </div>

      </div>
    </BaseNode>
  );
});
