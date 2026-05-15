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
import SettingsPanel from '../components/SettingsPanel';
import { getNodeTypes } from '../components/nodes/registry.js';
import { listGraphSources, getEntitiesByLabel } from '../api/client.js';
import { Play, Loader } from 'lucide-react';

const nodeTypes = getNodeTypes();

const getId = () => `node_${crypto.randomUUID()}`;

const LogicGraphTab = () => {
  const reactFlowWrapper = useRef(null);
  const wsRef = useRef(null);

  // Load persisted graph state from local browser storage to survive reloads
  const initialNodes = JSON.parse(localStorage.getItem('hve_os_logic_graph_nodes') || '[]');
  const initialEdges = JSON.parse(localStorage.getItem('hve_os_logic_graph_edges') || '[]');

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResults, setExecutionResults] = useState(null);
  const [isWsConnected, setIsWsConnected] = useState(false);
  const lastSentGraph = useRef('');
  const reconnectTimeout = useRef(null);

  useEffect(() => {
    const connectWs = () => {
      const wsUrl = `ws://${window.location.hostname}:8000/api/v1/ws/graph`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Connected to Graph WebSocket');
        setIsWsConnected(true);
        
        // Auto-hydrate the backend if we reconnected with an existing graph
        if (lastSentGraph.current) {
          try {
            const graphData = JSON.parse(lastSentGraph.current);
            ws.send(JSON.stringify({ type: 'graph_update', ...graphData }));
          } catch (e) {}
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'node_output') {
            const { nodeId, outputs, sourceId } = message;
            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === nodeId) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      ...(sourceId && outputs?.keys ? { keys: outputs.keys, count: outputs.count, data: outputs.data } : {}),
                      ...(outputs || {})
                    }
                  };
                }
                return node;
              })
            );
          } else if (message.type === 'graph_registered') {
            console.log(message.message);
          } else if (message.type === 'connected') {
            console.log(message.message);
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        console.log('Graph WebSocket disconnected');
        setIsWsConnected(false);
        // Try to auto-reconnect every 3 seconds
        reconnectTimeout.current = setTimeout(connectWs, 3000);
      };

      ws.onerror = (error) => {
        console.error('Graph WebSocket error:', error);
      };
    };

    connectWs();

    const handleSourceUpdate = (event) => {
      const { outputs, nodeId, sourceId } = event.detail;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                keys: outputs.keys || [],
                count: outputs.count || 0,
                data: outputs.data || []
              }
            };
          }
          return node;
        })
      );
    };

    const handleNodeOutputUpdate = (event) => {
      const { nodeId, outputs } = event.detail;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                ...outputs
              }
            };
          }
          return node;
        })
      );
    };

    window.addEventListener('source-node-updated', handleSourceUpdate);
    window.addEventListener('node-output-updated', handleNodeOutputUpdate);
    return () => {
      window.removeEventListener('source-node-updated', handleSourceUpdate);
      window.removeEventListener('node-output-updated', handleNodeOutputUpdate);
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        wsRef.current.onclose = null; // Prevent reconnect loop on unmount
        wsRef.current.close();
      }
    };
  }, [setNodes]);

  // Automatically persist graph to local storage and sync to backend
  useEffect(() => {
    const extractConfigData = (data) => {
      // Strip out execution results so we only track configuration changes.
      // This prevents infinite loops when the backend sends us data updates.
      const { keys, count, data: outputData, previewInput, _executionMetadata, error, success, ...config } = data || {};
      return config;
    };

    // 1. Prepare data for localStorage (needs position data, but no execution data)
    const storageNodes = nodes.map(n => ({
      ...n,
      data: extractConfigData(n.data)
    }));
    
    // Save locally
    localStorage.setItem('hve_os_logic_graph_nodes', JSON.stringify(storageNodes));
    localStorage.setItem('hve_os_logic_graph_edges', JSON.stringify(edges));

    // 2. Prepare data for backend sync (doesn't need positions, just logical flow)
    if (!isWsConnected) return;

    const graphNodes = storageNodes.map(n => ({
      id: n.id,
      type: n.type,
      data: n.data
    }));
    
    const graphEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle
    }));
    
    const currentGraphString = JSON.stringify({ nodes: graphNodes, edges: graphEdges });
    
    if (currentGraphString !== lastSentGraph.current && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'graph_update',
        nodes: graphNodes,
        edges: graphEdges
      }));
      lastSentGraph.current = currentGraphString;
    }
  }, [nodes, edges, isWsConnected]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, type: 'smoothstep' }, eds)),
    [setEdges]
  );

  const onNodeDoubleClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  const updateNodeData = useCallback((nodeId, newData) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return { ...node, data: newData };
        }
        return node;
      })
    );
  }, [setNodes]);

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

      const targetIsPane = event.target.classList.contains('react-flow__pane') || event.target.closest('.react-flow__pane');
      if (!targetIsPane) {
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      
      let sourceId = event.dataTransfer.getData('sourceId');
      
      let displayId = sourceId || `cfg_${Math.floor(Math.random() * 1000)}`;
      let tableName = sourceId;
      let snapshotPath = null;

      if (type === 'silverTable' && sourceId && sourceId.includes('::')) {
          const parts = sourceId.split('::');
          tableName = parts[0];
          if (parts[1] === 'manual') {
              snapshotPath = parts[2];
              if (parts.length > 3) {
                  displayId = parts[3];
              }
          }
      }

      const newNode = {
        id: getId(),
        type,
        position,
        data: { 
          id: displayId,
          label: displayId,
          ...(type === 'silverTable' && tableName ? { tableName } : {}),
          ...(snapshotPath ? { snapshotPath } : {}),
          ...(type === 'source' && sourceId ? { source_id: sourceId } : {})
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onInjectNode = useCallback((type, sourceId) => {
    if (!reactFlowInstance) return;
    
    const position = { x: Math.random() * 100 + 50, y: Math.random() * 100 + 50 };
    
    let tableName = sourceId;
    let snapshotId = null;
    let snapshotPath = null;
    let friendlyName = null;

    if (type === 'silverTable' && sourceId && sourceId.includes('::')) {
      const parts = sourceId.split('::');
      tableName = parts[0];
      if (parts[1] === 'manual') {
        snapshotPath = parts[2];
        if (parts.length > 3) {
            friendlyName = parts[3];
        }
      } else {
        snapshotId = parts[1];
      }
    }

    const displayId = friendlyName || tableName || `cfg_${Math.floor(Math.random() * 1000)}`;

    const newNode = {
      id: getId(),
      type,
      position,
      data: { 
        id: displayId,
        label: displayId,
        ...(type === 'silverTable' && tableName ? { tableName } : {}),
        ...(snapshotId ? { snapshotId } : {}),
        ...(snapshotPath ? { snapshotPath } : {}),
        ...(type === 'source' && sourceId ? { source_id: sourceId } : {})
      },
    };

    setNodes((nds) => nds.concat(newNode));
  }, [reactFlowInstance, setNodes]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative' }}>
      <ReactFlowProvider>
        <Sidebar onInjectNode={onInjectNode} />
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
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={nodeTypes}
            deleteKeyCode={['Backspace', 'Delete']}
            panOnDrag={[1, 2]}
            selectionOnDrag={true}
            selectionMode="partial"
            selectionKeyCode={null}
            connectionLineType="smoothstep"
            defaultEdgeOptions={{ type: 'smoothstep' }}
            fitView
          >
            <Controls />
            <Background color="var(--text-muted)" gap={16} />
            <div style={{
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 10,
              display: 'flex',
              gap: 8
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                background: 'var(--bg-elevated)',
                borderRadius: 6,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)'
              }}>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: isWsConnected ? 'var(--accent-teal)' : '#ef4444',
                  boxShadow: isWsConnected ? '0 0 8px var(--accent-teal)' : 'none'
                }} />
                {isWsConnected ? 'Live Graph Active' : 'Disconnected'}
              </div>
            </div>
          </ReactFlow>
        </div>
        {selectedNode && (
          <SettingsPanel 
            node={selectedNode} 
            nodes={nodes}
            edges={edges}
            onClose={() => setSelectedNode(null)} 
            onUpdate={updateNodeData} 
          />
        )}
      </ReactFlowProvider>
    </div>
  );
};

export default function ProcessingPage() {
  return (
    <div style={{ height: '100%', width: '100%' }}>
      <LogicGraphTab />
    </div>
  );
}
