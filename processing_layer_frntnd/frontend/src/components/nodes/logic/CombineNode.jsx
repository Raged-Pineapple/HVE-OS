import React, { memo, useState, useEffect, useRef } from 'react';
import { useEdges, useNodes, Handle, Position, useReactFlow } from 'reactflow';
import { GitMerge, Plus, X, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import BaseNode from '../BaseNode';
import { getEntitiesByLabel, getEntityKeys } from '../../../api/client.js';
import { attrKeyFromHandle, resolveAttrValue, parsePythonLiteral } from '../../../utils/pipelineUtils.js';

export const config = {
  type: 'combine',
  category: 'logic',
  label: 'Combine',
  icon: GitMerge,
  color: '#a855f7',
};

// ─── helpers ────────────────────────────────────────────────────────────────

const STRATEGIES = [
  { value: 'pack',        label: 'Pack' },
  { value: 'rename',      label: 'Rename' },
  { value: 'conditional', label: 'Conditional' },
];

const CONDITIONS = ['always', '!null', '>0', '!=0'];

function applyTransforms(rawValue, transforms) {
  let v = Number(rawValue);
  if (isNaN(v)) return rawValue;
  for (const t of transforms) {
    if (t.op === 'add') {
      const c = t.constantType === 'float'
        ? parseFloat(t.constant)
        : parseInt(t.constant, 10);
      if (!isNaN(c)) v += c;
    }
  }
  return v;
}

function checkCondition(value, condition) {
  if (condition === 'always') return true;
  if (condition === '!null')  return value !== null && value !== undefined && value !== 'null' && value !== 'None';
  if (condition === '>0')     return Number(value) > 0;
  if (condition === '!=0')    return Number(value) !== 0;
  return true;
}

const fetchUpstreamEntities = async (srcNode, nodes, edges) => {
  if (srcNode.type === 'dataTrigger' && srcNode.data?.id) {
    return await getEntitiesByLabel(srcNode.data.id).catch(() => []);
  }
  if (srcNode.type === 'extractEntities') {
    const upEdges = edges.filter(e => e.target === srcNode.id);
    const upNodes = upEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    const trig = upNodes.find(n => n.type === 'dataTrigger' && n.data?.id);
    if (trig) {
      let dataList = await getEntitiesByLabel(trig.data.id).catch(() => []);
      const strategy = srcNode.data?.strategy || 'NER';
      const label = srcNode.data?.label || '';
      if (strategy === 'KeyPath' && label) {
        dataList = dataList.flatMap(item => {
          const parts = label.split('.');
          let current = item;
          for (let p of parts) {
            if (current === null || current === undefined) break;
            current = current[p];
          }
          return Array.isArray(current) ? current : (current ? [current] : []);
        });
      }
      return dataList;
    }
  }
  return [];
};

function buildOutput(slot, dataRows, transforms) {
  const result = {};
  for (const row of dataRows) {
    const asgn = (slot.assignments || {})[row.rowKey];
    if (!asgn || asgn.included === false) continue;
    if (!checkCondition(row.value, asgn.condition || 'always')) continue;
    const key = (slot.strategy === 'rename' && asgn.outputKey)
      ? asgn.outputKey
      : row.attrKey;
    result[key] = (slot.applyLogic && transforms.length) ? applyTransforms(row.value, transforms) : row.value;
  }
  return result;
}

// ─── component ──────────────────────────────────────────────────────────────

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded]   = useState(false);
  const [dataRows, setDataRows]       = useState([]);
  const [transforms, setTransforms]   = useState([]);
  const [openSlots, setOpenSlots]     = useState({});
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const toggleGroup = (key) => setCollapsedGroups(p => ({ ...p, [key]: !p[key] }));

  const edges = useEdges();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();
  const nodesRef    = useRef(nodes);
  const prevOutRef  = useRef('');

  useEffect(() => { nodesRef.current = nodes; });

  const slots = data.slots || [];

  // Track upstream data changes to force re-evaluation when async data arrives
  const incomingEdges = edges.filter(e => e.target === id);
  const upstreamDataStr = JSON.stringify(
    incomingEdges.map(e => {
      const src = nodes.find(n => n.id === e.source);
      return src ? { id: src.id, type: src.type, re: src.data?.resolvedEntity, c: src.data?.constant } : null;
    })
  );

  // ── resolve incoming edges ──────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;

    const resolveEdges = async () => {
      const rows = [], txs = [];

      for (const edge of incomingEdges) {
        const src = nodes.find(n => n.id === edge.source);
        if (!src) continue;

        // Logic connections MUST connect to the top logic handle
        if (edge.targetHandle === 'combine-logic-in') {
          if (src.type === 'add') {
            txs.push({
              op:           'add',
              constant:     src.data?.constant ?? 0,
              constantType: src.data?.constantType || 'int',
              edgeId:       edge.id,
            });
          }
          continue;
        }

        // Otherwise, it's a Data connection
        let value = null;
        let neo4jKeys = [];
        let groupName = 'Attributes';
        const handle  = edge.sourceHandle || 'default';
          let attrKey = attrKeyFromHandle(handle);

          // Fetch Neo4j Keys if possible
          if (src.type === 'dataTrigger' && src.data?.id) {
            neo4jKeys = await getEntityKeys(src.data.id).catch(() => []);
          } else if (src.type === 'extractEntities') {
            const upEdges = edges.filter(e => e.target === src.id);
            const upNodes = upEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
            const trig = upNodes.find(n => n.type === 'dataTrigger' && n.data?.id);
            if (trig) {
              neo4jKeys = await getEntityKeys(trig.data.id).catch(() => []);
            }
          }

          // If the upstream is extractEntities and it's a pinned handle, fetch it exactly like Explode Attributes (SplitNode) does
          if (src.type === 'extractEntities' && handle.startsWith('entity-out-pinned-')) {
            const pinnedName = handle.replace('entity-out-pinned-', '');
            attrKey = pinnedName;
            groupName = pinnedName;
            
            const dataList = await fetchUpstreamEntities(src, nodes, edges);
            const propToUse = src.data?.displayNameProperty;
            
            const ent = dataList.find((e, idx) => {
              let customName = null;
              if (propToUse) {
                const parts = propToUse.split('.');
                let current = e;
                for (let i = 0; i < parts.length; i++) {
                  if (current === null || current === undefined) break;
                  if (typeof current === 'string' && current.trim().startsWith('{')) {
                    try { current = JSON.parse(current.replace(/'/g, '"')); } catch (err) {}
                  }
                  current = current[parts[i]];
                }
                if (current !== null && current !== undefined && typeof current !== 'object') {
                  customName = String(current);
                }
              }
              const name = customName || e.name || e.title || e.id || `Entity ${idx + 1}`;
              return name === pinnedName;
            });
            
            if (ent) value = ent;
          } else {
            const entity = src.data?.resolvedEntity ?? null;
            value = resolveAttrValue(entity, attrKey);
            if (src.type === 'extractEntities') {
              groupName = attrKey; // Fallback group name
            }
          }
          
          // Auto-explode plain objects using Neo4j Keys if available (exactly like SplitNode)
          if (neo4jKeys.length > 0 && value && typeof value === 'object' && !Array.isArray(value)) {
             neo4jKeys.forEach(k => {
                let v = value[k];
                if (v === undefined && k.includes('.')) {
                  const parts = k.split('.');
                  let current = value;
                  for (let p of parts) {
                    if (current === null || current === undefined) break;
                    if (typeof current === 'string' && current.trim().startsWith('{')) {
                      try { current = JSON.parse(current.replace(/'/g, '"').replace(/: None/g, ': null').replace(/: True/g, ': true').replace(/: False/g, ': false')); } catch (e) {}
                    }
                    current = current[p];
                  }
                  if (current !== undefined) v = current;
                }
                rows.push({ handle, attrKey: k, value: v, rowKey: `${edge.id}-${k}`, groupName });
             });
          } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            Object.entries(value).forEach(([k, v]) => {
              rows.push({ handle, attrKey: k, value: v, rowKey: `${edge.id}-${k}`, groupName });
            });
          } else {
            rows.push({ handle, attrKey, value, rowKey: edge.id, groupName });
          }
        }

      if (isMounted) {
        setDataRows(rows);
        setTransforms(txs);
      }
    };

    resolveEdges();
    return () => { isMounted = false; };
  }, [edges, id, upstreamDataStr]);

  // ── auto-populate new rows into existing slots ──────────────────────────
  useEffect(() => {
    if (!dataRows.length) return;
    
    let changed = false;
    let nextSlots = [...slots];

    if (nextSlots.length === 0) {
      const newSlotId = `slot-${Date.now()}`;
      nextSlots.push({
        id: newSlotId,
        name: `slot_1`,
        strategy: 'pack',
        assignments: {},
        applyLogic: false,
      });
      changed = true;
      setOpenSlots(p => ({ ...p, [newSlotId]: true }));
    }

    nextSlots = nextSlots.map(slot => {
      const asgns = { ...(slot.assignments || {}) };
      for (const row of dataRows) {
        if (!(row.rowKey in asgns)) {
          asgns[row.rowKey] = { included: true, outputKey: row.attrKey, condition: 'always' };
          changed = true;
        }
      }
      return changed ? { ...slot, assignments: asgns } : slot;
    });

    if (changed) {
      // Use functional update to avoid stale state issues with slots
      setNodes(nds => nds.map(n => {
        if (n.id !== id) return n;
        // Merge the nextSlots into n.data.slots safely
        return { ...n, data: { ...n.data, slots: nextSlots } };
      }));
    }
  }, [dataRows]);

  // ── propagate resolvedEntity for each slot ──────────────────────────────
  useEffect(() => {
    if (!slots.length) return;
    const extra = {};
    slots.forEach((slot, i) => {
      const out = buildOutput(slot, dataRows, transforms);
      if (i === 0) extra.resolvedEntity = out;
      else         extra[`resolvedEntity_${slot.name}`] = out;
    });
    const str = JSON.stringify(extra);
    if (prevOutRef.current !== str) {
      prevOutRef.current = str;
      setNodes(nds => nds.map(n =>
        n.id === id ? { ...n, data: { ...n.data, ...extra } } : n
      ));
    }
  }, [dataRows, transforms, slots, id, setNodes]);

  // ── helpers ─────────────────────────────────────────────────────────────
  const setData = patch =>
    setNodes(nds => nds.map(n =>
      n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
    ));

  const addSlot = () => {
    const newSlot = {
      id:          `slot-${Date.now()}`,
      name:        `slot_${slots.length + 1}`,
      strategy:    'pack',
      assignments: Object.fromEntries(
        dataRows.map(r => [r.rowKey, { included: true, outputKey: r.attrKey, condition: 'always' }])
      ),
    };
    setData({ slots: [...slots, newSlot] });
    setOpenSlots(p => ({ ...p, [newSlot.id]: true }));
  };

  const removeSlot = id => setData({ slots: slots.filter(s => s.id !== id) });

  const updateSlot = (slotId, patch) =>
    setData({ slots: slots.map(s => s.id === slotId ? { ...s, ...patch } : s) });

  const updateAsgn = (slotId, rowKey, patch) => {
    const slot  = slots.find(s => s.id === slotId);
    if (!slot)  return;
    const asgns = { ...(slot.assignments || {}), [rowKey]: { ...(slot.assignments?.[rowKey] || {}), ...patch } };
    updateSlot(slotId, { assignments: asgns });
  };

  const toggleGroupSelection = (slotId, gRows, include) => {
    const slot = slots.find(s => s.id === slotId);
    if (!slot) return;
    const nextAsgns = { ...(slot.assignments || {}) };
    gRows.forEach(row => {
      nextAsgns[row.rowKey] = { ...(nextAsgns[row.rowKey] || { outputKey: row.attrKey, condition: 'always' }), included: include };
    });
    updateSlot(slotId, { assignments: nextAsgns });
  };

  // ── styles ──────────────────────────────────────────────────────────────
  const purple      = '#a855f7';
  const purpleDim   = 'rgba(168,85,247,0.08)';
  const purpleBdr   = 'rgba(168,85,247,0.22)';
  const yellowDim   = 'rgba(251,191,36,0.07)';
  const yellowBdr   = 'rgba(251,191,36,0.35)';

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <BaseNode
      label="Combine"
      icon={GitMerge}
      type="combine"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color={purple}
      hideDefaultSource={true}
    >
      {/* Top Handle for External Logic (Add Node) */}
      <Handle
        type="target"
        id="combine-logic-in"
        position={Position.Top}
        style={{
          background: '#fbbf24', // yellow for logic
          width: 12, height: 12,
          border: '2px solid var(--bg-surface)'
        }}
      />

      <div style={{
        display: 'flex',
        marginTop: 12,
        borderTop: '1px solid var(--border-subtle)',
        paddingTop: 10,
        minWidth: 320,
        gap: 0,
      }}>

        {/* ── LEFT: input rows ─────────────────────────────────────────── */}
        <div style={{
          flex: '0 0 130px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          paddingRight: 10,
          borderRight: '1px solid var(--border-subtle)',
        }}>
          <span style={{ fontSize: '0.46rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
            Inputs
          </span>

          {dataRows.length === 0 && transforms.length === 0 && (
            <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
              Connect attr handles
            </p>
          )}

          {/* Grouped Data rows */}
          {(() => {
            const groups = {};
            dataRows.forEach(row => {
              const gName = row.groupName || 'Attributes';
              if (!groups[gName]) groups[gName] = [];
              groups[gName].push(row);
            });

            return Object.entries(groups).map(([gName, gRows]) => {
              const groupKey = `input-${gName}`;
              const isCollapsed = !!collapsedGroups[groupKey];

              return (
                <div key={gName} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                  <div 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 4, 
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                    onClick={() => toggleGroup(groupKey)}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    {isCollapsed ? <ChevronRight size={10} color="var(--cyan)" /> : <ChevronDown size={10} color="var(--cyan)" />}
                    <span style={{ 
                      fontSize: '0.5rem', 
                      color: 'var(--cyan)', 
                      fontWeight: 600, 
                      textTransform: 'uppercase', 
                      letterSpacing: '0.05em',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '120px'
                    }}>
                      {gName}
                    </span>
                  </div>
                  
                  {!isCollapsed && gRows.map(row => (
                    <div key={row.rowKey} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '3px 6px', borderRadius: 5,
                      background: purpleDim, border: `1px solid ${purpleBdr}`,
                    }}>
                      <Handle
                        type="target"
                        id={row.handle}
                        position={Position.Left}
                        style={{ background: purple, width: 8, height: 8, border: '2px solid var(--bg-surface)' }}
                      />
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.attrKey}
                      </span>
                      <span style={{ fontSize: '0.55rem', color: 'var(--cyan)', fontFamily: 'JetBrains Mono', flexShrink: 0, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.value !== undefined && row.value !== null ? (typeof row.value === 'object' ? '{...}' : String(row.value)) : <span style={{ opacity: 0.4, fontStyle: 'italic' }}>null</span>}
                      </span>
                    </div>
                  ))}
                </div>
              );
            });
          })()}

          {/* Transform rows (AddNode connections) */}
          {transforms.map(t => (
            <div key={t.edgeId} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 6px', borderRadius: 5,
              background: yellowDim, border: `1px dashed ${yellowBdr}`,
            }}>
              <Zap size={9} color="#fbbf24" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.55rem', color: '#fbbf24', flex: 1 }}>
                +{t.constant} <span style={{ opacity: 0.6 }}>({t.constantType})</span>
              </span>
              <span style={{ fontSize: '0.45rem', color: '#fbbf24', opacity: 0.7 }}>broadcast</span>
            </div>
          ))}
        </div>

        {/* ── RIGHT: output slots ───────────────────────────────────────── */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          paddingLeft: 10,
          paddingRight: 6,
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: '0.46rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Output Slots
            </span>
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={addSlot}
              style={{
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: '0.52rem', padding: '2px 7px', borderRadius: 4,
                background: purpleDim, border: `1px solid ${purpleBdr}`,
                color: purple, cursor: 'pointer',
              }}
            >
              <Plus size={9} /> Slot
            </button>
          </div>

          {slots.length === 0 && (
            <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
              Press "+ Slot" to create an output
            </p>
          )}

          {slots.map((slot) => {
            const isOpen    = !!openSlots[slot.id];
            const assembled = buildOutput(slot, dataRows, transforms);
            const preview   = JSON.stringify(assembled, null, 0);

            return (
              <div
                key={slot.id}
                style={{
                  position: 'relative',
                  background: purpleDim,
                  border: `1px solid ${purpleBdr}`,
                  borderRadius: 6,
                  overflow: 'visible',
                }}
              >
                {/* Slot header row */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', cursor: 'pointer' }}
                  onClick={() => setOpenSlots(p => ({ ...p, [slot.id]: !p[slot.id] }))}
                  onMouseDown={e => e.stopPropagation()}
                >
                  {isOpen
                    ? <ChevronDown  size={10} color={purple} />
                    : <ChevronRight size={10} color={purple} />
                  }

                  {/* Slot name */}
                  <input
                    value={slot.name}
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                    onChange={e => updateSlot(slot.id, { name: e.target.value })}
                    style={{
                      fontSize: '0.6rem', background: 'transparent', border: 'none',
                      color: 'var(--text-primary)', fontWeight: 700, flex: 1, outline: 'none', minWidth: 0,
                    }}
                  />

                  {/* Strategy selector */}
                  <select
                    value={slot.strategy}
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                    onChange={e => updateSlot(slot.id, { strategy: e.target.value })}
                    style={{
                      fontSize: '0.48rem', background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)', borderRadius: 3,
                      color: 'var(--text-muted)', padding: '1px 3px', flexShrink: 0,
                    }}
                  >
                    {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>

                  {/* Remove */}
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); removeSlot(slot.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex', flexShrink: 0 }}
                  >
                    <X size={10} />
                  </button>

                  {/* Source handle — anchors to right edge of this slot div */}
                  <Handle
                    type="source"
                    id={`combine-out-${slot.name}`}
                    position={Position.Right}
                    style={{
                      right: -6, top: '50%', transform: 'translateY(-50%)',
                      background: purple, width: 10, height: 10,
                      border: '2px solid var(--bg-surface)',
                      boxShadow: `0 0 0 2px ${purple}`,
                    }}
                  />
                </div>

                {/* Slot body (expanded) */}
                {isOpen && (
                  <div style={{ padding: '6px 8px 8px', borderTop: `1px solid ${purpleBdr}` }}>

                    {dataRows.length === 0 && (
                      <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                        No data inputs connected yet
                      </p>
                    )}

                    {/* Per-row assignment controls (Grouped by Entity) */}
                    {(() => {
                      const groups = {};
                      dataRows.forEach(row => {
                        const gName = row.groupName || 'Attributes';
                        if (!groups[gName]) groups[gName] = [];
                        groups[gName].push(row);
                      });

                      return Object.entries(groups).map(([gName, gRows]) => {
                        const groupKey = `slot-${slot.id}-${gName}`;
                        const isCollapsed = !!collapsedGroups[groupKey];
                        const allIncluded = gRows.every(r => (slot.assignments?.[r.rowKey]?.included !== false));

                        return (
                          <div key={gName} style={{ marginBottom: 10 }}>
                            <div 
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: 4, 
                                cursor: 'pointer',
                                userSelect: 'none',
                                marginBottom: 4
                              }}
                              onClick={() => toggleGroup(groupKey)}
                              onMouseDown={e => e.stopPropagation()}
                            >
                              {isCollapsed ? <ChevronRight size={9} color="var(--cyan)" /> : <ChevronDown size={9} color="var(--cyan)" />}
                              <span style={{ 
                                fontSize: '0.45rem', 
                                color: 'var(--cyan)', 
                                fontWeight: 600, 
                                textTransform: 'uppercase', 
                                letterSpacing: '0.05em',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                flex: 1
                              }}>
                                {gName}
                              </span>

                              {/* Bulk Toggle Action */}
                              <div 
                                onClick={e => {
                                  e.stopPropagation();
                                  toggleGroupSelection(slot.id, gRows, !allIncluded);
                                }}
                                onMouseDown={e => e.stopPropagation()}
                                style={{
                                  fontSize: '0.42rem',
                                  color: allIncluded ? purple : 'var(--text-muted)',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.05em',
                                  padding: '2px 5px',
                                  borderRadius: 3,
                                  background: allIncluded ? purpleDim : 'var(--bg-surface-elevated)',
                                  border: `1px solid ${allIncluded ? purpleBdr : 'var(--border-subtle)'}`,
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  userSelect: 'none'
                                }}
                              >
                                {allIncluded ? 'Clear All' : 'Select All'}
                              </div>
                            </div>

                            {!isCollapsed && gRows.map(row => {
                              const asgn = (slot.assignments || {})[row.rowKey] || { included: true, outputKey: row.attrKey, condition: 'always' };
                              return (
                                <div key={row.rowKey} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                                  {/* Include toggle */}
                                  <input
                                    type="checkbox"
                                    checked={asgn.included !== false}
                                    onMouseDown={e => e.stopPropagation()}
                                    onChange={e => updateAsgn(slot.id, row.rowKey, { included: e.target.checked })}
                                    style={{ width: 11, height: 11, accentColor: purple, flexShrink: 0 }}
                                  />

                                  {/* Attr key label */}
                                  <span style={{
                                    fontSize: '0.58rem', color: asgn.included !== false ? 'var(--text-secondary)' : 'var(--text-muted)',
                                    width: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0,
                                  }}>
                                    {row.attrKey}
                                  </span>

                                  {/* Rename strategy: output key editor */}
                                  {slot.strategy === 'rename' && (
                                    <>
                                      <span style={{ fontSize: '0.5rem', color: 'var(--text-muted)' }}>→</span>
                                      <input
                                        value={asgn.outputKey || row.attrKey}
                                        onMouseDown={e => e.stopPropagation()}
                                        onChange={e => updateAsgn(slot.id, row.rowKey, { outputKey: e.target.value })}
                                        style={{
                                          fontSize: '0.55rem', background: 'var(--bg-surface)',
                                          border: '1px solid var(--border-subtle)', borderRadius: 3,
                                          color: purple, padding: '1px 4px', width: 58, outline: 'none',
                                        }}
                                      />
                                    </>
                                  )}

                                  {/* Conditional strategy: condition dropdown */}
                                  {slot.strategy === 'conditional' && (
                                    <select
                                      value={asgn.condition || 'always'}
                                      onMouseDown={e => e.stopPropagation()}
                                      onChange={e => updateAsgn(slot.id, row.rowKey, { condition: e.target.value })}
                                      style={{
                                        fontSize: '0.48rem', background: 'var(--bg-surface)',
                                        border: '1px solid var(--border-subtle)', borderRadius: 3,
                                        color: 'var(--text-muted)', padding: '1px 3px',
                                      }}
                                    >
                                      {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  )}

                                  {/* Live transformed value preview */}
                                  <span style={{ fontSize: '0.52rem', color: 'var(--cyan)', fontFamily: 'JetBrains Mono', marginLeft: 'auto', flexShrink: 0, opacity: asgn.included !== false ? 1 : 0.3, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {(slot.applyLogic && transforms.length) ? String(applyTransforms(row.value, transforms)) : String(row.value ?? 'null')}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      });
                    })()}

                    {/* Output preview */}
                    <div style={{
                      marginTop: 6, padding: '4px 7px',
                      background: 'rgba(0,0,0,0.22)', borderRadius: 5,
                      border: '1px solid var(--border-subtle)',
                    }}>
                      <span style={{ fontSize: '0.42rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>output preview</span>
                      <pre style={{
                        margin: '2px 0 0',
                        fontSize: '0.52rem', color: 'var(--text-secondary)',
                        fontFamily: 'JetBrains Mono', whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}>
                        {preview === '{}' ? '{ }  — no attrs included' : preview}
                      </pre>
                    </div>

                    {/* Transform summary */}
                    {transforms.length > 0 && slot.applyLogic && (
                      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Zap size={9} color="#fbbf24" />
                        <span style={{ fontSize: '0.5rem', color: '#fbbf24' }}>
                          AddNode broadcast applied: +{transforms[0].constant} ({transforms[0].constantType})
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </BaseNode>
  );
});
