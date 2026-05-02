# How to Create a New Logic Graph Node

The frontend application uses a **dynamic node registry** to automatically detect and register new nodes. This means you only need to create a single file to add a fully functional, draggable node to the interface.

## Step 1: Create the Node File

Create a new `.jsx` file inside the `src/components/nodes/` directory. You should place it in the appropriate subdirectory based on its category (e.g., `logic`, `ai`, `decision`, `action`).

**Example Path:**
`processing_layer_frntnd/frontend/src/components/nodes/action/MyNewNode.jsx`

## Step 2: Define the Configuration

Your node file must export a constant named `config`. This object tells the system how to categorize, style, and identify your node in the sidebar and React Flow canvas.

```javascript
import { Sparkles } from 'lucide-react';

export const config = {
  type: 'myNewNode',           // A unique string identifier for React Flow
  category: 'action',          // The sidebar tab it belongs in ('logic', 'ai', 'decision', 'action')
  label: 'My New Node',        // The text displayed on the draggable card
  icon: Sparkles,              // An icon component (usually from lucide-react)
  color: 'var(--accent-purple)',// (Optional) The primary accent color for the node
  // (Optional) Define a custom settings form for the Settings Panel
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => (
    <div className="field">
      <label>My Custom Setting</label>
      <input 
        value={formData.mySetting || ''}
        onChange={(e) => handleChange('mySetting', e.target.value)}
        placeholder="Enter a value"
      />
      <p style={{ fontSize: '0.6rem' }}>Connected nodes: {edges.filter(e => e.target === nodeId).length}</p>
    </div>
  )
};
```

*Note: If you want the node to be hidden from the sidebar (e.g., a trigger node dragged from elsewhere), you can add `hideInSidebar: true` to the config.*

## Step 3: Define the Node Component

Your node file must export the actual React component as the **default** export. We recommend wrapping it in `memo` for performance and using the shared `BaseNode` component for consistent styling.

```javascript
import React, { memo, useState } from 'react';
import BaseNode from '../BaseNode';

// The default export MUST be the React component
export default memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

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
    >
      {/* Your custom node content goes here */}
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Status: <span style={{ color: config.color, fontWeight: 600 }}>Active</span>
        </p>
      </div>
    </BaseNode>
  );
});
```

## That's it!

Once you save the file, Vite's Hot Module Replacement (HMR) will automatically pick it up. The dynamic registry (`registry.js`) will read your exported `config` and `default` component, register the node type with React Flow, and automatically render the standard draggable card in the sidebar under your chosen category. No other files need to be edited!
