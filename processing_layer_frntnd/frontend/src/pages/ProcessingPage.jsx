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

const LogicGraphTab = ({ isVisible }) => {
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

  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const [shouldRenderFlow, setShouldRenderFlow] = useState(false);
  useEffect(() => {
    if (isVisible) {
      setShouldRenderFlow(true);
    }
  }, [isVisible]);

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
            const { nodeId, outputs, success, error, metadata, sourceId } = message;
            
            // Intercept MapNode to sync coordinates with Geospatial Map
            const targetNode = nodesRef.current.find(n => n.id === nodeId);
            if (targetNode?.type === 'mapNode' && success && Array.isArray(outputs?.data)) {
              localStorage.setItem('hve_world_map_points', JSON.stringify(outputs.data));
              if (targetNode.data?.trackingBoundary) {
                localStorage.setItem('hve_world_map_tracking_boundary', targetNode.data.trackingBoundary);
                window.dispatchEvent(new CustomEvent('map-config-updated', { detail: { trackingBoundary: targetNode.data.trackingBoundary } }));
              }
              window.dispatchEvent(new CustomEvent('map-points-updated', { detail: outputs.data }));
            }

            setNodes((nds) =>
              nds.map((node) => {
                if (node.id === nodeId) {
                  // Shield against out-of-order progress ticks arriving after final completed metrics
                  const hasFinalMetrics = node.data.metrics?.r2 !== undefined;
                  const incomingIsProgressTick = outputs?.metrics?.current_epoch !== undefined && outputs?.metrics?.r2 === undefined;
                  if (hasFinalMetrics && incomingIsProgressTick) {
                    return node;
                  }

                  const cleanedData = { ...node.data };
                  Object.keys(cleanedData).forEach(k => {
                    if (
                      k.startsWith('entity-out-') ||
                      k.startsWith('attr-out-') ||
                      k.startsWith('combine-out-') ||
                      k.startsWith('resolvedEntity_') ||
                      [
                        'data', 'extracted', 'pinned', 'unpinned',
                        'resolvedEntity', 'success', 'error', 'metadata',
                        'keys', 'count', 'columns', 'row_count', 'pinned_count', 'unpinned_count'
                      ].includes(k)
                    ) {
                      delete cleanedData[k];
                    }
                  });

                  return {
                    ...node,
                    data: {
                      ...cleanedData,
                      ...(sourceId && outputs?.keys ? { keys: outputs.keys, count: outputs.count, data: outputs.data } : {}),
                      ...(outputs || {}),
                      metadata: metadata || cleanedData.metadata,
                      success,
                      error
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
      const {
        keys,
        count,
        data: outputData,
        previewInput,
        resolvedEntity,
        pinned,
        unpinned,
        extracted,
        columns,
        snapshotPath,
        inputSnapshotPath,
        row_count,
        _executionMetadata,
        error,
        success,
        metrics,
        model_info,
        isTraining,
        metadata,
        pinned_count,
        unpinned_count,
        high_risk,
        medium_risk,
        low_risk,
        ...config
      } = data || {};
      
      // Strip any dynamic handles/outputs to prevent infinite loops when data changes
      Object.keys(config).forEach(k => {
        if (
          k.startsWith('entity-out-') ||
          k.startsWith('attr-out-') ||
          k.startsWith('combine-out-') ||
          k.startsWith('resolvedEntity_')
        ) {
          delete config[k];
        }
      });

      return config;
    };

    const getConnectedEntityHandles = (nodeId) =>
      edges
        .filter((edge) => edge.source === nodeId)
        .map((edge) => edge.sourceHandle)
        .filter((handle) => handle && handle.startsWith('entity-out-'));

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

    const graphNodes = storageNodes.map(n => {
      const graphData = { ...n.data };

      if (n.type === 'extractEntities') {
        graphData.connectedHandles = getConnectedEntityHandles(n.id);
      }

      if (
        [
          'encryptNode',
          'decryptNode',
          'heComputeNode',
          'fheSequentialModelNode',
          'inference'
        ].includes(n.type)
      ) {
        const liveNode = nodes.find((node) => node.id === n.id);
        if (liveNode?.data?.inputSnapshotPath) {
          graphData.inputSnapshotPath = liveNode.data.inputSnapshotPath;
        }
      }

      return {
        id: n.id,
        type: n.type,
        data: graphData
      };
    });
    
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
          {shouldRenderFlow && (
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
          )}
        </div>
        {selectedNode && (
          <SettingsPanel 
            node={nodes.find(n => n.id === selectedNode.id) || selectedNode} 
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

export default function ProcessingPage({ isVisible }) {
  return (
    <div style={{ height: '100%', width: '100%' }}>
      <LogicGraphTab isVisible={isVisible} />
    </div>
  );
}
