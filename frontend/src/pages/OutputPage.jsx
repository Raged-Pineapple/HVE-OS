import React, { useState, useEffect } from 'react';
import { listSilverTables, runQuery } from '../api/client.js';
import { useToast } from '../components/ToastProvider.jsx';

function TableGrid({ data }) {
  if (!data || data.length === 0) return <div className="empty-state"><p>No results returned</p></div>;
  const cols = Object.keys(data[0]);
  return (
    <div style={{ overflow: 'auto', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ background: 'var(--bg-elevated)' }}>
            {cols.map(c => (
              <th key={c} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border-default)', whiteSpace: 'nowrap' }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)', background: i % 2 === 0 ? 'transparent' : 'hsla(222,28%,9%,0.4)' }}>
              {cols.map(c => (
                <td key={c} style={{ padding: '9px 14px', color: 'var(--text-secondary)', fontFamily: typeof row[c] === 'number' ? 'JetBrains Mono' : 'inherit', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row[c] === null ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>null</span> : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PRESETS = [
  { label: 'Preview table (50 rows)', sql: 'SELECT * FROM {source_id} LIMIT 50' },
  { label: 'Count all records', sql: 'SELECT COUNT(*) as total FROM {source_id}' },
  { label: 'Distinct sources (DuckDB)', sql: "SELECT name FROM sqlite_master WHERE type='table'" },
];

export default function OutputPage() {
  const toast = useToast();
  const [tables, setTables] = useState([]);
  const [sql, setSql] = useState('SELECT * FROM bangalore_military LIMIT 25');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [execTime, setExecTime] = useState(null);

  const [tablesLoading, setTablesLoading] = useState(false);

  const loadTables = async () => {
    setTablesLoading(true);
    try { setTables(await listSilverTables()); } catch {}
    finally { setTablesLoading(false); }
  };

  useEffect(() => { loadTables(); }, []);

  const execute = async () => {
    if (!sql.trim()) return;
    setLoading(true); setError(null); setResult(null);
    const t0 = performance.now();
    try {
      const r = await runQuery(sql.trim());
      // QueryResponse shape: { rows: [...], row_count, columns, execution_time_ms }
      setResult(Array.isArray(r) ? r : (r.rows || r.data || []));
      setExecTime(((performance.now() - t0) / 1000).toFixed(2));
    } catch (e) {
      setError(e?.response?.data?.detail || 'Query failed');
      toast('Query failed', 'error');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ padding: '28px 32px', overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ marginBottom: 6 }}>⬆ Output</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Query your clean Silver Iceberg tables with SQL.</p>
      </div>

      <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0, flexWrap: 'wrap' }}>
        {/* Left: Tables + Query */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 2, minWidth: 320 }}>
          {/* SQL Editor */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2>SQL Query</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                {execTime && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', alignSelf: 'center' }}>{execTime}s</span>}
                <button className="btn btn-primary" onClick={execute} disabled={loading} style={{ padding: '7px 16px' }}>
                  {loading ? <span className="spinner" /> : '▶ Run'}
                </button>
              </div>
            </div>
            <textarea
              value={sql} onChange={e => setSql(e.target.value)}
              style={{ minHeight: 120, borderRadius: 8 }}
              onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') execute(); }}
            />
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>Ctrl+Enter to run</p>
          </div>

          {/* Results */}
          <div className="card" style={{ padding: 20, flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2>Results {result && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 400 }}>({result.length} rows)</span>}</h2>
            </div>
            {error && (
              <div style={{ background: 'var(--rose-dim)', border: '1px solid hsla(352,85%,50%,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem', color: 'var(--rose)', fontFamily: 'JetBrains Mono' }}>
                {error}
              </div>
            )}
            {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" /></div>}
            {!loading && !error && result && <TableGrid data={result} />}
            {!loading && !error && !result && <div className="empty-state"><p>Run a query to see results</p></div>}
          </div>
        </div>

        {/* Right: Tables + Presets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 240, flexShrink: 0 }}>
          {/* Silver tables */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3>Silver Tables</h3>
              <button onClick={loadTables} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.9rem' }} title="Refresh">{tablesLoading ? '…' : '↺'}</button>
            </div>
            {tables.length === 0 && <div className="empty-state" style={{ padding: 16, fontSize: '0.78rem' }}>No Silver tables yet</div>}
            {tables.map(t => {
              const name = typeof t === 'string' ? t : t.table_name;
              return (
                <div key={name}
                  onClick={() => setSql(`SELECT * FROM ${name} LIMIT 50`)}
                  style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'JetBrains Mono', color: 'var(--text-primary)', background: 'var(--bg-hover)', marginBottom: 6, transition: 'filter 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.95)'}
                  onMouseLeave={e => e.currentTarget.style.filter = ''}
                >
                  {name}
                </div>
              );
            })}
          </div>

          {/* Preset queries */}
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ marginBottom: 12 }}>Quick Queries</h3>
            {PRESETS.map(p => (
              <button key={p.label} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 6, fontSize: '0.78rem', padding: '7px 10px' }}
                onClick={() => setSql(p.sql)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
