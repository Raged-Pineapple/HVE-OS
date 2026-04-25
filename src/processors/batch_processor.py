"""
batch_processor.py — Static File → Bronze → Transform → Silver Pipeline
Processes uploaded static files (CSV, JSON, Parquet, Excel, GeoJSON) through
the full pipeline using dynamic blueprints and DQ rules.
"""
import os
import sys
import io
import json
import uuid
import logging
from datetime import datetime

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

# Add gateway and src to path for imports
_gateway_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "gateway"))
_src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
for _d in [_gateway_dir, _src_dir]:
    if _d not in sys.path:
        sys.path.insert(0, _d)

from services import db_service, minio_service, iceberg_service
from services.minio_service import BRONZE_BUCKET, SILVER_BUCKET

logger = logging.getLogger(__name__)

# Supported formats
SUPPORTED_EXTENSIONS = {
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.geojson': 'application/geo+json',
    '.parquet': 'application/octet-stream',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.tsv': 'text/tab-separated-values',
}


def detect_format(filename: str) -> str:
    """Detect file format from extension."""
    ext = os.path.splitext(filename)[1].lower()
    if ext in SUPPORTED_EXTENSIONS:
        return ext
    raise ValueError(f"Unsupported file format: {ext}. Supported: {list(SUPPORTED_EXTENSIONS.keys())}")


def read_file_to_dataframe(file_data: bytes, filename: str) -> pd.DataFrame:
    """Read raw file bytes into a pandas DataFrame based on format."""
    ext = detect_format(filename)
    buffer = io.BytesIO(file_data)

    if ext == '.csv':
        return pd.read_csv(buffer)
    elif ext == '.tsv':
        return pd.read_csv(buffer, sep='\t')
    elif ext == '.json':
        return pd.read_json(buffer)
    elif ext == '.geojson':
        data = json.loads(file_data.decode('utf-8'))
        # Flatten GeoJSON features
        if 'features' in data:
            rows = []
            for feature in data['features']:
                row = feature.get('properties', {}).copy()
                geom = feature.get('geometry', {})
                row['geometry_type'] = geom.get('type', '')
                coords = geom.get('coordinates', [])
                row['coordinates'] = json.dumps(coords)
                rows.append(row)
            return pd.DataFrame(rows)
        return pd.json_normalize(data)
    elif ext == '.parquet':
        return pd.read_parquet(buffer)
    elif ext in ('.xlsx', '.xls'):
        return pd.read_excel(buffer)
    else:
        raise ValueError(f"Cannot read format: {ext}")


def auto_generate_blueprints_from_df(source_id: str, df: pd.DataFrame) -> list:
    """
    Auto-generate 1:1 identity mapping blueprints from DataFrame columns.
    Saves them to the Control Plane and returns the blueprint list.
    """
    blueprints = []
    for col in df.columns:
        dtype = df[col].dtype
        if pd.api.types.is_integer_dtype(dtype):
            data_type = "INT"
        elif pd.api.types.is_float_dtype(dtype):
            data_type = "FLOAT"
        elif pd.api.types.is_bool_dtype(dtype):
            data_type = "BOOLEAN"
        else:
            data_type = "STRING"

        bp = {
            "target_field": col,
            "jmes_path": col,
            "data_type": data_type,
            "is_primary_key": False,
            "is_required": False,
        }
        blueprints.append(bp)

    # Save to Control Plane
    try:
        db_service.upsert_blueprints(source_id, blueprints)
        logger.info(f"[{source_id}] Auto-generated {len(blueprints)} blueprints from schema")
    except Exception as e:
        logger.warning(f"[{source_id}] Could not save auto-blueprints: {e}")

    return blueprints


def apply_dq_rules(df: pd.DataFrame, dq_rules: list) -> tuple:
    """
    Apply DQ rules to a DataFrame.
    Returns (clean_df, quarantined_df_with_reasons).
    """
    if not dq_rules:
        return df, pd.DataFrame()

    mask_pass = pd.Series(True, index=df.index)
    failure_reasons = pd.Series("", index=df.index)

    for rule in dq_rules:
        rule_logic = rule["rule_logic"]
        rule_name = rule.get("rule_name", f"rule_{rule.get('rule_id', '?')}")
        action = rule.get("action_on_fail", "QUARANTINE")

        if action == "DROP" or action == "QUARANTINE":
            try:
                # Evaluate rule against each row
                # Replace column references with df[col] access
                rule_mask = df.apply(
                    lambda row: _eval_rule_for_row(row, rule_logic), axis=1
                )
                failed_mask = ~rule_mask
                if failed_mask.any():
                    failure_reasons[failed_mask] += f"{rule_name}: {rule_logic}; "
                    mask_pass = mask_pass & rule_mask
            except Exception as e:
                logger.warning(f"[DQ] Rule '{rule_name}' evaluation error: {e}")

    clean_df = df[mask_pass].copy()
    quarantined_df = df[~mask_pass].copy()
    if not quarantined_df.empty:
        quarantined_df["_dq_failure_reason"] = failure_reasons[~mask_pass]

    return clean_df, quarantined_df


def _eval_rule_for_row(row: pd.Series, rule_logic: str) -> bool:
    """Evaluate a DQ rule expression against a single DataFrame row."""
    try:
        safe_globals = {"__builtins__": {"None": None, "True": True, "False": False, "abs": abs, "len": len}}
        row_dict = row.to_dict()
        # Handle NaN → None
        for k, v in row_dict.items():
            if pd.isna(v):
                row_dict[k] = None
        return bool(eval(rule_logic, safe_globals, row_dict))
    except Exception:
        return True  # Conservative: pass on evaluation failure


def process_static_file(source_id: str, filename: str, file_data: bytes) -> dict:
    """
    Full pipeline for a static file:
    1. Write raw file to Bronze
    2. Read into DataFrame
    3. Fetch/generate blueprints
    4. Apply DQ rules
    5. Write clean data to Silver (Parquet)
    6. Write quarantined data to DLQ
    7. Update registries
    """
    batch_id = str(uuid.uuid4())[:12]
    log_id = None

    try:
        # Register source if not exists
        try:
            db_service.register_source(
                source_id=source_id,
                source_type="STATIC_FILE",
                protocol="FILE",
                description=f"Static file upload: {filename}"
            )
        except Exception:
            pass

        log_id = db_service.log_processing_start(source_id, "BATCH", f"bronze/batch/{source_id}/{filename}")

        # ── Stage 2: Write to Bronze ──
        content_type = SUPPORTED_EXTENSIONS.get(os.path.splitext(filename)[1].lower(), "application/octet-stream")
        bronze_path = minio_service.write_bronze_file(source_id, filename, file_data, content_type)
        logger.info(f"[{source_id}] Bronze: {filename} ({len(file_data)} bytes)")

        # ── Read into DataFrame ──
        df = read_file_to_dataframe(file_data, filename)
        records_in = len(df)
        logger.info(f"[{source_id}] Parsed {records_in} rows, {len(df.columns)} columns from {filename}")

        # ── Stage 3: Fetch blueprints ──
        blueprints = db_service.get_blueprints(source_id)
        if not blueprints:
            blueprints = auto_generate_blueprints_from_df(source_id, df)
            logger.info(f"[{source_id}] Auto-generated blueprints from file schema")

        # Apply column mapping (rename if blueprints specify different target fields)
        if blueprints:
            existing_cols = set(df.columns)
            rename_map = {}
            for bp in blueprints:
                # Use jmes_path instead of json_path
                src_col = bp.get("jmes_path") or bp.get("json_path", "").replace("$.", "").strip()
                if src_col in existing_cols and src_col != bp["target_field"]:
                    rename_map[src_col] = bp["target_field"]
            if rename_map:
                df = df.rename(columns=rename_map)

        # ── Stage 4: DQ Gatekeeper ──
        dq_rules = db_service.get_dq_rules(source_id)
        clean_df, quarantined_df = apply_dq_rules(df, dq_rules)

        records_passed = len(clean_df)
        records_quarantined = len(quarantined_df)

        # ── Stage 5: Write to Silver ──
        silver_path = None
        file_size = 0
        if not clean_df.empty:
            # Convert to list of dicts for Iceberg, handling NaNs
            clean_records = clean_df.where(pd.notnull(clean_df), None).to_dict(orient='records')
            
            metrics = iceberg_service.append_records(source_id, clean_records, batch_id)
            snapshot_id = metrics.get('snapshot_id')
            silver_path = f"s3a://hve-iceberg/{source_id} (Snapshot {snapshot_id})"

            # Register Silver table
            schema_json = {col: str(clean_df[col].dtype) for col in clean_df.columns}
            db_service.register_silver_table(
                table_name=source_id,
                source_id=source_id,
                minio_path=f"hve-iceberg/{source_id}/",
                row_count=records_passed,
                file_count=1,
                total_size=file_size,
                schema_json=schema_json
            )

        # Write quarantined rows to DLQ
        if not quarantined_df.empty:
            quarantine_records = quarantined_df.to_dict(orient='records')
            minio_service.write_dlq(source_id, quarantine_records, batch_id)

        # Log completion
        if log_id:
            db_service.log_processing_complete(
                log_id=log_id,
                silver_path=silver_path or "",
                records_in=records_in,
                records_passed=records_passed,
                records_quarantined=records_quarantined
            )

        result = {
            "source_id": source_id,
            "filename": filename,
            "batch_id": batch_id,
            "bronze_path": f"{BRONZE_BUCKET}/{bronze_path}",
            "silver_path": f"{SILVER_BUCKET}/{silver_path}" if silver_path else None,
            "records_in": records_in,
            "records_passed": records_passed,
            "records_quarantined": records_quarantined,
            "columns": list(clean_df.columns) if not clean_df.empty else [],
            "status": "COMPLETED"
        }
        logger.info(f"[{source_id}] Batch complete: {records_in} in → {records_passed} clean, {records_quarantined} quarantined")
        return result

    except Exception as e:
        logger.error(f"[{source_id}] Static file processing failed: {e}")
        if log_id:
            try:
                db_service.log_processing_complete(
                    log_id=log_id, silver_path="", records_in=0,
                    records_passed=0, records_quarantined=0,
                    status="FAILED", error_message=str(e)
                )
            except Exception:
                pass
        raise
