import React from 'react';
import { Database, Brain, Filter, Zap } from 'lucide-react';

export default () => {
    const onDragStart = (event, nodeType) => {
        event.dataTransfer.setData('application/reactflow', nodeType);
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <aside className="sidebar glass-panel">
            <h2>Logic Graph</h2>
            <p>Drag nodes onto the canvas to construct your operational pipeline.</p>

            <div className="dndnode input" onDragStart={(e) => onDragStart(e, 'dataTrigger')} draggable>
                <Database size={16} color="var(--accent-blue)" />
                Data Trigger
            </div>

            <div className="dndnode ai" onDragStart={(e) => onDragStart(e, 'aiAnalysis')} draggable>
                <Brain size={16} color="var(--accent-purple)" />
                AI Analysis
            </div>

            <div className="dndnode decision" onDragStart={(e) => onDragStart(e, 'decision')} draggable>
                <Filter size={16} color="var(--accent-orange)" />
                Decision Engine
            </div>

            <div className="dndnode action" onDragStart={(e) => onDragStart(e, 'action')} draggable>
                <Zap size={16} color="var(--accent-teal)" />
                Action Node
            </div>
        </aside>
    );
};
