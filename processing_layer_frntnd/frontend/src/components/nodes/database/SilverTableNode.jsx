import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Database, Play, AlertCircle, TableProperties, Maximize2, X, Download, Save } from 'lucide-react';
import { HotTable } from '@handsontable/react-wrapper';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/dist/handsontable.full.css';
import { useNodes, useReactFlow } from 'reactflow';
import { runQuery, saveSnapshot, executeTimeTravelQuery, getManualSnapshotData, getPresignedDownloadUrl } from '../../../api/client.js';
import BaseNode from '../BaseNode';

// Register all Handsontable plugins and modules
registerAllModules();

// ── Full-Screen Excel Editor Modal ─────────────────────────
const TableEditorModal = ({ tableName, initialSnapshotName, isUpdate, overwritePath, rows, columns, onClose, onSaveSuccess }) => {
  const hotRef = useRef(null);

  // Convert rows (array of objects) → 2D array Handsontable expects
  const data = (rows || []).map(row => (columns || []).map(col => {
    const v = row[col];
    if (v && typeof v === 'object' && v.__type__ === 'tenseal_encrypted' && typeof v.data === 'string') {
      const displayV = { ...v, data: v.data.substring(0, 40) + '... [TRUNCATED FOR UI]' };
      return JSON.stringify(displayV);
    }
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? '');
  }));

  if (!rows || rows.length === 0) return null;

  const exportCSV = useCallback(() => {
    if (!rows || rows.length === 0) return;
    
    // Generate CSV manually to ensure un-truncated encrypted data is exported properly
    const headers = columns.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
    const csvRows = rows.map(row => {
      return columns.map(col => {
        let val = row[col];
        if (typeof val === 'object' && val !== null) {
          val = JSON.stringify(val);
        } else if (val === null || val === undefined) {
          val = '';
        }
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',');
    });
    
    const csvContent = [headers, ...csvRows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${tableName}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [rows, columns, tableName]);

  const [saving, setSaving] = useState(false);
  const [snapshotNameInput, setSnapshotNameInput] = useState(initialSnapshotName || `${tableName}_snap`);

  const handleSaveSnapshot = useCallback(async () => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    
    const snapshotName = snapshotNameInput.trim();
    if (!snapshotName) {
        alert("Please enter a name for the snapshot");
        return;
    }

    setSaving(true);
    try {
      const currentData = hot.getData();
      const currentHeaders = hot.getColHeader();
      
      const records = currentData.map((rowArray, rowIdx) => {
        const obj = {};
        rowArray.forEach((val, colIdx) => {
          const colName = currentHeaders[colIdx];
          
          // Restore original encrypted data to avoid corrupting it in the snapshot
          if (typeof val === 'string' && val.includes('[TRUNCATED FOR UI]')) {
             obj[colName] = rows[rowIdx][colName];
             return;
          }

          // Try to parse back stringified objects/arrays
          if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
             try {
               obj[colName] = JSON.parse(val);
             } catch(e) {
               obj[colName] = val;
             }
          } else {
             obj[colName] = val;
          }
        });
        return obj;
      });

      await saveSnapshot(tableName, snapshotName, records, isUpdate ? overwritePath : null);
      alert(isUpdate ? `Snapshot "${snapshotName}" updated successfully!` : `Snapshot "${snapshotName}" saved successfully to MinIO!`);
      if (onSaveSuccess) onSaveSuccess();
    } catch (err) {
      alert('Error saving snapshot: ' + err.message);
    } finally {
      setSaving(false);
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input 
            type="text" 
            value={snapshotNameInput}
            onChange={(e) => setSnapshotNameInput(e.target.value)}
            placeholder="Snapshot name..."
            style={{
                padding: '4px 8px', borderRadius: 6,
                background: '#1e293b', color: '#f1f5f9',
                border: '1px solid #334155', fontSize: '0.72rem',
                outline: 'none', width: '140px'
            }}
          />
          <button
            onClick={handleSaveSnapshot}
            disabled={saving || !snapshotNameInput.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 6, cursor: (saving || !snapshotNameInput.trim()) ? 'not-allowed' : 'pointer',
              background: 'var(--cyan)', color: '#000',
              border: 'none', fontSize: '0.72rem', fontWeight: 600,
              opacity: (saving || !snapshotNameInput.trim()) ? 0.7 : 1
            }}
          >
            <Save size={13} />
            {saving ? 'Saving...' : (isUpdate ? 'Update Snapshot' : 'Save as Snapshot')}
          </button>
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

// Helper to prevent LocalStorage quota exceeded errors from massive encrypted strings
const stripEncryptedData = (rows) => {
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => {
    const cleanRow = { ...row };
    for (const key in cleanRow) {
      const val = cleanRow[key];
      if (val && typeof val === 'object' && val.__type__ === 'tenseal_encrypted' && typeof val.data === 'string') {
        cleanRow[key] = { ...val, data: val.data.substring(0, 40) + '... [TRUNCATED FOR UI]' };
      }
    }
    return cleanRow;
  });
};

// Helper to safely render cells in the 5-row preview without freezing
const renderCellPreview = (val) => {
  if (val && typeof val === 'object') {
    if (val.__type__ === 'tenseal_encrypted' && typeof val.data === 'string') {
      return JSON.stringify({ ...val, data: val.data.substring(0, 40) + '... [TRUNCATED FOR UI]' });
    }
    return JSON.stringify(val);
  }
  return String(val ?? '');
};

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
    
    // Hook to update node data so other nodes can access snapshot data
    const nodes = useNodes();
    const { setNodes: updateNodes } = useReactFlow();

    // Store result in node data when it changes
    useEffect(() => {
      if (result?.rows && result?.columns && nodeId) {
        const safeRows = stripEncryptedData(result.rows.slice(0, 10));
        console.log('[SilverTableNode] Storing safe metadata in node.data for other nodes:', { columns: result.columns });
        
        const saveAndSync = async () => {
          let updatedSnapshotPath = formData?.snapshotPath || null;
          if (!updatedSnapshotPath && result.rows.length > 0) {
            try {
              const saveRes = await saveSnapshot(tableName, `${tableName}_temp`, result.rows);
              if (saveRes?.path) {
                updatedSnapshotPath = saveRes.path;
                console.log('[SilverTableNode] Saved query result to temp snapshot:', updatedSnapshotPath);
              }
            } catch (saveErr) {
              console.error('[SilverTableNode] Failed to save query temp snapshot:', saveErr);
            }
          }
          
          updateNodes(nds => nds.map(n => {
            if (n.id === nodeId) {
              return { 
                ...n, 
                data: { 
                  ...n.data, 
                  rows: undefined, // Clear out the massive array to prevent QuotaExceededError
                  resolvedEntity: safeRows, // Only send a 10-row preview payload
                  columns: result.columns,
                  row_count: result.row_count,
                  snapshotPath: updatedSnapshotPath
                } 
              };
            }
            return n;
          }));
        };
        
        saveAndSync();
      }
    }, [result, nodeId, updateNodes, tableName, formData?.snapshotPath]);

    const handleRunQuery = async () => {
      setLoading(true);
      setError(null);
      try {
        let res;
        if (formData.snapshotPath) {
          res = await getManualSnapshotData(formData.snapshotPath, 1000);
        } else if (formData.snapshotId) {
          res = await executeTimeTravelQuery(sql, formData.snapshotId);
        } else {
          res = await runQuery(sql);
        }
        setResult(res);
      } catch (err) {
        setError(err.response?.data?.detail || err.message);
      } finally {
        setLoading(false);
      }
    };

    const handleDownload = useCallback(async () => {
      if (formData.snapshotPath) {
        // Stream read JSONL from MinIO and convert to CSV on the fly
        const url = `http://localhost:8000/api/v1/query/download-csv?path=${encodeURIComponent(formData.snapshotPath)}`;
        window.open(url, '_blank');
        return;
      }

      
      // Fallback for fresh query results: Memory CSV method
      if (!result?.rows || result.rows.length === 0) {
        alert('No data available to download');
        return;
      }
      
      const headers = result.columns.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
      const csvRows = result.rows.map(row => {
        return result.columns.map(col => {
          let val = row[col];
          if (typeof val === 'object' && val !== null) {
            val = JSON.stringify(val);
          } else if (val === null || val === undefined) {
            val = '';
          }
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(',');
      });
      
      const csvContent = [headers, ...csvRows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `${tableName}_export.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, [result, tableName, formData.snapshotPath]);



    useEffect(() => {
      handleRunQuery();
    }, [tableName]);

    return (
      <>
        {/* Handsontable full-screen modal */}
        {showEditor && result?.rows?.length > 0 && (
          <TableEditorModal
            tableName={tableName}
            initialSnapshotName={formData.snapshotPath ? formData.label : `${tableName}_snap`}
            isUpdate={!!formData.snapshotPath}
            overwritePath={formData.snapshotPath}
            rows={result.rows}
            columns={result.columns}
            onClose={() => setShowEditor(false)}
            onSaveSuccess={() => {
              setShowEditor(false);
              handleRunQuery();
            }}
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* SQL editor / Path display */}
          <div className="field">
            {formData.snapshotPath ? (
              <div style={{
                padding: '12px', background: 'rgba(20, 184, 166, 0.1)', 
                border: '1px solid var(--accent-teal)', borderRadius: '6px',
                display: 'flex', flexDirection: 'column', gap: 6
              }}>
                <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--accent-teal)', fontWeight: 600 }}>
                  Manual Snapshot
                </span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono', wordBreak: 'break-all' }}>
                  {formData.snapshotPath}
                </span>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>

          {/* Run Button */}
          {!formData.snapshotPath && (
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
          )}

          {/* Download Button (Always Visible) */}
          <button
            onClick={handleDownload}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '10px',
              background: 'rgba(20, 184, 166, 0.15)',
              color: 'var(--accent-teal)',
              border: '1px solid rgba(20, 184, 166, 0.4)',
              borderRadius: 6,
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.05em',
              transition: 'background-color 0.2s',
            }}
            onMouseOver={e => e.target.style.background = 'rgba(20, 184, 166, 0.25)'}
            onMouseOut={e => e.target.style.background = 'rgba(20, 184, 166, 0.15)'}
          >


            <Download size={14} />
            {formData.snapshotPath ? 'Download CSV File' : 'Download CSV'}
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
                  {result?.rows?.length > 0 && (
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
                              {renderCellPreview(row[col])}
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
export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { setNodes: updateNodes } = useReactFlow();

  // Auto-fetch snapshot data on mount (if not already fetched)
  useEffect(() => {
    if ((data.resolvedEntity || data.rows) && data.columns) {
      console.log('[SilverTableNode] Already has data, skipping fetch');
      return;
    }
    
    const fetchData = async () => {
      try {
        let res;
        const tableName = data.tableName || data.id;
        const sql = `SELECT * FROM ${tableName} LIMIT 500`;
        
        if (data.snapshotPath) {
          res = await getManualSnapshotData(data.snapshotPath, 1000);
        } else if (data.snapshotId) {
          res = await executeTimeTravelQuery(sql, data.snapshotId);
        } else {
          res = await runQuery(sql);
        }
        
        console.log('[SilverTableNode] Auto-fetched data:', { rows: res?.rows?.length, columns: res?.columns });
        
        if (res?.rows && res?.columns) {
          const safeRows = stripEncryptedData(res.rows.slice(0, 10));
          
          const saveAndSync = async () => {
            let updatedSnapshotPath = data.snapshotPath || null;
            if (!updatedSnapshotPath && res.rows.length > 0) {
              try {
                const saveRes = await saveSnapshot(tableName, `${tableName}_temp`, res.rows);
                if (saveRes?.path) {
                  updatedSnapshotPath = saveRes.path;
                  console.log('[SilverTableNode mount] Saved query result to temp snapshot:', updatedSnapshotPath);
                }
              } catch (saveErr) {
                console.error('[SilverTableNode mount] Failed to save query temp snapshot:', saveErr);
              }
            }
            
            updateNodes(nds => nds.map(n => {
              if (n.id === id) {
                return { 
                  ...n, 
                  data: { 
                    ...n.data, 
                    rows: undefined, // Clear out the massive array to prevent QuotaExceededError
                    resolvedEntity: safeRows, // Only send a 10-row preview payload
                    columns: res.columns,
                    row_count: res.row_count,
                    snapshotPath: updatedSnapshotPath
                  } 
                };
              }
              return n;
            }));
          };
          
          saveAndSync();
        }
      } catch (err) {
        console.error('[SilverTableNode] Auto-fetch failed:', err.message);
      }
    };
    
    fetchData();
  }, [id, data.tableName, data.snapshotPath, data.snapshotId]);

  return (
    <BaseNode
      label={data.label || data.tableName || data.id || config.label}
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
