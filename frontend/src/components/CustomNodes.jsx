import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Database, Filter, Brain, Zap } from 'lucide-react';

const NodeWrapper = ({ label, subtext, icon: Icon, type, data }) => (
    <div className={`glass-panel custom-node ${type} ${data?.selected ? 'selected' : ''}`}>
        <Handle type="target" position={Position.Top} className="handle-top" />
        <div className="node-header">
            <Icon size={18} color="var(--accent-blue)" />
            <span className="node-title">{label}</span>
        </div>
        <div className="node-content">
            {subtext}
            <br />
            <span className="node-tag">{data.id || "Unconfigured"}</span>
        </div>
        <Handle type="source" position={Position.Bottom} className="handle-bottom" />
    </div>
);

export const DataTriggerNode = memo(({ data }) => (
    <NodeWrapper
        label="Data Trigger"
        subtext="Fetches Raw Connector Data"
        icon={Database}
        type="input"
        data={data}
    />
));

export const AIAnalysisNode = memo(({ data }) => (
    <NodeWrapper
        label="AI Analysis"
        subtext={`Model: ${data.model || 'Kalman Filter'}`}
        icon={Brain}
        type="ai"
        data={data}
    />
));

export const DecisionNode = memo(({ data }) => (
    <NodeWrapper
        label="Decision engine"
        subtext="OR-Tools CP-SAT Optimizer"
        icon={Filter}
        type="decision"
        data={data}
    />
));

export const ActionNode = memo(({ data }) => (
    <NodeWrapper
        label="Action Executor"
        subtext="Webhooks & APIs"
        icon={Zap}
        type="action"
        data={data}
    />
));
