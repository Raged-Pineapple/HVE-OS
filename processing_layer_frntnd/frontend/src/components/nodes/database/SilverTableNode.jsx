import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Database, Play, AlertCircle, TableProperties, Maximize2, X, Download } from 'lucide-react';
import { HotTable } from '@handsontable/react-wrapper';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/dist/handsontable.full.css';
import { runQuery } from '../../../api/client.js';
import BaseNode from '../BaseNode';

// Register all Handsontable plugins and modules
registerAllModules();

// ── Full-Screen Excel Editor Modal ─────────────────────────
const TableEditorModal = ({ tableName, rows, columns, onClose }) => {
  const hotRef = useRef(null);

  // Convert rows (array of objects) → 2D array Handsontable expects
  const data = (rows || []).map(row => (columns || []).map(col => {
    const v = row[col];
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? '');
  }));

  if (!rows || rows.length === 0) return null;

  const exportCSV = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (hot) {
      const plugin = hot.getPlugin('exportFile');
      plugin.downloadFile('csv', {
        bom: false,
        columnDelimiter: ',',
        columnHeaders: true,
        exportHiddenColumns: true,
        exportHiddenRows: true,
        fileExtension: 'csv',
        filename: `${tableName}_export`,
        mimeType: 'text/csv',
        rowDelimiter: '\r\n',
        rowHeaders: false,
      });
    }
  }, [tableName]);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        background: '#1a1a1a',
      }}
      // Stop clicks from bubbling to the canvas
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Title Bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 18px',
        background: '#111',
        borderBottom: '1px solid #333',
        flexShrink: 0,
        userSelect: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Database size={16} color="#fb923c" />
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f1f5f9' }}>{tableName}</span>
          <span style={{
            fontSize: '0.62rem', color: '#94a3b8',
            background: '#1e293b', borderRadius: 4, padding: '2px 8px',
            border: '1px solid #334155',
          }}>
            {rows.length} rows · {columns.length} cols
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={exportCSV}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
              background: '#fb923c', color: 'white',
              border: 'none', fontSize: '0.72rem', fontWeight: 600,
            }}
          >
            <Download size={13} />
            Export CSV
          </button>
          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
              background: '#1e293b', color: '#94a3b8',
              border: '1px solid #334155', fontSize: '0.72rem',
            }}
          >
            <X size={13} />
            Close
          </button>
        </div>
      </div>

      {/* Handsontable Container */}
      <div style={{ flex: 1, position: 'relative', background: '#fff' }}>
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <HotTable
            ref={hotRef}
            data={data}
            colHeaders={columns}
            rowHeaders={true}
            licenseKey="non-commercial-and-evaluation"
            // Excel-like features
            contextMenu={true}
            manualColumnResize={true}
            manualRowResize={true}
            columnSorting={true}
            filters={true}
            dropdownMenu={true}
            multiColumnSorting={true}
            copyPaste={true}
            outsideClickDeselects={false}
            selectionMode="multiple"
            fillHandle={true}
            undo={true}
            search={true}
            fixedRowsTop={1}
            autoWrapRow={true}
            autoWrapCol={true}
            stretchH="all"
            mergeCells={true}
            comments={true}
            customBorders={true}
            navigableHeaders={true}
          />
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Node Config ─────────────────────────────────────────────
export const config = {
  type: 'silverTable',
  category: 'database',
  label: 'Silver Table',
  icon: Database,
  color: 'var(--accent-orange)',
  hideInSidebar: true,
  SettingsForm: ({ nodeId, formData }) => {
    const tableName = formData.tableName || formData.id;
    const [sql, setSql] = useState(`SELECT * FROM ${tableName} LIMIT 500`);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [showEditor, setShowEditor] = useState(false);

    const handleRunQuery = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await runQuery(sql);
        setResult(res);
      } catch (err) {
        setError(err.response?.data?.detail || err.message);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      handleRunQuery();
    }, [tableName]);

    return (
      <>
        {/* Handsontable full-screen modal */}
        {showEditor && result?.rows?.length > 0 && (
          <TableEditorModal
            tableName={tableName}
            rows={result.rows}
            columns={result.columns}
            onClose={() => setShowEditor(false)}
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* SQL editor */}
          <div className="field">
            <label>SQL Query</label>
            <textarea
              style={{
                minHeight: '80px', fontFamily: 'JetBrains Mono', fontSize: '0.7rem',
                background: 'rgba(0,0,0,0.2)', color: 'var(--cyan)',
              }}
              value={sql}
              onChange={e => setSql(e.target.value)}
              onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') handleRunQuery(); }}
            />
            <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>Ctrl+Enter to run</span>
          </div>

          {/* Run Button */}
          <button
            onClick={handleRunQuery}
            disabled={loading}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '10px',
              background: loading ? 'rgba(251,146,60,0.4)' : 'var(--accent-orange)',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '0.05em',
              transition: 'opacity 0.2s',
              opacity: loading ? 0.7 : 1,
            }}
          >
            <Play size={14} />
            {loading ? 'Running Query...' : 'Run Query'}
          </button>

          {/* Error */}
          {error && (
            <div style={{
              padding: 8, background: 'rgba(239,68,68,0.1)',
              border: '1px solid var(--accent-red)', borderRadius: 6,
              display: 'flex', gap: 6,
            }}>
              <AlertCircle size={14} color="var(--accent-red)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: '0.65rem', color: 'var(--accent-red)' }}>{error}</span>
            </div>
          )}

          {/* Results */}
          {result && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                  Result Data
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>
                    {result.row_count} rows · {result.execution_time_ms.toFixed(0)}ms
                  </span>
                  {result.rows?.length > 0 && (
                    <button
                      onClick={() => setShowEditor(true)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                        background: 'rgba(251,146,60,0.15)', color: 'var(--accent-orange)',
                        border: '1px solid rgba(251,146,60,0.4)', fontSize: '0.6rem', fontWeight: 600,
                      }}
                    >
                      <Maximize2 size={10} />
                      Open in Excel
                    </button>
                  )}
                </div>
              </div>

              {/* Compact 5-row preview */}
              <div style={{
                maxHeight: '140px', overflow: 'auto',
                background: 'rgba(0,0,0,0.15)', borderRadius: 6,
                border: '1px solid var(--border-subtle)',
              }}>
                {result.rows?.length > 0 ? (
                  <table style={{ width: '100%', fontSize: '0.62rem', borderCollapse: 'collapse' }}>
                    <thead style={{ background: 'rgba(255,255,255,0.05)', position: 'sticky', top: 0 }}>
                      <tr>
                        {result.columns.map(key => (
                          <th key={key} style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid var(--border-subtle)', color: 'var(--cyan)', whiteSpace: 'nowrap' }}>
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, 5).map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                          {result.columns.map((col, j) => (
                            <td key={j} style={{ padding: '3px 8px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ padding: 12, fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>No rows returned.</p>
                )}
              </div>

              {result.rows?.length > 5 && (
                <p style={{ margin: '6px 0 0', fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Showing 5 of {result.row_count} · {' '}
                  <span
                    style={{ color: 'var(--accent-orange)', cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => setShowEditor(true)}
                  >
                    Open full table in Excel view
                  </span>
                </p>
              )}
            </div>
          )}
        </div>
      </>
    );
  }
};

// ── Canvas Node ─────────────────────────────────────────────
export default memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <BaseNode
      label={data.tableName || data.id || config.label}
      icon={config.icon}
      type={config.type}
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color={config.color}
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TableProperties size={12} color="var(--accent-orange)" />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>Silver Table</p>
        </div>
      </div>
    </BaseNode>
  );
});
