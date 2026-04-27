import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
} from 'reactflow';
import 'reactflow/dist/style.css';
import '../App.css';

import Sidebar from '../components/Sidebar';
import { DataTriggerNode, AIAnalysisNode, DecisionNode, ActionNode } from '../components/CustomNodes';
import { listGraphSources, getEntitiesByLabel } from '../api/client.js';

const nodeTypes = {
  dataTrigger: DataTriggerNode,
  aiAnalysis: AIAnalysisNode,
  decision: DecisionNode,
  action: ActionNode,
};

let id = 0;
const getId = () => `node_${id++}`;

const LogicGraphTab = () => {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');

      if (typeof type === 'undefined' || !type) {
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      
      const newNode = {
        id: getId(),
        type,
        position,
        data: { id: `cfg_${Math.floor(Math.random() * 1000)}` },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative' }}>
      <ReactFlowProvider>
        <Sidebar />
        <div className="reactflow-wrapper" ref={reactFlowWrapper} style={{ flexGrow: 1, height: '100%' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
          >
            <Controls />
            <Background color="var(--text-muted)" gap={16} />
          </ReactFlow>
        </div>
      </ReactFlowProvider>
    </div>
  );
};

const ImportsTab = () => {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [expandedSource, setExpandedSource] = useState(null);
  const [entities, setEntities] = useState({});
  const [loadingEntities, setLoadingEntities] = useState({});

  const load = () => {
    setLoading(true);
    listGraphSources()
      .then(setSources)
      .catch((e) => console.error("Failed to load sources", e))
      .finally(() => setLoading(false));
  };

  const toggleExpand = async (sourceId) => {
    if (expandedSource === sourceId) {
      setExpandedSource(null);
      return;
    }
    setExpandedSource(sourceId);
    if (!entities[sourceId]) {
      setLoadingEntities(prev => ({ ...prev, [sourceId]: true }));
      try {
        const data = await getEntitiesByLabel(sourceId);
        setEntities(prev => ({ ...prev, [sourceId]: data }));
      } catch (e) {
        console.error("Failed to fetch entities", e);
      } finally {
        setLoadingEntities(prev => ({ ...prev, [sourceId]: false }));
      }
    }
  };


  useEffect(() => {
    load();
  }, []);

  const onDragStart = (event, nodeType, sourceId) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('sourceId', sourceId);
    event.dataTransfer.effectAllowed = 'move';
  };

  const statusDot = (ps) => {
    if (!ps) return <span title="No API config" style={{ width:8, height:8, borderRadius:'50%', background:'var(--text-muted)', display:'inline-block', opacity:0.4 }} />;
    if (ps.last_status === 'SUCCESS') return <span title={`OK — last polled ${ps.last_polled_at||'never'}`} style={{ width:8, height:8, borderRadius:'50%', background:'#34d399', display:'inline-block', boxShadow:'0 0 6px #34d39960' }} />;
    if (ps.last_status === 'ERROR') return <span title={ps.last_error||'Error'} style={{ width:8, height:8, borderRadius:'50%', background:'#f05050', display:'inline-block', boxShadow:'0 0 6px #f0505060' }} />;
    return <span title={`Status: ${ps.last_status||'pending'}`} style={{ width:8, height:8, borderRadius:'50%', background:'#fbbf24', display:'inline-block' }} />;
  };

  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/reactflow');
    const sourceId = event.dataTransfer.getData('sourceId');

    if (typeof type === 'undefined' || !type) return;

    const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    
    const newNode = {
      id: getId(),
      type,
      position,
      data: { id: sourceId },
    };
    setNodes((nds) => nds.concat(newNode));
  }, [reactFlowInstance, setNodes]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', paddingRight: 16, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Imports</h3>
          <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', fontSize: '0.9rem' }}>↺</button>
        </div>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><span className="spinner" /></div>}
        {!loading && sources.length === 0 && <div className="empty-state" style={{ padding: 16, fontSize: '0.76rem' }}>No sources yet.</div>}
        {sources.map(s => (
          <div key={s.source_id} style={{ marginBottom: 6 }}>
            <div 
              className="card dndnode" 
              style={{ 
                padding: '10px 12px', 
                cursor: 'pointer', 
                background: expandedSource === s.source_id ? 'var(--cyan-dim)' : 'var(--glass-bg)', 
                borderColor: expandedSource === s.source_id ? 'var(--cyan)' : 'var(--border-default)',
                transition: 'all 0.2s ease'
              }}
              onClick={() => toggleExpand(s.source_id)}
              onDragStart={(e) => onDragStart(e, 'dataTrigger', s.source_id)}
              draggable
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {statusDot(s.poll_status)}
                  <p style={{ fontWeight: 600, fontSize: '0.8rem', margin: 0 }}>{s.source_id}</p>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{expandedSource === s.source_id ? '▲' : '▼'}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', width: '100%', fontSize:'0.66rem', color:'var(--text-muted)' }}>
                <span>{s.source_type}</span>
              </div>
            </div>

            {expandedSource === s.source_id && (
              <div style={{ 
                padding: '8px 12px', 
                background: 'rgba(0,0,0,0.2)', 
                border: '1px solid var(--border-subtle)', 
                borderTop: 'none',
                borderRadius: '0 0 8px 8px',
                fontSize: '0.75rem',
                maxHeight: '200px',
                overflowY: 'auto'
              }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Neo4j Entities ({s.source_id.charAt(0).toUpperCase() + s.source_id.slice(1)})</p>
                {loadingEntities[s.source_id] ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 10 }}><span className="spinner" style={{ width: 14, height: 14 }} /></div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {entities[s.source_id]?.length > 0 ? (
                      entities[s.source_id].map((ent, idx) => (
                        <div key={idx} style={{ 
                          padding: '4px 8px', 
                          background: 'var(--bg-elevated)', 
                          borderRadius: 4,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontFamily: 'JetBrains Mono',
                          fontSize: '0.7rem'
                        }} title={JSON.stringify(ent)}>
                          {ent.name || ent.id || ent.title || Object.values(ent)[0] || 'Unknown Entity'}
                        </div>
                      ))
                    ) : (
                      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.7rem' }}>No entities found in graph.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

      </div>
      
      <ReactFlowProvider>
        <div className="reactflow-wrapper" ref={reactFlowWrapper} style={{ flexGrow: 1, height: '100%', paddingLeft: 16 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
          >
            <Controls />
            <Background color="var(--text-muted)" gap={16} />
          </ReactFlow>
        </div>
      </ReactFlowProvider>
    </div>
  );
};

export default function ProcessingPage() {
  const [tab, setTab] = useState('logic');
  const tabs = [
    { id: 'logic', icon: '⚙', label: 'Logic Graph' },
    { id: 'imports', icon: '⬇', label: 'Imports' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div style={{ padding: '20px 32px 0', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <h1 style={{ marginBottom: 2 }}>Processing</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 16 }}>Configure logic and data imports.</p>
        <div style={{ display: 'flex' }}>
          {tabs.map(t => (
            <button 
              key={t.id} 
              onClick={() => setTab(t.id)} 
              style={{ 
                padding: '10px 22px', 
                border: 'none', 
                cursor: 'pointer', 
                background: 'transparent', 
                color: tab === t.id ? 'var(--cyan)' : 'var(--text-muted)', 
                borderBottom: tab === t.id ? '2px solid var(--cyan)' : '2px solid transparent', 
                fontWeight: tab === t.id ? 600 : 400, 
                fontSize: '0.9rem', 
                display: 'flex', 
                alignItems: 'center', 
                gap: 7 
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', padding: '28px 32px' }}>
        {tab === 'logic' && <LogicGraphTab />}
        {tab === 'imports' && <ImportsTab />}
      </div>
    </div>
  );
}
