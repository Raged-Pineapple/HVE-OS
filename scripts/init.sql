-- scripts/init.sql
-- HVE-OS Phase 1: Control Plane Schema
-- This file is auto-run by PostgreSQL on first boot via docker-entrypoint-initdb.d

-- ============================================================
-- 1. Source Registry: Tracks all data origins & connections
-- ============================================================
CREATE TABLE IF NOT EXISTS source_registry (
    source_id VARCHAR(255) PRIMARY KEY,
    source_type VARCHAR(50) NOT NULL DEFAULT 'STREAM',  -- STREAM, API_POLL, STATIC_FILE
    protocol VARCHAR(50) NOT NULL,                       -- HTTP, MQTT, FILE, KAFKA
    status VARCHAR(50) DEFAULT 'ACTIVE',                 -- ACTIVE, PAUSED, ERROR
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 2. API Source Configs: Polling instructions for external APIs
-- ============================================================
CREATE TABLE IF NOT EXISTS api_source_configs (
    source_id VARCHAR(255) PRIMARY KEY REFERENCES source_registry(source_id) ON DELETE CASCADE,
    api_url TEXT NOT NULL,
    method VARCHAR(10) DEFAULT 'GET',
    headers JSONB DEFAULT '{}',
    body_template JSONB,
    poll_interval_seconds INT DEFAULT 60,
    auth_type VARCHAR(50) DEFAULT 'NONE',       -- NONE, API_KEY, BEARER, BASIC
    auth_credentials JSONB DEFAULT '{}',
    is_polling BOOLEAN DEFAULT FALSE,
    last_polled_at TIMESTAMP,
    last_status VARCHAR(50),
    last_error TEXT
);

-- ============================================================
-- 3. Mapping Blueprints: JSON paths for dynamic extraction
-- ============================================================
CREATE TABLE IF NOT EXISTS mapping_blueprints (
    blueprint_id SERIAL PRIMARY KEY,
    source_id VARCHAR(255) NOT NULL,
    target_field VARCHAR(255) NOT NULL,
    jmes_path VARCHAR(500) NOT NULL,
    data_type VARCHAR(50) NOT NULL,             -- STRING, INT, FLOAT, BOOLEAN, TIMESTAMP
    is_primary_key BOOLEAN DEFAULT FALSE,
    is_required BOOLEAN DEFAULT TRUE,
    default_value TEXT,
    should_explode BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_blueprint_source
        FOREIGN KEY(source_id) 
        REFERENCES source_registry(source_id)
        ON DELETE CASCADE
);

-- ============================================================
-- 4. Data Quality Rules: Business logic for the Gatekeeper
-- ============================================================
CREATE TABLE IF NOT EXISTS dq_rules (
    rule_id SERIAL PRIMARY KEY,
    source_id VARCHAR(255) NOT NULL,
    rule_name VARCHAR(255),
    rule_logic TEXT NOT NULL,                    -- e.g. "altitude >= 0", "icao24 IS NOT NULL"
    action_on_fail VARCHAR(50) NOT NULL DEFAULT 'QUARANTINE',  -- QUARANTINE, DROP, FLAG
    severity VARCHAR(50) DEFAULT 'ERROR',       -- ERROR, WARNING, INFO
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_dq_source
        FOREIGN KEY(source_id) 
        REFERENCES source_registry(source_id)
        ON DELETE CASCADE
);

-- ============================================================
-- 5. Silver Registry: Tracks materialized Silver tables
-- ============================================================
CREATE TABLE IF NOT EXISTS silver_registry (
    table_name VARCHAR(255) PRIMARY KEY,
    source_id VARCHAR(255) REFERENCES source_registry(source_id) ON DELETE SET NULL,
    minio_path TEXT NOT NULL,
    row_count BIGINT DEFAULT 0,
    file_count INT DEFAULT 0,
    total_size_bytes BIGINT DEFAULT 0,
    schema_json JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 6. DQ Quarantine Log: Records of failed quality checks
-- ============================================================
CREATE TABLE IF NOT EXISTS dq_quarantine_log (
    quarantine_id SERIAL PRIMARY KEY,
    source_id VARCHAR(255),
    rule_id INT REFERENCES dq_rules(rule_id) ON DELETE SET NULL,
    rule_name VARCHAR(255),
    failed_record JSONB,
    failure_reason TEXT,
    quarantined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 7. Processing Log: Tracks pipeline execution history
-- ============================================================
CREATE TABLE IF NOT EXISTS processing_log (
    log_id SERIAL PRIMARY KEY,
    source_id VARCHAR(255),
    processor_type VARCHAR(50) NOT NULL,         -- STREAM, BATCH, API_POLL
    bronze_path TEXT,
    silver_path TEXT,
    records_in INT DEFAULT 0,
    records_passed INT DEFAULT 0,
    records_quarantined INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'RUNNING',        -- RUNNING, COMPLETED, FAILED
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- ============================================================
-- Seed data for testing
-- ============================================================
INSERT INTO source_registry (source_id, source_type, protocol, status, description) 
VALUES ('opensky_data', 'API_POLL', 'HTTP', 'ACTIVE', 'OpenSky Network live flight data')
ON CONFLICT DO NOTHING;

INSERT INTO mapping_blueprints (source_id, target_field, jmes_path, data_type, is_primary_key) 
VALUES 
('opensky_data', 'icao24', 'states[*][0]', 'STRING', TRUE),
('opensky_data', 'callsign', 'states[*][1]', 'STRING', FALSE),
('opensky_data', 'origin_country', 'states[*][2]', 'STRING', FALSE),
('opensky_data', 'longitude', 'states[*][5]', 'FLOAT', FALSE),
('opensky_data', 'latitude', 'states[*][6]', 'FLOAT', FALSE),
('opensky_data', 'altitude', 'states[*][7]', 'FLOAT', FALSE),
('opensky_data', 'velocity', 'states[*][9]', 'FLOAT', FALSE),
('opensky_data', 'on_ground', 'states[*][8]', 'BOOLEAN', FALSE)
ON CONFLICT DO NOTHING;

INSERT INTO dq_rules (source_id, rule_name, rule_logic, action_on_fail, severity) 
VALUES 
('opensky_data', 'altitude_non_negative', 'altitude >= 0 or altitude is None', 'QUARANTINE', 'ERROR'),
('opensky_data', 'icao24_not_null', 'icao24 is not None', 'QUARANTINE', 'ERROR')
ON CONFLICT DO NOTHING;
