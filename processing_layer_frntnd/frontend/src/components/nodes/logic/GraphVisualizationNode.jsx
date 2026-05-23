import React, { memo, useState, useRef, useEffect } from 'react';
import { Handle, Position } from 'reactflow';
import { Share2 } from 'lucide-react';
import BaseNode from '../BaseNode';

// --- Helper: resolve entity name from a property path ---
const getEntityName = (entity, displayProperty) => {
  if (!displayProperty) return entity.name || entity.title || entity.id || entity._hve_id || 'Unknown';
  const parts = displayProperty.split('.');
  let current = entity;
  for (const part of parts) {
    if (current == null) break;
    current = current[part];
  }
  return (current != null && typeof current !== 'object') ? String(current) : (entity.name || entity.title || entity._hve_id || 'Unknown');
};

// --- Helper: build nodes and edges for the graph from entity data ---
const buildGraphData = (entities, displayProperty, linkProperty) => {
  const nodes = [];
  const edges = [];
  const nodeSet = new Set();

  entities.forEach((entity, i) => {
    const id = String(entity._hve_id || entity.id || i);
    const label = getEntityName(entity, displayProperty);
    const riskScore = entity._risk_score;
    const riskLevel = entity._risk_level;

    if (!nodeSet.has(id)) {
      nodeSet.add(id);
      nodes.push({ id, label, riskScore, riskLevel, entity });
    }

    // Build edges from path_trace if available
    if (Array.isArray(entity._path_trace)) {
      entity._path_trace.forEach((step) => {
        const src = String(step.src || step.from || '');
        const tgt = String(step.tgt || step.to || '');
        const rel = step.rel || step.relationship || '';
        if (src && tgt && src !== tgt) {
          edges.push({ source: src, target: tgt, label: rel });
        }
      });
    }

    // Build edges from a link property if configured
    if (linkProperty && entity[linkProperty]) {
      const targets = Array.isArray(entity[linkProperty]) ? entity[linkProperty] : [entity[linkProperty]];
      targets.forEach(t => {
        const tgtId = String(t._hve_id || t.id || t);
        edges.push({ source: id, target: tgtId, label: linkProperty });
      });
    }
  });

  return { nodes, edges };
};

// --- Risk color helper ---
const getRiskColor = (score, level) => {
  if (level === 'HIGH' || score >= 70) return '#EF4444';
  if (level === 'MEDIUM' || score >= 35) return '#F59E0B';
  if (level === 'LOW' || score < 35) return '#10B981';
  return 'var(--text-muted)';
};

// --- Mini Force-Directed Graph Canvas Component ---
const GraphCanvas = ({ graphData, width = 400, height = 300 }) => {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const positionsRef = useRef({});
  const velocitiesRef = useRef({});

  useEffect(() => {
    const { nodes, edges } = graphData;
    if (!nodes.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Initialize positions randomly if not set
    nodes.forEach(n => {
      if (!positionsRef.current[n.id]) {
        positionsRef.current[n.id] = {
          x: Math.random() * (width - 60) + 30,
          y: Math.random() * (height - 60) + 30,
        };
        velocitiesRef.current[n.id] = { x: 0, y: 0 };
      }
    });

    const simulate = () => {
      const pos = positionsRef.current;
      const vel = velocitiesRef.current;
      const k = 0.85;
      const repulsion = 1800;
      const attraction = 0.04;
      const damping = 0.75;

      // Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = (pos[a.id]?.x || 0) - (pos[b.id]?.x || 0);
          const dy = (pos[a.id]?.y || 0) - (pos[b.id]?.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = repulsion / (dist * dist);
          vel[a.id].x += (dx / dist) * force;
          vel[a.id].y += (dy / dist) * force;
          vel[b.id].x -= (dx / dist) * force;
          vel[b.id].y -= (dy / dist) * force;
        }
      }

      // Attraction along edges
      edges.forEach(e => {
        const src = pos[e.source], tgt = pos[e.target];
        if (!src || !tgt) return;
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        vel[e.source].x += dx * attraction;
        vel[e.source].y += dy * attraction;
        vel[e.target].x -= dx * attraction;
        vel[e.target].y -= dy * attraction;
      });

      // Update positions with damping + boundary clamping
      nodes.forEach(n => {
        vel[n.id].x *= damping;
        vel[n.id].y *= damping;
        pos[n.id].x = Math.max(20, Math.min(width - 20, pos[n.id].x + vel[n.id].x));
        pos[n.id].y = Math.max(20, Math.min(height - 20, pos[n.id].y + vel[n.id].y));
      });

      // Draw
      ctx.clearRect(0, 0, width, height);

      // Draw edges
      edges.forEach(e => {
        const src = pos[e.source], tgt = pos[e.target];
        if (!src || !tgt) return;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = 'rgba(150,150,200,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Edge label
        if (e.label) {
          ctx.fillStyle = 'rgba(150,150,200,0.7)';
          ctx.font = '7px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(e.label, (src.x + tgt.x) / 2, (src.y + tgt.y) / 2 - 3);
        }
      });

      // Draw nodes
      nodes.forEach(n => {
        const p = pos[n.id];
        if (!p) return;
        const color = getRiskColor(n.riskScore, n.riskLevel);
        const radius = n.riskScore != null ? Math.max(5, Math.min(14, n.riskScore / 10)) : 7;

        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color + '33';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Node label
        ctx.fillStyle = 'var(--text-primary)' || '#fff';
        ctx.font = `${Math.max(7, 9 - (n.label.length > 10 ? 2 : 0))}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label, p.x, p.y + radius + 9);
      });

      animRef.current = requestAnimationFrame(simulate);
    };

    animate();
    function animate() { animRef.current = requestAnimationFrame(simulate); }

    return () => cancelAnimationFrame(animRef.current);
  }, [graphData, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width: '100%', height: '100%', borderRadius: 6 }}
    />
  );
};

// ===== CONFIG (auto-registered by registry.js) =====
export const config = {
  type: 'graphVisualizationNode',
  category: 'logic',
  label: 'Graph Visualization',
  icon: Share2,
  color: '#8B5CF6',
  hideInSidebar: false,

  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const allData = Array.isArray(formData.data) ? formData.data : (formData.data ? [formData.data] : []);

    const availableKeys = new Set();
    allData.forEach(item => {
      if (item && typeof item === 'object') Object.keys(item).forEach(k => availableKeys.add(k));
    });
    const keyOptions = Array.from(availableKeys).sort();

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
            Node Label Property
          </label>
          <select
            value={formData.displayNameProperty || ''}
            onChange={e => handleChange('displayNameProperty', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          >
            <option value="">-- Default (name / id) --</option>
            {keyOptions.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
            Link / Relationship Property (optional)
          </label>
          <select
            value={formData.linkProperty || ''}
            onChange={e => handleChange('linkProperty', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          >
            <option value="">-- None / Use Path Trace --</option>
            {keyOptions.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div style={{ padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
          {allData.length} entities connected · Node size = risk score · Color = risk level
        </div>
      </div>
    );
  }
};

// ===== DEFAULT EXPORT: The rendered node component =====
export default memo(({ id, data, selected, edges, nodes, setNodes }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Sync upstream data
  const prevInputRef = useRef(undefined);
  useEffect(() => {
    if (!edges || !nodes || !setNodes) return;
    const incomingEdges = edges.filter(e => e.target === id);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);

    let dataList = [];
    for (const n of incomingNodes) {
      if (!n.data) continue;
      const candidates = [n.data.data, n.data.high_risk, n.data.medium_risk, n.data.low_risk, n.data.extracted, n.data.pinned];
      // Collect ALL candidate arrays to merge into one graph
      candidates.forEach(c => { if (Array.isArray(c) && c.length > 0) dataList.push(...c); });
      if (dataList.length > 0) break;
    }

    if (dataList.length > 0) {
      const serialised = JSON.stringify(dataList);
      if (prevInputRef.current !== serialised) {
        prevInputRef.current = serialised;
        setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, data: dataList } } : n));
      }
    }
  }, [edges, nodes, id, setNodes]);

  const allData = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
  const graphData = buildGraphData(allData, data.displayNameProperty, data.linkProperty);
  const highCount = allData.filter(e => e._risk_level === 'HIGH' || e._risk_score >= 70).length;
  const medCount  = allData.filter(e => e._risk_level === 'MEDIUM' || (e._risk_score >= 35 && e._risk_score < 70)).length;
  const lowCount  = allData.filter(e => e._risk_level === 'LOW'    || (e._risk_score != null && e._risk_score < 35)).length;

  return (
    <BaseNode
      label="Graph Visualization"
      icon={config.icon}
      type={config.type}
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color={config.color}
      collapsedInfo={
        allData.length > 0
          ? <span style={{ display: 'flex', gap: 6, fontSize: '0.65rem' }}>
              <span style={{ color: '#EF4444', fontWeight: 700 }}>{highCount}H</span>
              <span style={{ color: '#F59E0B', fontWeight: 700 }}>{medCount}M</span>
              <span style={{ color: '#10B981', fontWeight: 700 }}>{lowCount}L</span>
              <span style={{ color: 'var(--text-muted)' }}>{graphData.edges.length} links</span>
            </span>
          : <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>No data yet</span>
      }
    >
      {/* Canvas Graph Render */}
      {allData.length > 0 ? (
        <div style={{ width: '100%', height: 260, background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-subtle)', overflow: 'hidden', marginBottom: 8 }}>
          <GraphCanvas graphData={graphData} width={320} height={260} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 120, color: 'var(--text-muted)', gap: 8 }}>
          <Share2 size={28} opacity={0.3} />
          <span style={{ fontSize: '0.7rem' }}>Connect upstream data to render graph</span>
        </div>
      )}

      {/* Stats bar */}
      {allData.length > 0 && (
        <div style={{ display: 'flex', gap: 8, fontSize: '0.65rem', color: 'var(--text-muted)', justifyContent: 'space-between', padding: '4px 2px' }}>
          <span>{allData.length} nodes</span>
          <span>{graphData.edges.length} edges</span>
          <span style={{ color: '#EF4444' }}>{highCount} High</span>
          <span style={{ color: '#F59E0B' }}>{medCount} Med</span>
          <span style={{ color: '#10B981' }}>{lowCount} Low</span>
        </div>
      )}

      {/* Reactflow I/O Handles */}
      <Handle type="target" position={Position.Left} id="data" style={{ background: '#8B5CF6' }} />
      <Handle type="source" position={Position.Right} id="data" style={{ background: '#8B5CF6' }} />
    </BaseNode>
  );
});
