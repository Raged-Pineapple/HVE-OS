import React, { useState, useCallback, useRef } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap
} from 'reactflow';
import 'reactflow/dist/style.css';

import Sidebar from './components/Sidebar';
import {
  DataTriggerNode,
  AIAnalysisNode,
  DecisionNode,
  ActionNode
} from './components/CustomNodes';
import './App.css';

const initialNodes = [
  {
    id: '1',
    type: 'dataTrigger',
    data: { label: 'Weather API', id: 'weather_1' },
    position: { x: 300, y: 100 },
  },
];

const nodeTypes = {
  dataTrigger: DataTriggerNode,
  aiAnalysis: AIAnalysisNode,
  decision: DecisionNode,
  action: ActionNode,
};

let id = 0;
const getId = () => `dndnode_${id++}`;

const DnDFlow = () => {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), []);

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
        data: { label: `${type} node`, id: `config_${id}` },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance]
  );

  const handleDeploy = async () => {
    const { deployWorkflow } = await import('./api/client.js');

    // Convert visual node objects into execution python commands 
    const steps = nodes
      .filter(n => n.type !== 'dataTrigger')
      .map(n => {
        if (n.type === 'aiAnalysis') return 'predict_risk';
        if (n.type === 'decision') return 'run_optimization';
        if (n.type === 'action') return 'trigger_webhook';
        return 'unknown';
      });

    const triggerNode = nodes.find(n => n.type === 'dataTrigger');

    const payload = {
      name: "React Visual Workflow",
      trigger: {
        type: "UI Trigger",
        target_entity_id: triggerNode ? triggerNode.data.id : "WEATHER_HURRICANE"
      },
      steps: steps
    };

    alert("Compiling UI graph and deploying to Python Backend Interpreter... 🚀");
    try {
      const result = await deployWorkflow(payload);
      alert(`✅ Execution Complete!\n\nTrace Output:\n${JSON.stringify(result.execution_trace, null, 2)}`);
    } catch (e) {
      alert("⚠️ Deployment failed. Is the FastAPI backend running?");
    }
  };

  return (
    <div className="app-container">
      <ReactFlowProvider>
        <Sidebar />
        <div className="reactflow-wrapper" ref={reactFlowWrapper}>
          <button className="deploy-btn glass-panel" onClick={handleDeploy}>Deploy Workflow 🚀</button>
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
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Controls className="glass-panel" />
            <Background color="#aaa" gap={16} />
            <MiniMap
              nodeStrokeColor={(n) => {
                if (n.type === 'dataTrigger') return 'var(--accent-blue)';
                if (n.type === 'aiAnalysis') return 'var(--accent-purple)';
                if (n.type === 'decision') return 'var(--accent-orange)';
                return 'var(--text-primary)';
              }}
              nodeColor="var(--surface-1)"
              maskColor="hsla(220, 30%, 8%, 0.7)"
              className="glass-panel"
              style={{ backgroundColor: 'var(--bg-color)' }}
            />
          </ReactFlow>
        </div>
      </ReactFlowProvider>
    </div>
  );
};

export default DnDFlow;
