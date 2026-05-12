# How to Create a New Logic Graph Node

The HVE-OS platform uses a **split architecture** for nodes:
- **Backend (Python)**: Contains the execution logic
- **Frontend (React)**: Contains the visual representation

This ensures logic is reusable, testable, and can be executed server-side.
HVE-OS relies on a **Reactive Event-Driven Engine**. You do not manually "run" graphs. The frontend constantly syncs the graph schema to the backend via WebSocket, and the backend engine runs nodes in isolated background threads, cascading data down the graph and streaming results back in real-time.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                 │
│   NodeComponent.jsx                                             │
│   - Visual rendering                                           │
│   - User interaction                                           │
│   - Calls backend APIs for execution                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ POST /api/v1/nodes/graph/execute
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND                                  │
│   src/Logic/nodes/[category]/[node_name].py                     │
│   - BaseNode class with execute() method                       │
│   - Registry auto-discovery                                     │
│   - GraphExecutor handles flow                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Create the Backend Node Function

### 1.1 Choose the Category
Place your node in the appropriate directory:
- `src/Logic/nodes/input/` - Data source nodes (like Source)
- `src/Logic/nodes/logic/` - Transformation nodes (like Add, Combine)
- `src/Logic/nodes/security/` - Security nodes (Encrypt, Decrypt)
- `src/Logic/nodes/database/` - Database nodes (SilverTable)
- `src/Logic/nodes/ai/` - AI/ML nodes
- `src/Logic/nodes/action/` - Action nodes

### 1.2 Create the Python File

Create `[node_name].py` in your chosen category:

```python
"""
my_node.py — My Custom Node
Description of what this node does.
"""
from typing import Any, Dict
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node


@register_node
class MyNode(BaseNode):
    """
    Node description displayed in API docs.
    """

    metadata = NodeMetadata(
        type="myNode",              # Unique identifier (matches frontend)
        category="logic",            # Category for sidebar
        label="My Node",            # Display name
        color="#3B82F6",           # UI color (hex or CSS var)
        input_handles=["input1", "input2"],   # Input port names
        output_handles=["output1"],            # Output port names
        description="What this node does",
        hide_in_sidebar=False
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        """
        Execute the node logic.

        Args:
            inputs: Dict mapping handle names to values from connected nodes
                    Example: {"input1": [{"key": "value"}], "input2": 42}
            config: Node configuration from frontend
                    Example: {"setting1": "value", "constant": 10}

        Returns:
            NodeResult with:
                - success: bool
                - outputs: Dict[str, Any] - values to pass to downstream nodes
                - error: Optional[str] - error message if failed
                - metadata: Dict[str, Any] - optional metadata
        """
        # Get input values
        input_data = inputs.get("input1", [])
        
        # Get config values
        setting = config.get("setting1", "default")
        
        # Your logic here
        result = process_data(input_data, setting)
        
        return NodeResult(
            success=True,
            outputs={
                "output1": result
            },
            metadata={"processed_count": len(result)}
        )

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """Optional: Add validation for config values."""
        if not config.get("required_field"):
            return False, "required_field is required"
        return True, None
```

### 1.3 Required Imports

If your node needs external services:

```python
from gateway.services.neo4j_service import get_neo4j_service
from gateway.services.query_service import execute_query
```

---

## Step 2: Create the Frontend Component

### 2.1 Choose the Category
Place your node in:
`processing_layer_frntnd/frontend/src/components/nodes/[category]/`

### 2.2 Create the React Component

Create `MyNode.jsx`:

```javascript
import React, { memo, useState, useEffect } from 'react';
import { Handle, Position } from 'reactflow';
import { MyIcon } from 'lucide-react';
import BaseNode from '../BaseNode';

export const config = {
  type: 'myNode',           // Must match backend type
  category: 'logic',        // Must match backend category
  label: 'My Node',        // Display name
  icon: MyIcon,
  color: '#3B82F6',
  hideInSidebar: false
};

export default memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Access inputs passed from upstream nodes
  const inputData = data.input1 || [];
  
  // Access config set by user
  const setting = data.setting1;

  return (
    <BaseNode
      label={data.label || config.label}
      icon={config.icon}
      type={config.type}
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color={config.color}
      collapsedInfo={<span style={{ color: 'var(--text-muted)' }}>{inputData.length} inputs</span>}
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        {/* Custom UI content */}
        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Input count: {inputData.length}
        </p>
        
        {/* Input handle */}
        <Handle 
          type="target" 
          position={Position.Left} 
          id="input1" 
          style={{ left: -6, background: 'var(--amber)' }} 
        />
        
        {/* Output handle */}
        <Handle 
          type="source" 
          position={Position.Right} 
          id="output1" 
          style={{ right: -6, background: 'var(--cyan)' }} 
        />
      </div>
    </BaseNode>
  );
});
```

### 2.3 BaseNode Props

The `BaseNode` component accepts:
- `label` - Node title
- `icon` - Lucide icon component
- `type` - Node type string
- `data` - Node data from graph
- `selected` - Boolean for selected state
- `isExpanded` - Expand/collapse state
- `setIsExpanded` - Callback to toggle expand
- `color` - Accent color
- `collapsedInfo` - JSX/Text to display cleanly when the node is collapsed
- `hideDefaultSource` - Hide the default right-side handle (boolean)
- `hideDefaultTarget` - Hide the default left-side handle (boolean)

---

## Step 3: Test Your Node

### 3.1 Verify Backend Registration

```bash
curl http://localhost:8000/api/v1/nodes/types
```

Should return your node in the list.

### 3.2 Test Single Node Execution

```bash
curl -X POST http://localhost:8000/api/v1/nodes/execute/myNode \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {"input1": [{"key": "value"}]},
    "config": {"setting1": "test"}
  }'
```

### 3.3 Test Full Graph Execution

```bash
curl -X POST http://localhost:8000/api/v1/nodes/graph/execute \
  -H "Content-Type: application/json" \
  -d '{
    "nodes": [
      {"id": "n1", "type": "source", "data": {"source_id": "flights"}},
      {"id": "n2", "type": "myNode", "data": {"setting1": "value"}}
    ],
    "edges": [
      {"source": "n1", "target": "n2", "sourceHandle": "default", "targetHandle": "input1"}
    ]
  }'
```

---

## Node Development Checklist

| Step | Task | File |
|------|------|------|
| 1 | Create Python node class | `src/Logic/nodes/[category]/[node].py` |
| 2 | Define NodeMetadata | In Python file |
| 3 | Implement execute() method | In Python file |
| 4 | Register with @register_node decorator | In Python file |
| 5 | Create React component | `processing_layer_frntnd/frontend/src/components/nodes/[category]/[Node].jsx` |
| 6 | Export config object | In JSX file |
| 7 | Test backend registration | `GET /api/v1/nodes/types` |
| 8 | Test node execution | `POST /api/v1/nodes/execute/{type}` |

---

## Key Concepts

### Input/Output Handles
Handles connect nodes together. Each handle has an ID:
- Backend: `input_handles=["value", "constant"]`
- Frontend: `<Handle id="value" />`

### Data Flow
1. User drags node to canvas
2. User configures node (settings panel)
3. User clicks "Execute Graph"
4. Backend executes nodes in topological order
5. Results returned to frontend and displayed

### Event-Driven Updates (Optional)
For nodes that need real-time updates (like Source):

```javascript
// In frontend component
useEffect(() => {
  const es = new EventSource('http://localhost:8000/api/v1/events');
  es.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'source_update') {
      // Refresh data
    }
  };
  return () => es.close();
}, []);
```