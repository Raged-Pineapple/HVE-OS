"""
events.py — Reactive Graph Engine
A true event-driven, independent-pathway execution engine.
"""
import logging
import hashlib
import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Set

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["Stream"])

# WebSocket clients
clients: Set[WebSocket] = set()
clients_lock = asyncio.Lock()


def _dump_json(message: dict) -> str:
    """Helper to safely JSON dump massive objects off the main thread."""
    return json.dumps(message, default=str)

def _hash_outputs(outputs: dict) -> str:
    """Hashes massive outputs safely off the main thread."""
    output_str = json.dumps(outputs, sort_keys=True, default=str)
    return hashlib.md5(output_str.encode()).hexdigest()

async def broadcast(message: dict):
    """Broadcast message to all connected WebSocket clients."""
    msg_str = await asyncio.to_thread(_dump_json, message)
    async with clients_lock:
        to_remove = set()
        for client in list(clients):
            try:
                await client.send_text(msg_str)
            except Exception as e:
                logger.debug(f"Broadcast failed to client: {e}")
                to_remove.add(client)
        
        # Cleanup disconnected clients
        for client in to_remove:
            clients.discard(client)




class ReactiveGraphEngine:
    def __init__(self):
        self.nodes = {}
        self.edges = []
        self.outputs = {}
        self.output_hashes = {}
        self.dirty_flags = {}
        self.running = {}

    def update_graph(self, new_nodes, new_edges):
        """Diffs the incoming UI graph against the active state and ONLY triggers changed nodes."""
        old_nodes = self.nodes
        old_edges_set = {(e.get('source'), e.get('target'), e.get('sourceHandle', 'data'), e.get('targetHandle', 'data')) for e in self.edges}
        
        self.nodes = {n['id']: n for n in new_nodes}
        self.edges = new_edges
        
        new_edges_set = {(e.get('source'), e.get('target'), e.get('sourceHandle', 'data'), e.get('targetHandle', 'data')) for e in self.edges}

        for n_id, n_data in self.nodes.items():
            is_new = n_id not in old_nodes
            config_changed = not is_new and old_nodes[n_id].get('data') != n_data.get('data')
            
            incoming_old = {e for e in old_edges_set if e[1] == n_id}
            incoming_new = {e for e in new_edges_set if e[1] == n_id}
            edges_changed = incoming_old != incoming_new
            
            if is_new or config_changed or edges_changed:
                self.trigger_node(n_id)

    def trigger_source(self, source_id):
        """Neo4j event hook: Directly target nodes bound to this specific data source."""
        for n_id, node in self.nodes.items():
            if node.get('data', {}).get('source_id') == source_id:
                self.trigger_node(n_id)

    def trigger_node(self, node_id):
        """Marks a node as dirty. If it's not already running, spawns its independent thread."""
        if node_id not in self.nodes:
            return
        self.dirty_flags[node_id] = True
        if not self.running.get(node_id, False):
            asyncio.create_task(self._run_node_task(node_id))

    async def _run_node_task(self, node_id):
        """The independent Debounce Loop. A node processes itself until it is no longer dirty."""
        from Logic.nodes.registry import execute_node
        self.running[node_id] = True
        try:
            while self.dirty_flags.get(node_id, False):
                self.dirty_flags[node_id] = False
                
                if node_id not in self.nodes:
                    break  # Node was deleted from canvas mid-run
                    
                node = self.nodes[node_id]
                inputs = {}
                
                # 1. Gather freshest inputs from upstream bounds
                incoming_edges = [e for e in self.edges if e.get('target') == node_id]
                for edge in incoming_edges:
                    src_id = edge.get('source')
                    src_handle = edge.get('sourceHandle', 'data')
                    tgt_handle = edge.get('targetHandle', 'data')
                    
                    src_outputs = self.outputs.get(src_id, {})
                    if src_handle in src_outputs:
                        inputs[tgt_handle] = src_outputs[src_handle]
                    elif 'data' in src_outputs:
                        inputs[tgt_handle] = src_outputs['data']
                        
                try:
                    # 2. Execute Python logic off the main thread
                    result = await asyncio.to_thread(execute_node, node.get('type'), inputs, node.get('data', {}))
                    
                    if result and result.success and result.outputs:
                        output_hash = await asyncio.to_thread(_hash_outputs, result.outputs)
                        
                        if self.output_hashes.get(node_id) != output_hash:
                            self.output_hashes[node_id] = output_hash
                            self.outputs[node_id] = result.outputs
                            
                            await broadcast({
                                'type': 'node_output', 'nodeId': node_id,
                                'sourceId': node.get('data', {}).get('source_id'),
                                'outputs': result.outputs, 'success': result.success
                            })
                            
                            # 3. CASCADE: Exclusively trigger downstream nodes!
                            downstream = {e.get('target') for e in self.edges if e.get('source') == node_id}
                            for target_id in downstream:
                                self.trigger_node(target_id)
                                
                except Exception as e:
                    logger.error(f"Node execution failed: {node_id} - {e}", exc_info=True)
                    await broadcast({
                        'type': 'node_output', 'nodeId': node_id,
                        'success': False, 'error': str(e)
                    })
        finally:
            self.running[node_id] = False


engine = ReactiveGraphEngine()

def trigger_graph_execution(is_data_update=True, source_id=None):
    """External entrypoint for Neo4j updates."""
    if is_data_update and source_id:
        engine.trigger_source(source_id)


@router.websocket("/api/v1/ws/graph") # Force absolute path to bypass FastAPI prefix bugs
@router.websocket("/ws/graph")        # Keep fallback just in case
async def graph_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for bidirectional graph execution communication.
    Frontend connects to send graph state and receive execution results.
    """
    
    logger.info(f"🔥 Incoming WebSocket connection attempt from: {websocket.client}")

    await websocket.accept()
    
    logger.info(f"✅ WebSocket connection accepted for {websocket.client}!")
    
    async with clients_lock:
        clients.add(websocket)
        
    try:
        # Welcome message
        await websocket.send_text(json.dumps({
            "type": "connected", 
            "message": "Reactive Graph WebSocket stream ready"
        }))
        
        if engine.nodes:
            await websocket.send_text(json.dumps({
                'type': 'graph_registered',
                'nodeCount': len(engine.nodes),
                'message': 'Connected to active reactive graph'
            }))
            
        while True:
            data = await websocket.receive_text()
            logger.info(f"📥 WS Data Received: {data[:150]}")
            
            try:
                message = json.loads(data)
                
                # Check for graph update payload
                if message.get("type") == "graph_update":
                    # Diff the UI update against the internal engine state directly
                    engine.update_graph(message.get("nodes", []), message.get("edges", []))
                    
                    await websocket.send_text(json.dumps({
                        'type': 'graph_registered',
                        'nodeCount': len(engine.nodes),
                        'message': 'Reactive Graph schema updated'
                    }))
                    
            except json.JSONDecodeError:
                logger.error(f"Invalid JSON received on WS: {data}")
                
    except WebSocketDisconnect:
        logger.info(f"❌ WebSocket client disconnected normally: {websocket.client}")
        async with clients_lock:
            clients.discard(websocket)
    except Exception as e:
        logger.error(f"⚠️ WebSocket error from {websocket.client}: {e}", exc_info=True)
        async with clients_lock:
            clients.discard(websocket)


@router.get("/ws/status")
async def get_ws_status():
    """Get engine and WebSocket status."""
    return {
        "active": len(engine.nodes) > 0,
        "nodeCount": len(engine.nodes),
        "engineReady": True,
        "clientCount": len(clients)
    }


def start_executor():
    logger.info("Reactive Graph Engine initialized and actively listening for events.")
