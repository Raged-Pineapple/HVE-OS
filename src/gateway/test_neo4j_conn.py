import os
import sys
import logging

# Add gateway and src to path for imports
_gateway_dir = os.path.abspath(os.path.join(r"d:\Projects\HVE-OS", "src", "gateway"))
_src_dir = os.path.abspath(os.path.join(r"d:\Projects\HVE-OS", "src"))
for _d in [_gateway_dir, _src_dir]:
    if _d not in sys.path:
        sys.path.insert(0, _d)

from services import neo4j_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("neo4j_test")

def test_neo4j():
    try:
        service = neo4j_service.get_neo4j_service()
        if service._driver:
            logger.info("SUCCESS: Neo4j driver connected.")
            res = service.execute_query("RETURN 1 AS val")
            logger.info(f"Query Result: {res[0]['val']}")
        else:
            logger.error("FAILURE: Neo4j driver not initialized.")
    except Exception as e:
        logger.error(f"FAILURE: Generic error: {e}")

if __name__ == "__main__":
    test_neo4j()
