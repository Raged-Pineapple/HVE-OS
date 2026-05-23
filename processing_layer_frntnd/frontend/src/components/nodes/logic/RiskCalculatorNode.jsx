import React, { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position } from 'reactflow';
import { AlertTriangle, Pin, PinOff, Search, ChevronDown, ChevronRight, Network, ArrowLeft } from 'lucide-react';

// ── Path Trace Canvas: force-directed graph from a single entity's _path_trace ──
const getRiskColor = (score) => {
  if (score >= 70) return '#EF4444';
  if (score >= 35) return '#F59E0B';
  if (score != null) return '#10B981';
  return '#8B5CF6';
};

const PathTraceCanvas = ({ entity, width = 300, height = 250 }) => {
  const canvasRef   = useRef(null);
  const animRef     = useRef(null);
  const posRef      = useRef({});
  const velRef      = useRef({});
  const transformRef  = useRef({ scale: 1, ox: 0, oy: 0 });
  const dragRef        = useRef(null);   // viewport pan: {startX, startY, ox, oy}
  const draggedNodeRef = useRef(null);   // node drag:    {nodeId, startWx, startWy, startPx, startPy}
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [tooltip, setTooltip] = useState(null);      // node hover
  const [edgeTooltip, setEdgeTooltip] = useState(null); // edge hover {x,y,edge}

  // Derive graph data once per entity change
  const graphRef = useRef({ nodeList: [], edgeList: [] });
  useEffect(() => {
    const trace = entity?._path_trace || [];
    const nodeMap = {}, edgeList = [];
    const getId   = (d) => String(d?._hve_id || d?.id || d?.name || d?.title || JSON.stringify(d)).slice(0, 60);
    const getLbl  = (d) => String(d?.name || d?.title || d?.text || d?._hve_id || '?').slice(0, 24);
    trace.forEach((step, i) => {
      const srcDict = step.src_node || {}, tgtDict = step.tgt_node || {};
      const srcId = getId(srcDict) || `src_${i}`, tgtId = getId(tgtDict) || `tgt_${i}`;
      if (!nodeMap[srcId]) nodeMap[srcId] = { id: srcId, label: getLbl(srcDict), score: step.score, attrs: srcDict };
      if (!nodeMap[tgtId]) nodeMap[tgtId] = { id: tgtId, label: getLbl(tgtDict), score: step.score, attrs: tgtDict };
      edgeList.push({ source: srcId, target: tgtId, label: step.relation || step.rel || '', score: step.score, reason: step.reason || '' });
    });
    graphRef.current = { nodeList: Object.values(nodeMap), edgeList };
    // Reset positions for new entity
    posRef.current = {};
    velRef.current = {};
    transformRef.current = { scale: 1, ox: 0, oy: 0 };
  }, [entity]);

  // Main simulation + draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const loop = () => {
      const { nodeList, edgeList } = graphRef.current;
      const pos = posRef.current, vel = velRef.current;
      const { scale, ox, oy } = transformRef.current;

      // Init positions for new nodes
      nodeList.forEach(n => {
        if (!pos[n.id]) {
          pos[n.id] = { x: Math.random()*(width-80)+40, y: Math.random()*(height-80)+40 };
          vel[n.id] = { x: 0, y: 0 };
        }
      });

      // Physics
      for (let i = 0; i < nodeList.length; i++) {
        for (let j = i+1; j < nodeList.length; j++) {
          const a = nodeList[i], b = nodeList[j];
          const dx=(pos[a.id]?.x||0)-(pos[b.id]?.x||0), dy=(pos[a.id]?.y||0)-(pos[b.id]?.y||0);
          const d=Math.sqrt(dx*dx+dy*dy)||1, f=1800/(d*d);
          vel[a.id].x+=(dx/d)*f; vel[a.id].y+=(dy/d)*f;
          vel[b.id].x-=(dx/d)*f; vel[b.id].y-=(dy/d)*f;
        }
      }
      edgeList.forEach(e => {
        const s=pos[e.source],t=pos[e.target]; if(!s||!t) return;
        const dx=t.x-s.x, dy=t.y-s.y;
        vel[e.source].x+=dx*0.04; vel[e.source].y+=dy*0.04;
        vel[e.target].x-=dx*0.04; vel[e.target].y-=dy*0.04;
      });
      nodeList.forEach(n => {
        vel[n.id].x*=0.75; vel[n.id].y*=0.75;
        // Only clamp when not zoomed/panned (free movement otherwise)
        pos[n.id].x += vel[n.id].x;
        pos[n.id].y += vel[n.id].y;
      });

      // Draw
      ctx.save();
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(scale, 0, 0, scale, ox, oy);

      // Grid hint
      ctx.strokeStyle='rgba(100,100,150,0.06)'; ctx.lineWidth=0.5/scale;
      for(let gx=0;gx<width*2;gx+=40){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,height*2);ctx.stroke();}
      for(let gy=0;gy<height*2;gy+=40){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(width*2,gy);ctx.stroke();}

      // Edges — start/end at node circumference, not centre
      edgeList.forEach((e, eIdx) => {
        const s=pos[e.source],t=pos[e.target]; if(!s||!t) return;
        const c=getRiskColor(e.score);
        const NODE_R = 14;
        const ang = Math.atan2(t.y - s.y, t.x - s.x);
        const sx = s.x + Math.cos(ang) * NODE_R;
        const sy = s.y + Math.sin(ang) * NODE_R;
        const ARROW_LEN = 10;
        const ex = t.x - Math.cos(ang) * (NODE_R + ARROW_LEN);
        const ey = t.y - Math.sin(ang) * (NODE_R + ARROW_LEN);
        const tipX = t.x - Math.cos(ang) * NODE_R;
        const tipY = t.y - Math.sin(ang) * NODE_R;
        const isEdgeHov = hoveredEdge === eIdx;
        const isEdgeSel = selectedEdge?.idx === eIdx;
        const lineW = isEdgeHov || isEdgeSel ? 3.5 : 2.5;
        const alpha = isEdgeHov || isEdgeSel ? 'ee' : '88';
        // Line
        ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(ex,ey);
        ctx.strokeStyle=c+alpha; ctx.lineWidth=lineW; ctx.stroke();
        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ARROW_LEN*Math.cos(ang-0.45), tipY - ARROW_LEN*Math.sin(ang-0.45));
        ctx.lineTo(tipX - ARROW_LEN*Math.cos(ang+0.45), tipY - ARROW_LEN*Math.sin(ang+0.45));
        ctx.closePath(); ctx.fillStyle=c+'cc'; ctx.fill();
        // Edge label
        if (e.label) {
          ctx.fillStyle= isEdgeHov||isEdgeSel ? 'rgba(255,255,255,0.95)' : 'rgba(200,200,230,0.9)';
          ctx.font=`bold 9px Inter,sans-serif`; ctx.textAlign='center';
          ctx.fillText(e.label, (s.x+t.x)/2, (s.y+t.y)/2 - 8);
        }
        // Score on edge
        if (e.score != null) {
          ctx.font=`8px Inter,sans-serif`;
          ctx.fillStyle=c+'bb';
          ctx.fillText(`${e.score}%`, (s.x+t.x)/2, (s.y+t.y)/2 + 4);
        }
      });

      // Nodes
      const NODE_R = 14;
      nodeList.forEach(n => {
        const p=pos[n.id]; if(!p) return;
        const c=getRiskColor(n.score);
        const isHov = hoveredNode===n.id || draggedNodeRef.current?.nodeId===n.id;
        const r = isHov ? NODE_R * 1.25 : NODE_R;
        // Circle
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2);
        ctx.fillStyle = isHov ? c+'55' : c+'28'; ctx.fill();
        ctx.strokeStyle = c; ctx.lineWidth = isHov ? 2.5 : 1.8; ctx.stroke();
        // Glow
        if (isHov) {
          ctx.shadowColor=c; ctx.shadowBlur=16;
          ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2);
          ctx.strokeStyle=c+'66'; ctx.lineWidth=1; ctx.stroke();
          ctx.shadowBlur=0;
        }
        // Label — fixed 10px, readable at all zoom levels
        ctx.fillStyle='rgba(230,230,245,0.97)';
        ctx.font=`bold 10px Inter,sans-serif`; ctx.textAlign='center';
        const lbl=n.label.length>16 ? n.label.slice(0,15)+'…' : n.label;
        ctx.fillText(lbl, p.x, p.y + r + 13);
        // Score badge
        if (n.score != null) {
          ctx.font=`8px Inter,sans-serif`;
          ctx.fillStyle = c + 'cc';
          ctx.fillText(`${n.score}%`, p.x, p.y + r + 23);
        }
      });

      ctx.restore();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [entity, hoveredNode, hoveredEdge, selectedEdge, width, height]);

  // ── Mouse event helpers ───────────────────────────────────────────────────
  const canvasToWorld = (cx, cy) => {
    const { scale, ox, oy } = transformRef.current;
    return { x: (cx - ox) / scale, y: (cy - oy) / scale };
  };

  const findNodeAt = (wx, wy) => {
    const { nodeList } = graphRef.current;
    const pos = posRef.current;
    const NODE_R = 14;
    for (const n of nodeList) {
      const p = pos[n.id]; if (!p) continue;
      const dx = wx - p.x, dy = wy - p.y;
      if (dx*dx + dy*dy < NODE_R*NODE_R*2) return n;
    }
    return null;
  };

  // Point-to-segment distance for edge hit-testing
  const findEdgeAt = (wx, wy) => {
    const { edgeList } = graphRef.current;
    const pos = posRef.current;
    const HIT = 22; // wider hit area so thin edges are easy to click
    const NODE_R = 14;
    for (let i = 0; i < edgeList.length; i++) {
      const e = edgeList[i];
      const s = pos[e.source], t = pos[e.target];
      if (!s || !t) continue;
      const ang = Math.atan2(t.y - s.y, t.x - s.x);
      const sx = s.x + Math.cos(ang) * NODE_R, sy = s.y + Math.sin(ang) * NODE_R;
      const ex = t.x - Math.cos(ang) * NODE_R, ey = t.y - Math.sin(ang) * NODE_R;
      // Project point onto segment
      const dx = ex - sx, dy = ey - sy;
      const lenSq = dx*dx + dy*dy;
      if (lenSq === 0) continue;
      const t2 = Math.max(0, Math.min(1, ((wx-sx)*dx + (wy-sy)*dy) / lenSq));
      const px = sx + t2*dx - wx, py = sy + t2*dy - wy;
      if (px*px + py*py < HIT*HIT) return { edge: e, idx: i };
    }
    return null;
  };

  // Attach wheel listener as NON-PASSIVE so we can call preventDefault()
  // and stop ReactFlow's parent from zooming at the same time.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect  = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (width / rect.width);
      const cy = (e.clientY - rect.top)  * (height / rect.height);
      const factor = e.deltaY < 0 ? 1.12 : 0.88;
      const t = transformRef.current;
      const newScale = Math.max(0.3, Math.min(6, t.scale * factor));
      transformRef.current = {
        scale: newScale,
        ox: cx - (cx - t.ox) * (newScale / t.scale),
        oy: cy - (cy - t.oy) * (newScale / t.scale),
      };
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [width, height]);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (width / rect.width);
    const cy = (e.clientY - rect.top)  * (height / rect.height);
    const w  = canvasToWorld(cx, cy);
    const hitNode = findNodeAt(w.x, w.y);
    if (hitNode) {
      setSelectedEdge(null);
      draggedNodeRef.current = { nodeId: hitNode.id };
    } else {
      const hitEdge = findEdgeAt(w.x, w.y);
      if (hitEdge) {
        setSelectedEdge(hitEdge);
      } else {
        setSelectedEdge(null);
        const t = transformRef.current;
        dragRef.current = { startX: e.clientX, startY: e.clientY, ox: t.ox, oy: t.oy };
      }
    }
  };

  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (width / rect.width);
    const cy = (e.clientY - rect.top)  * (height / rect.height);
    const w  = canvasToWorld(cx, cy);

    if (draggedNodeRef.current) {
      const { nodeId } = draggedNodeRef.current;
      posRef.current[nodeId] = { x: w.x, y: w.y };
      velRef.current[nodeId] = { x: 0, y: 0 };
      return;
    }
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      transformRef.current = { ...transformRef.current, ox: dragRef.current.ox + dx, oy: dragRef.current.oy + dy };
      return;
    }

    const hitNode = findNodeAt(w.x, w.y);
    if (hitNode) {
      setHoveredNode(hitNode.id); setHoveredEdge(null);
      setTooltip({ x: cx, y: cy, node: hitNode });
      setEdgeTooltip(null);
    } else {
      const hitEdge = findEdgeAt(w.x, w.y);
      setHoveredNode(null);
      setTooltip(null);
      if (hitEdge) {
        setHoveredEdge(hitEdge.idx);
        setEdgeTooltip({ x: cx, y: cy, edge: hitEdge.edge });
      } else {
        setHoveredEdge(null);
        setEdgeTooltip(null);
      }
    }
  };

  const handleMouseUp = () => {
    draggedNodeRef.current = null;
    dragRef.current = null;
  };

  if (!entity?._path_trace?.length) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height, color:'var(--text-muted)', fontSize:'0.65rem' }}>
        No path trace data available
      </div>
    );
  }

  return (
    <div style={{ position:'relative', width:'100%', height }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e); }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { dragRef.current=null; setHoveredNode(null); setHoveredEdge(null); setTooltip(null); }}
        style={{ width:'100%', height:'100%', borderRadius:6, display:'block', cursor: hoveredNode ? 'pointer' : hoveredEdge != null ? 'crosshair' : 'grab' }}
      />

      {/* Node hover tooltip */}
      {tooltip && (
        <div style={{
          position:'absolute', left: tooltip.x + 12, top: tooltip.y - 10,
          background:'var(--bg-elevated)', border:'1px solid var(--border-subtle)',
          borderRadius:6, padding:'6px 8px', fontSize:'0.6rem',
          color:'var(--text-primary)', pointerEvents:'none', zIndex:100,
          maxWidth:160, boxShadow:'0 4px 12px rgba(0,0,0,0.3)'
        }}>
          <strong style={{ display:'block', marginBottom:2, color: getRiskColor(tooltip.node.score) }}>
            {tooltip.node.label}
          </strong>
          {tooltip.node.score != null && <div>Risk score: {tooltip.node.score}%</div>}
          {Object.entries(tooltip.node.attrs || {})
            .filter(([k]) => !k.startsWith('_'))
            .slice(0, 4)
            .map(([k,v]) => (
              <div key={k} style={{ color:'var(--text-muted)', marginTop:1 }}>
                {k}: <span style={{ color:'var(--text-primary)' }}>{String(v).slice(0,30)}</span>
              </div>
            ))
          }
        </div>
      )}

      {/* Edge hover tooltip — same style as node tooltip */}
      {edgeTooltip && !selectedEdge && (
        <div style={{
          position:'absolute',
          left: Math.min(edgeTooltip.x + 12, width - 175),
          top: Math.max(edgeTooltip.y - 80, 4),
          background:'var(--bg-elevated)', border:`1px solid ${getRiskColor(edgeTooltip.edge.score)}44`,
          borderRadius:6, padding:'8px 10px', fontSize:'0.6rem',
          color:'var(--text-primary)', pointerEvents:'none', zIndex:102,
          maxWidth:190, boxShadow:'0 4px 16px rgba(0,0,0,0.35)'
        }}>
          <strong style={{ display:'block', marginBottom:3, color: getRiskColor(edgeTooltip.edge.score), fontSize:'0.65rem' }}>
            {edgeTooltip.edge.label || 'Relationship'}
          </strong>
          <div style={{ marginBottom:5 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
              <span style={{ color:'var(--text-muted)' }}>Score</span>
              <span style={{ color: getRiskColor(edgeTooltip.edge.score), fontWeight:700 }}>{edgeTooltip.edge.score}%</span>
            </div>
            <div style={{ height:3, background:'var(--bg-surface)', borderRadius:2, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${edgeTooltip.edge.score}%`, background: getRiskColor(edgeTooltip.edge.score), borderRadius:2 }} />
            </div>
          </div>
          {edgeTooltip.edge.reason && (
            <div style={{ color:'var(--text-muted)', fontStyle:'italic', lineHeight:1.5, borderTop:'1px solid var(--border-subtle)', paddingTop:4, marginTop:2 }}>
              {edgeTooltip.edge.reason.slice(0, 120)}{edgeTooltip.edge.reason.length > 120 ? '…' : ''}
            </div>
          )}
          <div style={{ color:'rgba(150,150,180,0.6)', marginTop:4, fontSize:'0.55rem' }}>click edge to pin details</div>
        </div>
      )}

      {/* Edge detail panel — shown at bottom when an edge is selected */}
      {selectedEdge && (
        <div style={{
          position:'absolute', bottom:0, left:0, right:0,
          background:'var(--bg-elevated)', borderTop:`2px solid ${getRiskColor(selectedEdge.edge.score)}`,
          borderRadius:'0 0 6px 6px', padding:'8px 10px', zIndex:101,
          boxShadow:'0 -4px 16px rgba(0,0,0,0.35)'
        }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
            <strong style={{ fontSize:'0.65rem', color: getRiskColor(selectedEdge.edge.score) }}>
              {selectedEdge.edge.label || 'Relationship'}
            </strong>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:'0.65rem', fontWeight:700, color: getRiskColor(selectedEdge.edge.score) }}>
                {selectedEdge.edge.score}%
              </span>
              <button onClick={() => setSelectedEdge(null)}
                style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'0.7rem', padding:'0 2px' }}>✕</button>
            </div>
          </div>
          {/* Score bar */}
          <div style={{ height:3, background:'var(--bg-surface)', borderRadius:2, marginBottom:6, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${selectedEdge.edge.score}%`, background: getRiskColor(selectedEdge.edge.score), borderRadius:2 }} />
          </div>
          {selectedEdge.edge.reason && (
            <div style={{ fontSize:'0.6rem', color:'var(--text-muted)', lineHeight:1.5, fontStyle:'italic' }}>
              {selectedEdge.edge.reason}
            </div>
          )}
        </div>
      )}

      {/* Controls hint */}
      <div style={{ position:'absolute', bottom:4, right:6, fontSize:'0.5rem', color:'rgba(150,150,180,0.4)', pointerEvents:'none' }}>
        scroll to zoom · drag to pan · click edge for details
      </div>
    </div>
  );
};
import BaseNode from '../BaseNode';

const getEntityName = (entity, displayProperty) => {
  if (!displayProperty) {
    return entity.name || entity.title || entity.id || entity._hve_id || 'Unknown';
  }
  
  const parts = displayProperty.split('.');
  let current = entity;
  
  for (const part of parts) {
    if (current === null || current === undefined) break;
    current = current[part];
  }
  
  if (current !== null && current !== undefined && typeof current !== 'object') {
    return String(current);
  }
  
  return entity.name || entity.title || entity.id || entity._hve_id || 'Unknown';
};

export const config = {
  type: 'riskCalculator',
  category: 'logic',
  label: 'Risk Calculator',
  icon: AlertTriangle,
  color: '#EF4444',
  hideInSidebar: false,
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('all');
    const [expandedEntities, setExpandedEntities] = useState(new Set());
    const [selectedGraphEntity, setSelectedGraphEntity] = useState(null);
    const prevPropRef = useRef(formData.displayNameProperty);

    useEffect(() => {
      if (formData.displayNameProperty !== prevPropRef.current) {
        const oldProp = prevPropRef.current;
        const newProp = formData.displayNameProperty;
        
        const sourceData = formData.data || [];
        const allData = Array.isArray(sourceData) ? sourceData : [sourceData];
        
        if (formData.pinnedEntities && formData.pinnedEntities.length > 0 && allData.length > 0) {
           const newPinnedNames = allData
              .filter(ent => formData.pinnedEntities.includes(getEntityName(ent, oldProp)))
              .map(ent => getEntityName(ent, newProp));
           
           if (JSON.stringify(newPinnedNames) !== JSON.stringify(formData.pinnedEntities)) {
             handleChange('pinnedEntities', newPinnedNames);
           }
        }
        prevPropRef.current = newProp;
      }
    }, [formData.displayNameProperty, formData.data, formData.pinnedEntities, handleChange]);

    const availableKeys = new Set();
    const sourceData = formData.data || formData.previewInput || [];
    const dataArray = Array.isArray(sourceData) ? sourceData : (sourceData && typeof sourceData === 'object' ? [sourceData] : []);
    dataArray.forEach(item => {
      Object.keys(item).forEach(k => {
        availableKeys.add(k);
        let val = item[k];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          Object.keys(val).forEach(nk => availableKeys.add(`${k}.${nk}`));
        }
      });
    });
    const keyOptions = Array.from(availableKeys).sort();

    const allData = Array.isArray(formData.data) ? formData.data : (formData.data ? [formData.data] : []);
    const highRisk = Array.isArray(formData.high_risk) ? formData.high_risk : [];
    const mediumRisk = Array.isArray(formData.medium_risk) ? formData.medium_risk : [];
    const lowRisk = Array.isArray(formData.low_risk) ? formData.low_risk : [];

    const riskTabs = [
      { key: 'all', label: 'All Data', data: allData, color: 'var(--text-primary)' },
      { key: 'high', label: 'High', data: highRisk, color: '#EF4444' },
      { key: 'medium', label: 'Medium', data: mediumRisk, color: '#F59E0B' },
      { key: 'low', label: 'Low', data: lowRisk, color: '#10B981' }
    ];

    const activeData = riskTabs.find(t => t.key === activeTab)?.data || [];
    const filteredData = activeData.filter(e => getEntityName(e, formData.displayNameProperty).toLowerCase().includes(searchTerm.toLowerCase()));

    // ── Graph view: 3rd panel ──────────────────────────────────────────────────
    if (selectedGraphEntity) {
      const gName = getEntityName(selectedGraphEntity, formData.displayNameProperty);
      const trace = selectedGraphEntity._path_trace || [];
      return (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {/* Header */}
          <div style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:8, borderBottom:'1px solid var(--border-subtle)' }}>
            <button onClick={() => setSelectedGraphEntity(null)}
              style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:4, display:'flex', alignItems:'center' }}>
              <ArrowLeft size={16} />
            </button>
            <div>
              <div style={{ fontSize:'0.75rem', fontWeight:600, color:'var(--text-primary)' }}>Path Graph: {gName}</div>
              <div style={{ fontSize:'0.6rem', color:'var(--text-muted)' }}>Risk: {selectedGraphEntity._risk_score ?? 'N/A'} · {trace.length} hops</div>
            </div>
          </div>

          {/* Canvas */}
          <div style={{ width:'100%', height:250, background:'var(--bg-surface)', borderRadius:8, border:'1px solid var(--border-subtle)', overflow:'hidden' }}>
            <PathTraceCanvas entity={selectedGraphEntity} width={300} height={250} />
          </div>

          {/* Legend */}
          <div style={{ display:'flex', gap:12, fontSize:'0.6rem', color:'var(--text-muted)', justifyContent:'center' }}>
            {[['#EF4444','High (≥70)'],['#F59E0B','Medium (35-69)'],['#10B981','Low (<35)'],['#8B5CF6','Unknown']].map(([c,l])=>(
              <span key={l} style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:c, display:'inline-block' }} />{l}
              </span>
            ))}
          </div>

          {/* Step list */}
          <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', fontWeight:600, marginTop:4 }}>Hop Detail</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:200, overflowY:'auto' }}>
            {trace.map((step, i) => (
              <div key={i} style={{ padding:'6px 8px', background:'var(--bg-surface)', borderRadius:6, border:'1px solid var(--border-subtle)' }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ color:'var(--cyan)', fontWeight:600, fontSize:'0.6rem' }}>[{step.step ?? i+1}] {step.relation || step.rel}</span>
                  <span style={{ color:getRiskColor(step.score), fontWeight:700, fontSize:'0.6rem' }}>{step.score}%</span>
                </div>
                <div style={{ color:'var(--text-muted)', fontSize:'0.6rem', marginTop:2 }}>↳ {step.from} → {step.to}</div>
                {step.reason && <div style={{ color:'var(--text-muted)', fontSize:'0.6rem', fontStyle:'italic', marginTop:2 }}>{step.reason}</div>}
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Target Field</label>
          <input 
            type="text" 
            value={formData.targetField || 'risk_score'}
            onChange={(e) => handleChange('targetField', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
            placeholder="e.g. risk_score"
          />
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Analysis Depth (Max Hops)</label>
          <input 
            type="number" 
            min="1"
            max="10"
            value={formData.maxHops ?? 3}
            onChange={(e) => {
              const val = e.target.value;
              handleChange('maxHops', val === '' ? '' : parseInt(val, 10));
            }}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          />
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Display Name Property</label>
          <select 
            value={formData.displayNameProperty || ''}
            onChange={(e) => handleChange('displayNameProperty', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          >
            <option value="">-- Default (name, id, title) --</option>
            {keyOptions.map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
            {riskTabs.map(tab => (
              <div
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '4px 8px',
                  fontSize: '0.65rem',
                  cursor: 'pointer',
                  borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : '2px solid transparent',
                  color: activeTab === tab.key ? tab.color : 'var(--text-muted)',
                  fontWeight: activeTab === tab.key ? 600 : 400
                }}
              >
                {tab.label} ({tab.data.length})
              </div>
            ))}
          </div>

          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
            <input 
              placeholder="Search entities..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '4px 8px 4px 26px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-primary)', fontSize: '0.65rem' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, padding: '0 2px' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
              {filteredData.length} results
            </span>
            <div style={{ display: 'flex', gap: 10, fontSize: '0.6rem' }}>
              <span onClick={(e) => { 
                  e.preventDefault(); 
                  const currentPinned = new Set(formData.pinnedEntities || []);
                  filteredData.forEach(ent => currentPinned.add(getEntityName(ent, formData.displayNameProperty)));
                  handleChange('pinnedEntities', Array.from(currentPinned));
                }} style={{ color: 'var(--cyan)', cursor: 'pointer', fontWeight: 600 }}>Pin All</span>
              <span onClick={(e) => { 
                  e.preventDefault(); 
                  const currentPinned = new Set(formData.pinnedEntities || []);
                  filteredData.forEach(ent => currentPinned.delete(getEntityName(ent, formData.displayNameProperty)));
                  handleChange('pinnedEntities', Array.from(currentPinned));
                }} style={{ color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}>Unpin All</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
            {filteredData.map((entity, idx) => {
              const name = getEntityName(entity, formData.displayNameProperty);
              const isPinned = (formData.pinnedEntities || []).includes(name);
              const trace = entity._path_trace || [];
              const isExpanded = expandedEntities.has(name);
              
              return (
                <div key={`pin-${idx}-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div 
                    style={{ 
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: '0.7rem', 
                      color: isPinned ? 'var(--cyan)' : 'var(--text-primary)', 
                      padding: '6px 10px', borderRadius: 6,
                      background: isPinned ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface)',
                      border: `1px solid ${isPinned ? 'var(--cyan)' : 'var(--border-subtle)'}`,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div 
                      onClick={() => {
                        const newExpanded = new Set(expandedEntities);
                        if (isExpanded) newExpanded.delete(name);
                        else newExpanded.add(name);
                        setExpandedEntities(newExpanded);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, cursor: 'pointer', overflow: 'hidden' }}
                    >
                      {trace.length > 0 ? (
                        isExpanded ? <ChevronDown size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} /> : <ChevronRight size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 14, height: 14, flexShrink: 0 }} />
                      )}
                      
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isPinned ? 600 : 400 }}>
                        {name}
                        {entity._risk_score !== undefined && (
                          <span style={{ marginLeft: 8, fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                            Risk: {entity._risk_score} (Base: {entity._base_score})
                          </span>
                        )}
                      </span>
                    </div>

                    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                      {/* Graph viz button */}
                      {(entity._path_trace?.length > 0) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedGraphEntity(entity); }}
                          title="Visualize path graph"
                          style={{ background:'var(--bg-elevated)', border:'1px solid var(--border-subtle)', borderRadius:4, padding:'3px 4px', color:'var(--text-muted)', cursor:'pointer', display:'flex', alignItems:'center' }}
                        >
                          <Network size={11} />
                        </button>
                      )}
                      {/* Pin button */}
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          const currentPinned = formData.pinnedEntities || [];
                          if (isPinned) {
                            handleChange('pinnedEntities', currentPinned.filter(n => n !== name));
                          } else {
                            handleChange('pinnedEntities', [...currentPinned, name]);
                          }
                        }}
                        style={{ cursor:'pointer', padding:4, display:'flex', alignItems:'center' }}
                      >
                        {isPinned ? <Pin size={12} fill="var(--cyan)" color="var(--cyan)" /> : <PinOff size={12} color="var(--text-muted)" style={{ opacity:0.5 }} />}
                      </div>
                    </div>
                  </div>
                  
                  {isExpanded && trace.length > 0 && (
                    <div style={{ 
                      padding: '8px 10px', 
                      background: 'var(--bg-elevated)', 
                      borderRadius: 6, 
                      borderLeft: '2px solid var(--cyan)',
                      borderRight: '1px solid var(--border-subtle)',
                      borderTop: '1px solid var(--border-subtle)',
                      borderBottom: '1px solid var(--border-subtle)',
                      fontSize: '0.65rem',
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: 8,
                      marginBottom: 8,
                      marginLeft: 14
                    }}>
                      <div style={{ color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>Path Trace Analysis</div>
                      {trace.map((step, sIdx) => (
                        <div key={sIdx} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-primary)' }}>
                            <span style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ color: 'var(--cyan)' }}>[{step.step}]</span>
                              {step.relation}
                            </span>
                            <span style={{ color: step.score > 70 ? '#EF4444' : step.score > 35 ? '#F59E0B' : '#10B981', fontWeight: 600 }}>
                              {step.score}%
                            </span>
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', paddingLeft: 16 }}>
                            ↳ {step.from}
                          </div>
                          {step.reason && (
                            <div style={{ color: 'var(--text-muted)', paddingLeft: 16, marginTop: 2, lineHeight: 1.3 }}>
                              {step.reason}
                            </div>
                          )}
                          {(step.src_node || step.tgt_node) && (
                            <details style={{ paddingLeft: 16, marginTop: 4 }}>
                              <summary style={{ cursor: 'pointer', fontSize: '0.55rem', color: 'var(--cyan)', outline: 'none' }}>View Node Attributes</summary>
                              <div style={{ marginTop: 4, padding: 6, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 4, fontSize: '0.55rem', fontFamily: 'monospace', overflowX: 'auto' }}>
                                {step.src_node && (
                                  <div style={{ marginBottom: 6 }}>
                                    <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 2 }}>Source Node:</strong>
                                    <pre style={{ margin: 0, color: 'var(--text-primary)' }}>{JSON.stringify(step.src_node, null, 2)}</pre>
                                  </div>
                                )}
                                {step.tgt_node && (
                                  <div>
                                    <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 2 }}>Target Node:</strong>
                                    <pre style={{ margin: 0, color: 'var(--text-primary)' }}>{JSON.stringify(step.tgt_node, null, 2)}</pre>
                                  </div>
                                )}
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
};

// Upstream Data Resolver (Do NOT modify this function per Principle 6)
const resolveUpstreamData = (incomingNodes) => {
  for (const n of incomingNodes) {
    if (!n.data) continue;
    const candidates = [n.data.data, n.data.extracted, n.data.resolvedEntity, n.data.pinned, n.data.unpinned];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) return c;
    }
    for (const c of candidates) {
      if (c && typeof c === 'object' && !Array.isArray(c)) return [c];
    }
  }
  return [];
};

export default memo(({ id, data, selected, edges, nodes, setNodes }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // The previewInput Sync Hook
  const prevInputRef = useRef(undefined);
  useEffect(() => {
    if (!edges || !nodes || !setNodes) return;
    
    const incomingEdges = edges.filter(e => e.target === id);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    
    const dataList = resolveUpstreamData(incomingNodes);
    const sampleEntity = dataList.length > 0 ? dataList[0] : null;

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

  const pinnedNames = data.pinnedEntities || [];
  const allData = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
  const pinnedEntities = allData.filter(e => pinnedNames.includes(getEntityName(e, data.displayNameProperty)));

  const highRisk   = Array.isArray(data.high_risk)   ? data.high_risk   : [];
  const mediumRisk = Array.isArray(data.medium_risk) ? data.medium_risk : [];
  const lowRisk    = Array.isArray(data.low_risk)    ? data.low_risk    : [];
  const total = highRisk.length + mediumRisk.length + lowRisk.length;

  // Derive query info from the last run's entity metadata
  const sampleEntity = highRisk[0] || mediumRisk[0] || lowRisk[0];
  const targetConcept = sampleEntity?._target_concept || null;
  const relationType  = sampleEntity?._relation_type  || null;
  const topPathScore  = sampleEntity?._path_score     || null;
  const topRiskScore  = sampleEntity?._risk_score     || null;

  // Score range across last run
  const allScored = [...highRisk, ...mediumRisk, ...lowRisk];
  const scores = allScored.map(e => e._risk_score).filter(s => s != null);
  const maxScore = scores.length ? Math.max(...scores).toFixed(1) : null;
  const minScore = scores.length ? Math.min(...scores).toFixed(1) : null;

  // Top high-risk path trace preview
  const topTrace = highRisk[0]?._path_trace;

  const statBar = (color, count, label) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: '0.65rem', color, fontWeight: 700 }}>{count}</span>
      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );

  return (
    <BaseNode
      label={config.label}
      icon={config.icon}
      type={config.type}
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color={config.color}
      collapsedInfo={
        total > 0
          ? <span style={{ display: 'flex', gap: 8, fontSize: '0.65rem' }}>
              <span style={{ color: '#EF4444', fontWeight: 700 }}>{highRisk.length}H</span>
              <span style={{ color: '#F59E0B', fontWeight: 700 }}>{mediumRisk.length}M</span>
              <span style={{ color: '#10B981', fontWeight: 700 }}>{lowRisk.length}L</span>
            </span>
          : <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>No results yet</span>
      }
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>

        {/* Input Handle */}
        <Handle type="target" position={Position.Left} id="data" style={{ left: -6 }} />

        {/* ── Live Stats Bar ── */}
        {total > 0 && (
          <div style={{
            display: 'flex', gap: 4, padding: '6px 8px', marginBottom: 8,
            background: 'var(--bg-surface)', borderRadius: 6,
            border: '1px solid var(--border-subtle)'
          }}>
            {statBar('#EF4444', highRisk.length,   'High')}
            {statBar('#F59E0B', mediumRisk.length, 'Med')}
            {statBar('#10B981', lowRisk.length,    'Low')}
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 4 }}>
              / {total} total
            </span>
          </div>
        )}

        {/* ── Active Query Info ── */}
        {(targetConcept || relationType) && (
          <div style={{
            padding: '6px 8px', marginBottom: 8, borderRadius: 6,
            background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)'
          }}>
            <p style={{ fontSize: '0.6rem', color: 'rgba(139,92,246,0.7)', margin: '0 0 4px' }}>LAST QUERY</p>
            {relationType && (
              <p style={{ fontSize: '0.65rem', color: 'var(--text-primary)', margin: '0 0 2px', fontFamily: 'monospace' }}>
                <span style={{ color: 'rgba(139,92,246,0.9)' }}>[{relationType}]</span>
              </p>
            )}
            {targetConcept && (
              <p style={{ fontSize: '0.65rem', color: 'var(--cyan)', margin: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                → "{targetConcept}"
              </p>
            )}
          </div>
        )}

        {/* ── Score Range ── */}
        {scores.length > 0 && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 8,
            background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border-subtle)'
          }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
              Score range: <span style={{ color: '#10B981' }}>{minScore}</span>
              <span style={{ color: 'var(--text-muted)' }}> → </span>
              <span style={{ color: '#EF4444' }}>{maxScore}</span>
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
              {allScored[0]?._hops != null ? `max ${Math.max(...allScored.map(e => e._hops || 0))} hops` : ''}
            </span>
          </div>
        )}

        {/* ── Top High-Risk Path Trace Preview ── */}
        {topTrace && topTrace.length > 0 && (
          <div style={{
            padding: '6px 8px', marginBottom: 8, borderRadius: 6,
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)'
          }}>
            <p style={{ fontSize: '0.6rem', color: 'rgba(239,68,68,0.7)', margin: '0 0 4px' }}>
              TOP HIGH-RISK PATH — score {topRiskScore}
            </p>
            {topTrace.slice(0, 3).map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 2 }}>
                <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', minWidth: 12, paddingTop: 1 }}>{step.step}.</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '0.6rem', color: 'var(--cyan)', fontFamily: 'monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {step.from}
                  </span>
                  {step.reason && (
                    <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {step.reason.slice(0, 60)}{step.reason.length > 60 ? '…' : ''}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '0.55rem', color: step.score >= 80 ? '#EF4444' : step.score >= 50 ? '#F59E0B' : '#10B981',
                  fontWeight: 700, flexShrink: 0 }}>{step.score}%</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Output Handles ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.75rem', marginTop: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ marginRight: '8px', color: 'var(--text-main)' }}>All Data</span>
            <Handle type="source" position={Position.Right} id="data" style={{ position: 'relative', right: -6, transform: 'none' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ marginRight: '8px', color: '#EF4444' }}>High Risk</span>
            <Handle type="source" position={Position.Right} id="high_risk" style={{ position: 'relative', right: -6, transform: 'none', background: '#EF4444' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ marginRight: '8px', color: '#F59E0B' }}>Medium Risk</span>
            <Handle type="source" position={Position.Right} id="medium_risk" style={{ position: 'relative', right: -6, transform: 'none', background: '#F59E0B' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ marginRight: '8px', color: '#10B981' }}>Low Risk</span>
            <Handle type="source" position={Position.Right} id="low_risk" style={{ position: 'relative', right: -6, transform: 'none', background: '#10B981' }} />
          </div>
        </div>
        
        {pinnedEntities.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>
              <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>
                Pinned — {pinnedEntities.length} entities
              </p>
              <Handle type="source" id="pinned" position={Position.Right} style={{ right: -6, background: 'var(--cyan)', width: 10, height: 10, border: '2px solid var(--bg-surface)' }} />
            </div>
            {pinnedEntities.map((entity, idx) => {
              const name = getEntityName(entity, data.displayNameProperty);
              const uniqueId = entity._hve_id != null ? `hve_${entity._hve_id}` : entity.hve_id != null ? `hve_${entity.hve_id}` : entity.id != null ? `id_${entity.id}` : `idx_${idx}`;
              return (
                <div key={`pinned-${uniqueId}-${name}`} style={{ 
                  position: 'relative', 
                  background: 'var(--bg-elevated)', 
                  padding: '4px 8px', 
                  borderRadius: 4, 
                  fontSize: '0.65rem',
                  border: '1px solid var(--cyan)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  <Pin size={10} color="var(--cyan)" fill="var(--cyan)" />
                  <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                    {name}
                  </span>
                  <Handle 
                    type="source" 
                    id={`entity-out-pinned-${uniqueId}::${name}`}
                    position={Position.Right} 
                    style={{ right: -6, background: 'var(--cyan)', width: 10, height: 10, border: '2px solid var(--bg-surface)', zIndex: 10 }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BaseNode>
  );
});