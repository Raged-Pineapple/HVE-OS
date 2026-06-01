import asyncio
import websockets
import json
import dictdiffer

async def monitor():
    uri = "ws://localhost:8000/api/v1/ws/graph"
    async with websockets.connect(uri) as websocket:
        print("Connected to Graph WebSocket.")
        last_nodes = None
        
        while True:
            try:
                message = await websocket.recv()
                data = json.loads(message)
                msg_type = data.get("type")
                
                if msg_type == "graph_registered":
                    print(f"Graph registered: {data.get('message')}")
                elif msg_type == "node_output":
                    node_id = data.get("nodeId")
                    success = data.get("success")
                    keys = list(data.get("outputs", {}).keys())
                    print(f"Node Output: ID={node_id}, Success={success}, OutputKeys={keys[:5]}...")
                elif msg_type == "connected":
                    print(f"Status: {data.get('message')}")
                
                # Check what the engine currently has
                # Since the frontend sends 'graph_update' to the backend, we can't directly intercept
                # the client's outgoing message to the server, but we can query uvicorn logs or print state.
            except Exception as e:
                print(f"Error: {e}")
                break

if __name__ == "__main__":
    asyncio.run(monitor())
