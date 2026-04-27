import React, { memo, useState, useEffect } from 'react';
import { Handle, Position } from 'reactflow';
import { Database, Filter, Brain, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { getEntityKeys } from '../api/client.js';

const NodeWrapper = ({ label, subtext, icon: Icon, type, data, selected, children }) => (
    <div className={`card custom-node ${type} ${selected ? 'selected' : ''}`} style={{ minWidth: 180 }}>
        <Handle type="target" position={Position.Top} className="handle-top" />
        <div className="node-header">
            <Icon size={18} color={type === 'input' ? "var(--accent-blue)" : type === 'ai' ? "var(--accent-purple)" : "var(--accent-orange)"} />
            <span className="node-title">{label}</span>
        </div>
        <div className="node-content">
            {subtext}
            <br />
            <span className="node-tag">{data.id || "Unconfigured"}</span>
        </div>
        {children}
        <Handle type="source" position={Position.Bottom} className="handle-bottom" />
    </div>
);

export const DataTriggerNode = memo(({ data, selected }) => {
    const [keys, setKeys] = useState([]);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        if (data.id && data.id !== "Unconfigured") {
            getEntityKeys(data.id)
                .then(setKeys)
                .catch(err => console.error("Error fetching keys:", err));
        }
    }, [data.id]);

    return (
        <div className={`card custom-node input ${selected ? 'selected' : ''}`} style={{ minWidth: 200 }}>
            <div className="node-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Database size={18} color="var(--accent-blue)" />
                    <span className="node-title" style={{ fontWeight: 600 }}>{data.id || "Data Source"}</span>
                </div>
                <button 
                    onClick={() => setIsExpanded(!isExpanded)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
            </div>
            
            <div className="node-content" style={{ padding: '8px 0' }}>
                <span className="node-tag" style={{ fontSize: '0.65rem', opacity: 0.8 }}>Source: {data.id}</span>
                
                {isExpanded && (
                    <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                        <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6, paddingLeft: 4 }}>Graph Properties</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {keys.map((key) => (
                                <div key={key} style={{ 
                                    position: 'relative', 
                                    padding: '4px 8px', 
                                    background: 'var(--bg-elevated)', 
                                    borderRadius: 4,
                                    fontSize: '0.7rem',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    margin: '0 8px'
                                }}>
                                    <Handle 
                                        type="target" 
                                        position={Position.Left} 
                                        id={`${key}-target`} 
                                        style={{ 
                                            left: -12, 
                                            background: 'var(--accent-orange)', 
                                            width: 8, 
                                            height: 8,
                                            border: '2px solid var(--bg-surface)' 
                                        }} 
                                    />
                                    <span style={{ fontFamily: 'JetBrains Mono' }}>{key}</span>
                                    <Handle 
                                        type="source" 
                                        position={Position.Right} 
                                        id={`${key}-source`} 
                                        style={{ 
                                            right: -12, 
                                            background: 'var(--cyan)', 
                                            width: 8, 
                                            height: 8,
                                            border: '2px solid var(--bg-surface)' 
                                        }} 
                                    />
                                </div>
                            ))}
                        </div>

                    </div>
                )}
            </div>
            
            {!isExpanded && <Handle type="source" position={Position.Bottom} id="default-source" className="handle-bottom" />}
            <Handle type="target" position={Position.Top} id="default-target" className="handle-top" />
        </div>
    );
});


export const AIAnalysisNode = memo(({ data, selected }) => (
    <NodeWrapper
        label="AI Analysis"
        subtext={`Model: ${data.model || 'Kalman Filter'}`}
        icon={Brain}
        type="ai"
        data={data}
        selected={selected}
    />
));

export const DecisionNode = memo(({ data, selected }) => (
    <NodeWrapper
        label="Decision engine"
        subtext="OR-Tools CP-SAT Optimizer"
        icon={Filter}
        type="decision"
        data={data}
        selected={selected}
    />
));

export const ActionNode = memo(({ data, selected }) => (
    <NodeWrapper
        label="Action Executor"
        subtext="Webhooks & APIs"
        icon={Zap}
        type="action"
        data={data}
        selected={selected}
    />
));
