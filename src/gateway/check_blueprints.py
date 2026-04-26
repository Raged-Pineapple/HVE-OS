import sys
import os
sys.path.append(os.getcwd())
from services import db_service
import json

sources = db_service.get_all_sources()
for s in sources:
    sid = s['source_id']
    print(f"Source: {sid}")
    bps = db_service.get_blueprints(sid)
    for bp in bps:
        print(f"  {bp['target_field']}: {bp['jmes_path']} (explode={bp.get('should_explode')}, nested={bp.get('nested_explode')})")
