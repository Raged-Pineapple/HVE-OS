import React, { memo, useState, useEffect, useRef } from 'react';
import { useEdges, useNodes, Handle, Position, useReactFlow } from 'reactflow';
import { GitMerge, Plus, X, ChevronDown, ChevronRight, Zap, Search } from 'lucide-react';
import BaseNode from '../BaseNode';
import { attrKeyFromHandle, resolveAttrValue } from '../../../utils/pipelineUtils.js';

export const config = {
  type: 'combine',
  category: 'logic',
  label: 'Combine',
  icon: GitMerge,
  color: '#a855f7',
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const slots = formData.slots || [];
    const logicEdges = edges.filter(e => e.target === nodeId && e.targetHandle === 'logic-broadcast');
    const logicNodes = logicEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    
    const [searchTerm, setSearchTerm] = useState('');

    const updateLogicConfig = (sourceId, field, value) => {
      const current = formData.logicConfig || {};
      const next = { ...current, [sourceId]: { ...(current[sourceId] || { op: 'add' }), [field]: value } };
      handleChange('logicConfig', next);
    };

    const updateSlotLogicRules = (slotId, type, item, checked) => {
      const nextSlots = slots.map(s => {
        if (s.id !== slotId) return s;
        const rules = s.logicRules || {};
        const currentItems = rules[type] || [];
        const nextItems = checked 
          ? [...currentItems, item]
          : currentItems.filter(i => i !== item);
        return { ...s, logicRules: { ...rules, [type]: nextItems } };
      });
      handleChange('slots', nextSlots);
    };

    // Extract all unique entities and attributes from the node's current assignments
    // Note: In a real app we might want to pass dataRows here, but we can infer from existing assignments
    const allEntities = new Set();
    const allAttributes = new Set();
    slots.forEach(s => {
      Object.values(s.assignments || {}).forEach(a => {
        if (a.entityName) allEntities.add(a.entityName);
        if (a.attrKey) allAttributes.add(a.attrKey);
      });
    });

    const entitiesList = Array.from(allEntities).sort();
    const attributesList = Array.from(allAttributes).sort();

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Logic Broadcast Config */}
        {logicNodes.length > 0 && (
          <div>
            <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, letterSpacing: '0.05em' }}>Logic Broadcast Configuration</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {logicNodes.map(node => (
                <div key={node.id} style={{ padding: '10px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Zap size={12} color="#fbbf24" />
                    <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>Source: {node.id}</span>
                  </div>
                  <div className="field">
                    <label style={{ fontSize: '0.55rem' }}>Operation</label>
                    <select
                      value={formData.logicConfig?.[node.id]?.op || 'add'}
                      onChange={(e) => updateLogicConfig(node.id, 'op', e.target.value)}
                      style={{ fontSize: '0.65rem' }}
                    >
                      <option value="add">Add (+)</option>
                      <option value="subtract">Subtract (-)</option>
                      <option value="multiply">Multiply (×)</option>
                      <option value="divide">Divide (÷)</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-Slot Logic Filtering */}
        {slots.length > 0 && logicNodes.length > 0 && (
          <div>
            <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, letterSpacing: '0.05em' }}>Logic Filtering (Per Slot)</p>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
              <input 
                placeholder="Filter attributes..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ paddingLeft: 26, fontSize: '0.65rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {slots.map(slot => (
                <div key={slot.id} style={{ padding: '10px', background: 'var(--bg-elevated)', borderRadius: 8, border: `1px solid ${slot.applyLogic ? '#fbbf24' : 'var(--border-subtle)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a855f7' }} />
                      <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>{slot.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Zap size={10} color={slot.applyLogic ? "#fbbf24" : "var(--text-muted)"} />
                      <span style={{ fontSize: '0.55rem', color: slot.applyLogic ? "#fbbf24" : "var(--text-muted)" }}>{slot.applyLogic ? 'Active' : 'Disabled'}</span>
                    </div>
                  </div>

                  {slot.applyLogic && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Entity Filters */}
                      <div>
                        <label style={{ fontSize: '0.55rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>Target Entities</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {entitiesList.map(entity => (
                            <button
                              key={entity}
                              onClick={() => updateSlotLogicRules(slot.id, 'entities', entity, !(slot.logicRules?.entities || entitiesList).includes(entity))}
                              style={{
                                fontSize: '0.55rem',
                                padding: '2px 6px',
                                borderRadius: 4,
                                border: '1px solid',
                                borderColor: (slot.logicRules?.entities || entitiesList).includes(entity) ? '#fbbf24' : 'var(--border-subtle)',
                                background: (slot.logicRules?.entities || entitiesList).includes(entity) ? 'rgba(251,191,36,0.1)' : 'transparent',
                                color: (slot.logicRules?.entities || entitiesList).includes(entity) ? '#fbbf24' : 'var(--text-muted)',
                                cursor: 'pointer'
                              }}
                            >
                              {entity}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Attribute Filters */}
                      <div>
                        <label style={{ fontSize: '0.55rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>Target Attributes</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {attributesList
                            .filter(attr => attr.toLowerCase().includes(searchTerm.toLowerCase()))
                            .map(attr => (
                            <button
                              key={attr}
                              onClick={() => updateSlotLogicRules(slot.id, 'attributes', attr, !(slot.logicRules?.attributes || attributesList).includes(attr))}
                              style={{
                                fontSize: '0.55rem',
                                padding: '2px 6px',
                                borderRadius: 4,
                                border: '1px solid',
                                borderColor: (slot.logicRules?.attributes || attributesList).includes(attr) ? '#fbbf24' : 'var(--border-subtle)',
                                background: (slot.logicRules?.attributes || attributesList).includes(attr) ? 'rgba(251,191,36,0.1)' : 'transparent',
                                color: (slot.logicRules?.attributes || attributesList).includes(attr) ? '#fbbf24' : 'var(--text-muted)',
                                cursor: 'pointer'
                              }}
                            >
                              {attr}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, letterSpacing: '0.05em' }}>Output Preview</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {slots.map((slot, i) => {
              const res = i === 0 ? formData.resolvedEntity : formData[`resolvedEntity_${slot.name}`];
              const isEmpty = !res || Object.keys(res).length === 0;
              return (
                <div key={slot.id} style={{ 
                  padding: '10px', 
                  background: 'var(--bg-elevated)', 
                  borderRadius: 8, 
                  border: '1px solid var(--border-subtle)' 
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a855f7' }} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{slot.name}</span>
                    <span className="badge" style={{ fontSize: '0.55rem' }}>{slot.strategy}</span>
                  </div>
                  <pre style={{ 
                    margin: 0, 
                    padding: '8px', 
                    background: 'rgba(0,0,0,0.2)', 
                    borderRadius: 6, 
                    fontSize: '0.7rem', 
                    color: isEmpty ? 'var(--text-muted)' : 'var(--text-secondary)',
                    fontFamily: 'JetBrains Mono',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                  }}>
                    {isEmpty ? '{ } — no attrs included' : (Array.isArray(res) && res.length > 0 ? `[\n  ${JSON.stringify(res[0], null, 2).replace(/\n/g, '\n  ')},\n  ... (${res.length} items total)\n]` : JSON.stringify(res, null, 2))}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
};

// ─── helpers ────────────────────────────────────────────────────────────────

const STRATEGIES = [
  { value: 'pack',        label: 'Pack' },
  { value: 'rename',      label: 'Rename' },
  { value: 'conditional', label: 'Conditional' },
];

const CONDITIONS = ['always', '!null', '>0', '!=0'];

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

        // 1. Logic connections (attached from the TOP logic handle)
        if (edge.targetHandle === 'logic-broadcast') {
          const config = data.logicConfig?.[src.id] || { op: 'add' };
          
          if (src.type === 'add') {
            txs.push({
              op:           config.op,
              constant:     src.data?.resolvedEntity?.sum ?? src.data?.constant ?? 0,
              constantType: src.data?.constantType || 'int',
              edgeId:       edge.id,
            });
          } else {
            // Treat other nodes connected to logic handle as constant broadcasts
            const sHandle = edge.sourceHandle || 'default';
            const attrKey = attrKeyFromHandle(sHandle);
            const entity  = src.data?.resolvedEntity ?? null;
            const val     = resolveAttrValue(entity, attrKey);
            if (val !== null && val !== undefined && !isNaN(Number(val))) {
              txs.push({
                op:           config.op,
                constant:     val,
                constantType: Number.isInteger(Number(val)) ? 'int' : 'float',
                edgeId:       edge.id,
              });
            }
          }
          continue;
        }

        // 2. Data connections (attached from the LEFT handle)
        // We handle both 'data-target' and null/undefined for backward compatibility
        if (edge.targetHandle === 'data-target' || !edge.targetHandle) {
          // Proceed to resolve as data
        } else {
          // If it's connected to some other unknown handle, skip for now
          continue;
        }

        // Otherwise, it's a Data connection
        let value = null;
        let groupName = src.data?.label || src.type || 'Attributes';
        const handle  = edge.sourceHandle || 'default';
        let attrKey = attrKeyFromHandle(handle);

        // UI Routing Convention: A specific entity extracted from a bulk list via dynamic wire
        if (handle.startsWith('entity-out-')) {
          let specificName = handle;
          let specificId = null;
          
          if (specificName.startsWith('entity-out-pinned-')) {
            specificName = specificName.replace('entity-out-pinned-', '');
          } else {
            specificName = specificName.replace('entity-out-', '');
          }
          
          if (specificName.includes('::')) {
            const parts = specificName.split('::');
            specificId = parts[0];
            specificName = parts.slice(1).join('::');
          }
          
          attrKey = specificName;
          groupName = specificName;
          
          const possibleArrays = [src.data?.data, src.data?.extracted, src.data?.resolvedEntity, src.data?.pinned, src.data?.unpinned].filter(Array.isArray);

          for (const arr of possibleArrays) {
            if (!arr) continue;
            const ent = arr.find((e, idx) => {
              const eUniqueId = e._hve_id != null ? `hve_${e._hve_id}` : e.hve_id != null ? `hve_${e.hve_id}` : e.id != null ? `id_${e.id}` : `idx_${idx}`;
              return specificId !== null && eUniqueId === specificId;
            });
            if (ent) {
              value = ent;
              break;
            }
          }
        } else {
          // Generic Bulk / Scalar extraction
          let entity = null;
          if (src.data && src.data[handle] !== undefined) {
              entity = src.data[handle]; // Exact handle match
          } else {
              // Fallbacks for standard node data envelopes
              entity = src.data?.data ?? src.data?.resolvedEntity ?? src.data?.extracted ?? null;
          }

          if (handle === 'data' || handle === 'extracted' || handle === 'pinned' || handle === 'unpinned') {
              value = entity;
          } else {
              value = resolveAttrValue(entity, attrKey);
          }
        }
          
          // Auto-explode plain objects
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            Object.entries(value).forEach(([k, v]) => {
              rows.push({ handle, attrKey: k, value: v, rowKey: `${edge.id}-${k}`, groupName });
            });
          } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
            Object.entries(value[0]).forEach(([k, v]) => {
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
    >
      
      {/* ── TARGET HANDLES ── */}
      
      {/* 1. Main Data Target (Left) */}
      <Handle
        type="target"
        id="data-target"
        position={Position.Left}
        style={{
          left: -6,
          background: 'var(--amber)',
          width: 12,
          height: 12,
          border: '2px solid var(--bg-surface)',
          zIndex: 10
        }}
      />

      {/* 2. Logic Broadcast Target (Top) */}
      <Handle
        type="target"
        id="logic-broadcast"
        position={Position.Top}
        style={{
          background: '#fbbf24',
          width: 12,
          height: 12,
          border: '2px solid var(--bg-surface)',
          top: -6,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10
        }}
      />

      {/* ── LOGIC BROADCAST BAR (Top Distinction) ── */}
      {transforms.length > 0 && (
        <div style={{
          margin: '10px 12px 0',
          padding: '6px 10px',
          background: 'rgba(251,191,36,0.04)',
          border: '1px dashed rgba(251,191,36,0.25)',
          borderRadius: 8,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center'
        }}>
          <Zap size={11} color="#fbbf24" />
          <span style={{ fontSize: '0.52rem', color: '#fbbf24', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Logic Broadcast:
          </span>
          {transforms.map(t => (
            <div key={t.edgeId} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 6px', borderRadius: 4,
              background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.15)',
            }}>
              <span style={{ fontSize: '0.55rem', color: '#fbbf24', fontWeight: 700 }}>
                +{t.constant}
              </span>
              <span style={{ fontSize: '0.42rem', color: '#fbbf24', opacity: 0.6, fontFamily: 'JetBrains Mono' }}>
                {t.constantType}
              </span>
            </div>
          ))}
        </div>
      )}

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, position: 'relative' }}>
            <span style={{ fontSize: '0.46rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Inputs
            </span>
          </div>

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

                  {/* Logic Toggle */}
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); updateSlot(slot.id, { applyLogic: !slot.applyLogic }); }}
                    title={slot.applyLogic ? "Disable logic for this slot" : "Enable logic for this slot"}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: slot.applyLogic ? '#fbbf24' : 'var(--text-muted)',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                      transition: 'color 0.2s',
                      opacity: transforms.length > 0 ? 1 : 0.4
                    }}
                  >
                    <Zap size={10} fill={slot.applyLogic ? '#fbbf24' : 'none'} />
                  </button>

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

                    {/* Strategy Selector (Moved here) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, paddingBottom: 6, borderBottom: '1px dashed var(--border-subtle)' }}>
                      <span style={{ fontSize: '0.5rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Strategy</span>
                      <select
                        value={slot.strategy}
                        onMouseDown={e => e.stopPropagation()}
                        onChange={e => updateSlot(slot.id, { strategy: e.target.value })}
                        style={{
                          fontSize: '0.48rem', background: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)', borderRadius: 3,
                          color: purple, padding: '1px 4px', outline: 'none', fontWeight: 600
                        }}
                      >
                        {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>

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
                                    {String(row.value ?? 'null')}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      });
                    })()}

                    {/* Transform summary */}
                    {transforms.length > 0 && slot.applyLogic && (
                      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Zap size={9} color="#fbbf24" />
                        <span style={{ fontSize: '0.5rem', color: '#fbbf24' }}>
                          AddNode broadcast applied: +{transforms[0].constant}
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
