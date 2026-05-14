import os
import sys
import json
import logging

_src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
sys.path.insert(0, _src_dir)

from Logic.nodes.ai.relationship_mapping_node import RelationshipMappingNode

logging.basicConfig(level=logging.INFO)

node = RelationshipMappingNode()

inputs = {
    "source_entity": [
        {"_hve_id": "ent1", "_source_id": "test_src", "title": "Test Entity 1", "description": "This is related to user string"},
        {"_hve_id": "ent2", "_source_id": "test_src", "title": "Test Entity 2", "description": "Unrelated"}
    ],
    "target_entity": {"text": "user string"}
}

config = {
    "interRelationship": True,
    "relationType": "RELATES_TO",
    "minScore": 0.0,  # allow everything for test
    "geminiApiKey": os.getenv("GEMINI_API_KEY", "mock"),
    "aiProvider": "gemini",
    "parallelWorkers": 1,
}

# we need a mock neo4j
class MockNeo4j:
    def execute_query(self, query, params):
        return [{"missing_count": 2, "missing_ids": ["ent1", "ent2"]}]
    def execute_write(self, query, params):
        class Summary:
            counters = type("Counters", (), {"relationships_created": 1})()
        return Summary()

import gateway.services.neo4j_service as neo4j_service
neo4j_service.get_neo4j_service = lambda: MockNeo4j()

node.execute(inputs, config)
