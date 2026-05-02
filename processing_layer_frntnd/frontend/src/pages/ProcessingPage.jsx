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

const nodeTypes = getNodeTypes();

let id = 0;
const getId = () => `node_${id++}`;

const LogicGraphTab = () => {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
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

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const sourceId = event.dataTransfer.getData('sourceId');
      
      const newNode = {
        id: getId(),
        type,
        position,
        data: { id: sourceId || `cfg_${Math.floor(Math.random() * 1000)}` },
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
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={nodeTypes}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
          >
            <Controls />
            <Background color="var(--text-muted)" gap={16} />
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
