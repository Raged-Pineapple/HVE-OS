# HVE-OS Node Design Principles & Specifications

This document outlines the core architectural methodologies and dataflow paradigms used to build the HVE-OS Graph Engine. It is heavily inspired by enterprise visual programming platforms like Palantir Gotham (Pipeline Builder / Contour) and Alteryx.

When creating new Nodes (both in the Python backend and React frontend), adhere strictly to these principles and specifications to prevent regressions.

---

## Part 1: Core Architectural Principles

### 1. Total Decoupling (Duck Typing over Hardcoding)
Nodes must **never** know the identity of their upstream or downstream neighbors. 
* **Do not** write logic like `if upstream_node.type == 'extractEntities':`.
* **Do** inspect the shape of the data on the wire: `if isinstance(input_data, list):` or `if isinstance(input_data, dict):`.
* **Why?** This ensures that if you build a `SQLQueryNode` tomorrow, a `CombineNode` or `MathNode` will seamlessly accept its data without requiring a single line of backend code modification.

### 2. Explicit Data Lineage and Targeting
Transformation nodes must not blindly mutate payloads by guessing what to change.
* **Explicit Targeting:** Operations require an explicitly configured list of target attributes (e.g., `targetFields: ['altitude', 'velocity']`).
* **Pass-Through Lineage:** A node receives an entire Entity, mutates only the targeted attributes, and passes the **fully intact, updated Entity** out of its `data` handle. This preserves the schema for the rest of the pipeline.

### 3. Smart Bulk & Scalar Fallbacks
Every processing node must natively support both single items and bulk arrays.
* **Bulk Mode:** If the `input_data` is a `list` of dictionaries, the node automatically iterates through the array, applies its internal logic to each item, and outputs the updated `list`.
* **Scalar Mode:** If the `input_data` is a single dictionary or raw number, the node applies the logic to that single item and outputs it directly.

### 4. UI vs. Graph Engine Separation
* **No API Calls in UI Previews:** React Node components should never make network calls to fetch data. They must dynamically resolve their schema by reading the data attached to the `edges` coming into their input handles.
* **Single Source of Truth:** Data strictly flows from Left to Right through the wires.

### 5. Handle Naming Synchronization
If you generate dynamic wire handles (e.g., outputting a single entity from a list), the **React Frontend** and **Python Backend** must use the exact same fallback logic to generate the ID string.
**The Standard Identifier Fallback Chain:**
1. `_hve_id` (Primary System ID)
2. `hve_id` (Legacy System ID)
3. `id` (Generic ID)
4. `idx_{index}` (Array Index Fallback)
*Example:* `entity-out-hve_1234::Boeing747`

### 6. The `previewInput` Paradigm (UI Caching)
When users edit the graph, they are in isolated "Preview" mode.
* The React component uses a `useEffect` to grab the first available entity from its incoming edges and saves it as `previewInput`.
* If the Python backend receives empty `inputs` (because it's a UI preview run), it falls back to `config.get("previewInput")` to safely generate the `resolvedEntity` UI envelope.

---

## Part 2: Detailed Node Specification (Anti-Regression Guide)

To create a new node without breaking the generic dataflow, follow these exact specifications.

### A. Python Backend Specification

1. **Location:** `src/Logic/nodes/<category>/<node_name>.py`
2. **Class Definition:** Must inherit from `BaseNode` and use `@register_node`.
3. **Metadata Definition:**
   ```python
   metadata = NodeMetadata(
       type="myNewNode",       # MUST match the React config.type exactly
       category="logic",       # e.g., "logic", "input", "output"
       label="My New Node",
       color="#10B981",
       input_handles=["data", "default", "target"], # ALWAYS accept these 3 fallbacks
       output_handles=["data"],                     # ALWAYS output primary payload to "data"
       description="Does something cool."
   )
   ```
4. **Input Resolution (The "Golden" Boilerplate):**
   ```python
   def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
       input_val = inputs.get("data")
       if input_val is None: input_val = inputs.get("default")
       if input_val is None: input_val = inputs.get("target")
       
       # Handle isolated UI preview runs
       if input_val is None and not inputs:
           input_val = config.get("previewInput")
       elif input_val is None and inputs:
           input_val = list(inputs.values())[0] # Aggressive fallback to whatever wire is connected
   ```
5. **Data Processing (Bulk/Scalar):**
   ```python
       def _process(item: Any) -> Any:
           # Do your mutation here
           return item

       if isinstance(input_val, list):
           result_payload = [_process(item) for item in input_val]
       elif isinstance(input_val, dict):
           result_payload = _process(input_val)
       else:
           result_payload = _process(input_val)
   ```
6. **Output Formatting:**
   ```python
       preview_payload = result_payload if isinstance(result_payload, (dict, list)) else {"result": result_payload}
       
       return NodeResult(
           success=True,
           outputs={
               "data": result_payload,             # MUST be "data" for downstream
               "resolvedEntity": preview_payload   # MUST exist for UI properties panel
           },
           metadata={"config_used": config}
       )
   ```

### B. React Frontend Specification

1. **Location:** `processing_layer_frntnd/frontend/src/components/nodes/<category>/<NodeName>.jsx`
2. **Upstream Data Resolver (Do NOT modify this function):**
   Use this exact function to generically read data from upstream wires without hardcoding `node.type`:
   ```javascript
   const resolveUpstreamData = (incomingNodes) => {
     for (const n of incomingNodes) {
       if (!n.data) continue;
       const candidates = [n.data.data, n.data.extracted, n.data.resolvedEntity, n.data.pinned, n.data.unpinned];
       for (const c of candidates) {
         if (Array.isArray(c) && c.length > 0) return c;
       }
       for (const c of candidates) {
         if (c && typeof c === 'object' && !Array.isArray(c)) return [c];
       }
     }
     return [];
   };
   ```
3. **The `previewInput` Sync Hook:**
   Include this `useEffect` inside your main node component so the Python backend knows the schema during UI edits:
   ```javascript
   const prevInputRef = React.useRef(undefined);
   React.useEffect(() => {
     const incomingEdges = edges.filter(e => e.target === id);
     const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
     
     const dataList = resolveUpstreamData(incomingNodes);
     const sampleEntity = dataList.length > 0 ? dataList[0] : null;

     if (sampleEntity) {
       const serialised = JSON.stringify(sampleEntity);
       if (prevInputRef.current !== serialised) {
         prevInputRef.current = serialised;
         setNodes(nds => nds.map(n => 
           n.id === id ? { ...n, data: { ...n.data, previewInput: sampleEntity } } : n
         ));
       }
     }
   }, [edges, id, nodes, setNodes]);
   ```
4. **Handle Rules:**
   - **Target Handle (Input):** Always use `id="data"` (or omit `id` so it becomes "default").
   - **Source Handle (Output):** Always use `id="data"`.
   - Never place multiple Source Handles with the exact same ID.