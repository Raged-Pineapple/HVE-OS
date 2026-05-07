import axios from 'axios';

export const api = axios.create({
  baseURL: 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' }
});

// ── Health ─────────────────────────────────────────────
export const getHealth = () => api.get('/health').then(r => r.data);

// ── Sources ──────────────────────────────────────────
export const listSources   = () => api.get('/api/v1/sources').then(r => r.data);
export const listSourcesWithStatus = () => api.get('/api/v1/sources/with-status').then(r => r.data);
export const getSource     = (id) => api.get(`/api/v1/sources/${id}`).then(r => r.data);
export const deleteSource  = (id) => api.delete(`/api/v1/sources/${id}`);
export const purgeData     = (id) => api.delete(`/api/v1/sources/${id}/data`).then(r => r.data);

// ── Register API Source (The main ingestion wizard) ──
export const registerApiSource = (payload) =>
  api.post('/api/v1/ingest/register-api', payload).then(r => r.data);

// ── Preview API (read-only probe, no DB writes) ──────
export const previewApi = (payload) =>
  api.post('/api/v1/ingest/preview-api', payload).then(r => r.data);

// ── Pipeline Trace (Debug) ───────────────────────────
export const tracePipeline = (sourceId, data) =>
  api.post('/api/v1/debug/trace', { source_id: sourceId, data: data }).then(r => r.data);

// ── Register a bare source (pre-register for blueprints) ──
export const registerSource = (payload) =>
  api.post('/api/v1/sources/register', payload).then(r => r.data);

// ── Upload Static File ────────────────────────────────
export const uploadStaticFile = (sourceId, file, onProgress) => {
  const form = new FormData();
  form.append('source_id', sourceId);
  form.append('file', file);
  return api.post('/api/v1/ingest/upload-static', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress && onProgress(Math.round((e.loaded * 100) / e.total))
  }).then(r => r.data);
};

// ── Stream Push ───────────────────────────────────────
export const pushStream = (payload) =>
  api.post('/api/v1/ingest/stream', payload).then(r => r.data);

// ── Blueprints ───────────────────────────────────────
export const getBlueprints  = (id) => api.get(`/api/v1/sources/${id}/blueprints`).then(r => r.data);
export const setBlueprints  = (id, bp) => api.post(`/api/v1/sources/${id}/blueprints`, bp).then(r => r.data);
export const getMappingScript = (id) => api.get(`/api/v1/sources/${id}/mapping-script`).then(r => r.data);
export const saveMappingScript = (id, script) => api.put(`/api/v1/sources/${id}/mapping-script`, { mapping_script: script }).then(r => r.data);

// ── DQ Rules ─────────────────────────────────────────
export const getDQRules = (id) => api.get(`/api/v1/sources/${id}/dq-rules`).then(r => r.data);
export const addDQRule  = (id, rule) => api.post(`/api/v1/sources/${id}/dq-rules`, rule).then(r => r.data);

// ── Silver / Query ────────────────────────────────────
export const listSilverTables = () => api.get('/api/v1/silver/tables').then(r => r.data);
export const runQuery = (sql) => api.post('/api/v1/query', { sql }).then(r => r.data);

// ── Neo4j Graph ──────────────────────────────────────
export const getEntitiesByLabel = (sourceId) => api.get(`/api/v1/graph/entities/label/${sourceId}`).then(r => r.data);
export const listGraphSources = () => api.get('/api/v1/graph/sources').then(r => r.data);
export const getEntityKeys = (sourceId) => api.get(`/api/v1/graph/entities/keys/${sourceId}`).then(r => r.data);
export const discoverSecurityProviders = () => api.get('/api/v1/security/discovery').then(r => r.data);
