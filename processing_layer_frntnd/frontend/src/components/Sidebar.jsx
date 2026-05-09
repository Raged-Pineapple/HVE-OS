import React, { useState, useEffect } from 'react';
import { Database, Brain, Filter, Zap, ChevronLeft, ChevronRight, Activity, Sigma, RefreshCw, FileJson, Trash2 } from 'lucide-react';
import { listGraphSources, getEntitiesByLabel, listSilverTables, getTableSnapshots, listManualSnapshots, deleteManualSnapshot } from '../api/client.js';
import { getNodesByCategory } from './nodes/registry.js';

const ImportsList = ({ onDragStart }) => {
    const [sources, setSources] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedSource, setExpandedSource] = useState(null);
    const [entities, setEntities] = useState({});
    const [loadingEntities, setLoadingEntities] = useState({});

    const load = () => { setLoading(true); listGraphSources().then(setSources).catch(e => console.error(e)).finally(() => setLoading(false)); };
    useEffect(() => { load(); }, []);

    const toggleExpand = async (sourceId) => {
        if (expandedSource === sourceId) {
            setExpandedSource(null);
            return;
        }
        setExpandedSource(sourceId);
        if (!entities[sourceId]) {
            setLoadingEntities(prev => ({ ...prev, [sourceId]: true }));
            try {
                const data = await getEntitiesByLabel(sourceId);
                setEntities(prev => ({ ...prev, [sourceId]: data }));
            } catch (e) {
                console.error("Failed to fetch entities", e);
            } finally {
                setLoadingEntities(prev => ({ ...prev, [sourceId]: false }));
            }
        }
    };

    const statusDot = (ps) => {
        if (!ps) return <span title="No API config" style={{ width:8, height:8, borderRadius:'50%', background:'var(--text-muted)', display:'inline-block', opacity:0.4 }} />;
        if (ps.last_status === 'SUCCESS') return <span title={`OK — last polled ${ps.last_polled_at||'never'}`} style={{ width:8, height:8, borderRadius:'50%', background:'#34d399', display:'inline-block', boxShadow:'0 0 6px #34d39960' }} />;
        if (ps.last_status === 'ERROR') return <span title={ps.last_error||'Error'} style={{ width:8, height:8, borderRadius:'50%', background:'#f05050', display:'inline-block', boxShadow:'0 0 6px #f0505060' }} />;
        return <span title={`Status: ${ps.last_status||'pending'}`} style={{ width:8, height:8, borderRadius:'50%', background:'#fbbf24', display:'inline-block' }} />;
    };

    return (
        <div style={{ flex: 1, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', fontSize: '0.9rem', opacity: 0.7 }} title="Refresh Sources">↺</button>
            </div>
            {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><span className="spinner" /></div>}
            {!loading && sources.length === 0 && <div className="empty-state" style={{ padding: 16, fontSize: '0.76rem' }}>No sources yet.</div>}
            {sources.map(s => (
                <div key={s.source_id} style={{ marginBottom: 6 }}>
                    <div 
                        className="card" 
                        style={{ 
                            padding: '10px 12px', 
                            cursor: 'pointer', 
                            background: expandedSource === s.source_id ? 'var(--cyan-dim)' : 'var(--glass-bg)', 
                            borderColor: expandedSource === s.source_id ? 'var(--cyan)' : 'var(--border-default)',
                            transition: 'all 0.2s ease'
                        }}
                        onClick={() => toggleExpand(s.source_id)}
                        onDragStart={(e) => onDragStart(e, 'source', s.source_id)}
                        draggable
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                {statusDot(s.poll_status)}
                                <p style={{ fontWeight: 600, fontSize: '0.8rem', margin: 0 }}>{s.source_id}</p>
                            </div>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{expandedSource === s.source_id ? '▲' : '▼'}</span>
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', marginTop:3, fontSize:'0.66rem', color:'var(--text-muted)' }}>
                            <span>{s.source_type}</span>
                            {s.poll_status?.is_polling && <span style={{ color:'var(--emerald)', fontWeight:600 }}>● polling</span>}
                        </div>
                    </div>
                    
                    {expandedSource === s.source_id && (
                        <div style={{ 
                            padding: '8px 12px', 
                            background: 'rgba(0,0,0,0.2)', 
                            border: '1px solid var(--border-subtle)', 
                            borderTop: 'none',
                            borderRadius: '0 0 8px 8px',
                            fontSize: '0.75rem',
                            maxHeight: '200px',
                            overflowY: 'auto'
                        }}>
                            <p style={{ margin: '0 0 6px 0', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Neo4j Entities ({s.source_id.charAt(0).toUpperCase() + s.source_id.slice(1)})</p>
                            {loadingEntities[s.source_id] ? (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: 10 }}><span className="spinner" style={{ width: 14, height: 14 }} /></div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {entities[s.source_id]?.length > 0 ? (
                                        entities[s.source_id].map((ent, idx) => (
                                            <div key={idx} style={{ 
                                                padding: '4px 8px', 
                                                background: 'var(--bg-elevated)', 
                                                borderRadius: 4,
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                fontFamily: 'JetBrains Mono',
                                                fontSize: '0.7rem'
                                            }} title={JSON.stringify(ent)}>
                                                {ent.name || ent.id || ent.title || Object.values(ent)[0] || 'Unknown Entity'}
                                            </div>
                                        ))
                                    ) : (
                                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.7rem' }}>No entities found in graph.</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};


export default function Sidebar({ onInjectNode }) {
    const [isOpen, setIsOpen] = useState(true);
    const [view, setView] = useState('nodes');
    const [silverTables, setSilverTables] = useState([]);
    const [loadingTables, setLoadingTables] = useState(false);
    const [expandedTable, setExpandedTable] = useState(null);
    const [tableSnapshots, setTableSnapshots] = useState({});
    const [loadingSnapshots, setLoadingSnapshots] = useState({});
    const [manualSnapshots, setManualSnapshots] = useState({});
    const [selectedDatabaseSource, setSelectedDatabaseSource] = useState("");

    const fetchAllSnapshots = async (tables) => {
        setLoadingTables(true);
        const snaps = {};
        const mSnaps = {};
        try {
            await Promise.all(tables.map(async (t) => {
                try {
                    const res = await getTableSnapshots(t.table_name);
                    if (res && res.length > 0) snaps[t.table_name] = res;
                } catch (e) {}
            }));
            try {
                const manual = await listManualSnapshots();
                manual.forEach(m => {
                    if (!mSnaps[m.table_name]) mSnaps[m.table_name] = [];
                    mSnaps[m.table_name].push(m);
                });
            } catch(e) {}
            setTableSnapshots(snaps);
            setManualSnapshots(mSnaps);
        } finally {
            setLoadingTables(false);
        }
    };

    useEffect(() => {
        if (silverTables.length === 0) {
            listSilverTables()
                .then(async (tables) => {
                    setSilverTables(tables);
                    await fetchAllSnapshots(tables);
                })
                .catch(console.error);
        }
    }, [silverTables.length]);

    const toggleTableExpand = async (tableName) => {
        if (expandedTable === tableName) {
            setExpandedTable(null);
            return;
        }
        setExpandedTable(tableName);
        // Snaps already fetched globally, no need to re-fetch unless missing
        if (!tableSnapshots[tableName]) {
            setLoadingSnapshots(prev => ({ ...prev, [tableName]: true }));
            try {
                const snaps = await getTableSnapshots(tableName);
                setTableSnapshots(prev => ({ ...prev, [tableName]: snaps }));
            } catch (e) {
                console.error("Failed to fetch snapshots", e);
            } finally {
                setLoadingSnapshots(prev => ({ ...prev, [tableName]: false }));
            }
        }
    };

    const onDragStart = (event, nodeType, sourceId) => {
        event.dataTransfer.setData('application/reactflow', nodeType);
        if (sourceId) event.dataTransfer.setData('sourceId', sourceId);
        event.dataTransfer.effectAllowed = 'move';
    };

    if (!isOpen) {
        return (
            <aside style={{
                width: '60px',
                height: '100%',
                background: 'var(--bg-surface)',
                borderRight: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: '24px',
                zIndex: 10,
                flexShrink: 0
            }}>
                <button 
                    onClick={() => setIsOpen(true)}
                    className="btn btn-ghost"
                    style={{ padding: '8px', borderRadius: '8px' }}
                    title="Expand Sidebar"
                >
                    <ChevronRight size={20} />
                </button>
            </aside>
        );
    }

    return (
        <aside style={{
            width: '280px',
            height: '100%',
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '24px',
            position: 'relative',
            zIndex: 10,
            flexShrink: 0
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>Logic Graph</h2>
                <button 
                    onClick={() => setIsOpen(false)}
                    className="btn btn-ghost"
                    style={{ padding: '6px', borderRadius: '8px', margin: '-6px' }}
                    title="Collapse Sidebar"
                >
                    <ChevronLeft size={20} />
                </button>
            </div>

            <div style={{ 
                display: 'flex', 
                gap: 8, 
                overflowX: 'auto', 
                paddingBottom: 12,
                paddingTop: 4,
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                borderBottom: '1px solid var(--border-subtle)',
                marginBottom: 12
            }} className="hide-scrollbar">
                <button 
                    onClick={() => setView('imports')} 
                    style={{ 
                        flexShrink: 0, padding: '8px 14px', border: '1px solid var(--border-default)', borderRadius: 8, 
                        background: view === 'imports' ? 'var(--cyan-dim)' : 'var(--bg-elevated)', 
                        color: view === 'imports' ? 'var(--cyan)' : 'var(--text-secondary)', 
                        cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                        borderColor: view === 'imports' ? 'var(--cyan)' : 'var(--border-default)'
                    }}
                >
                    <Database size={14} color={view === 'imports' ? 'var(--cyan)' : 'var(--text-muted)'} />
                    Sources
                </button>

                <button 
                    onClick={() => setView('logic')} 
                    style={{ 
                        flexShrink: 0, padding: '8px 14px', border: '1px solid var(--border-default)', borderRadius: 8, 
                        background: view === 'logic' ? 'var(--cyan-dim)' : 'var(--bg-elevated)', 
                        color: view === 'logic' ? 'var(--cyan)' : 'var(--text-secondary)', 
                        cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                        borderColor: view === 'logic' ? 'var(--cyan)' : 'var(--border-default)'
                    }}
                >
                    <Activity size={14} color={view === 'logic' ? 'var(--cyan)' : 'var(--accent-blue)'} />
                    Logic
                </button>

                <button 
                    onClick={() => setView('ai')} 
                    style={{ 
                        flexShrink: 0, padding: '8px 14px', border: '1px solid var(--border-default)', borderRadius: 8, 
                        background: view === 'ai' ? 'var(--cyan-dim)' : 'var(--bg-elevated)', 
                        color: view === 'ai' ? 'var(--cyan)' : 'var(--text-secondary)', 
                        cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                        borderColor: view === 'ai' ? 'var(--cyan)' : 'var(--border-default)'
                    }}
                >
                    <Brain size={14} color={view === 'ai' ? 'var(--cyan)' : 'var(--accent-purple)'} />
                    AI
                </button>

                <button 
                    onClick={() => setView('database')} 
                    style={{ 
                        flexShrink: 0, padding: '8px 14px', border: '1px solid var(--border-default)', borderRadius: 8, 
                        background: view === 'database' ? 'var(--cyan-dim)' : 'var(--bg-elevated)', 
                        color: view === 'database' ? 'var(--cyan)' : 'var(--text-secondary)', 
                        cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                        borderColor: view === 'database' ? 'var(--cyan)' : 'var(--border-default)'
                    }}
                >
                    <Database size={14} color={view === 'database' ? 'var(--cyan)' : 'var(--accent-orange)'} />
                    Database
                </button>

                <button 
                    onClick={() => setView('action')} 
                    style={{ 
                        flexShrink: 0, padding: '8px 14px', border: '1px solid var(--border-default)', borderRadius: 8, 
                        background: view === 'action' ? 'var(--cyan-dim)' : 'var(--bg-elevated)', 
                        color: view === 'action' ? 'var(--cyan)' : 'var(--text-secondary)', 
                        cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                        borderColor: view === 'action' ? 'var(--cyan)' : 'var(--border-default)'
                    }}
                >
                    <Zap size={14} color={view === 'action' ? 'var(--cyan)' : 'var(--accent-teal)'} />
                    Action
                </button>
            </div>

            {view === 'imports' ? (
                <ImportsList onDragStart={onDragStart} />
            ) : view === 'database' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {loadingTables && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Loading tables...</p>}
                    {!loadingTables && silverTables.length === 0 && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No tables found.</p>}


                    {/* Source Selection Dropdown */}
                    <div style={{ flexShrink: 0 }}>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Add Source to Canvas
                        </p>
                        <select 
                            style={{ 
                                width: '100%', 
                                padding: '8px 10px', 
                                borderRadius: 6, 
                                background: 'var(--bg-elevated)', 
                                border: '1px solid var(--cyan)', 
                                color: 'var(--text-primary)', 
                                fontSize: '0.75rem', 
                                cursor: 'pointer',
                                boxShadow: '0 0 10px rgba(34, 211, 238, 0.1)'
                            }}
                            value=""
                            onChange={(e) => {
                                if (e.target.value && onInjectNode) {
                                    onInjectNode('silverTable', e.target.value);
                                }
                            }}
                        >
                            <option value="" disabled>Select a Source...</option>
                            {silverTables.map((t, i) => (
                                <option key={i} value={t.table_name}>{t.table_name}</option>
                            ))}
                        </select>
                    </div>



                    {/* Manual Snapshots List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Saved Manual Snapshots
                            </p>
                            <button 
                                onClick={() => fetchAllSnapshots(silverTables)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', opacity: 0.8, padding: 0 }}
                                title="Refresh Snapshots"
                            >
                                <RefreshCw size={12} />
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '350px', overflowY: 'auto' }}>
                            {Object.entries(manualSnapshots).map(([tableName, snaps]) => {
                                if (!snaps || snaps.length === 0) return null;
                                return (
                                    <div key={tableName} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <p style={{ margin: '4px 0 0 0', fontSize: '0.65rem', color: 'var(--accent-teal)', fontWeight: 600 }}>{tableName}</p>
                                        {snaps.map((snap, sIdx) => (
                                            <div 
                                                key={sIdx} 
                                                className="card"
                                                draggable
                                                onDragStart={(e) => onDragStart(e, 'silverTable', `${tableName}::manual::${snap.path}::${snap.snapshot_name}`)}
                                                onClick={() => onInjectNode && onInjectNode('silverTable', `${tableName}::manual::${snap.path}::${snap.snapshot_name}`)}
                                                style={{ 
                                                    padding: '10px 12px', 
                                                    background: 'var(--glass-bg)', 
                                                    border: '1px solid var(--border-default)',
                                                    borderRadius: 8,
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    fontSize: '0.8rem',
                                                    cursor: 'grab',
                                                    transition: 'all 0.2s ease',
                                                    marginBottom: 6
                                                }}
                                                onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--accent-teal)'}
                                                onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--border-default)'}
                                                title={`Drag or Click to add Manual Snapshot: ${snap.snapshot_name}`}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <FileJson size={14} color="var(--accent-teal)" />
                                                    <div>
                                                        <p style={{ margin: 0, fontWeight: 600 }}>{snap.snapshot_name}</p>
                                                        <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--text-muted)' }}>{new Date(parseInt(snap.last_modified)).toLocaleString()}</p>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (window.confirm(`Delete snapshot "${snap.snapshot_name}"?`)) {
                                                            deleteManualSnapshot(snap.path)
                                                                .then(() => fetchAllSnapshots(silverTables))
                                                                .catch(err => alert("Failed to delete: " + err));
                                                        }
                                                    }}
                                                    style={{ 
                                                        background: 'none', border: 'none', cursor: 'pointer', 
                                                        color: 'var(--accent-red)', opacity: 0.6, padding: '4px' 
                                                    }}
                                                    title="Delete Snapshot"
                                                    onMouseOver={e => e.currentTarget.style.opacity = 1}
                                                    onMouseOut={e => e.currentTarget.style.opacity = 0.6}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                            {Object.keys(manualSnapshots).length === 0 && (
                                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.7rem', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>No manual snapshots saved yet.</p>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {getNodesByCategory()[view]?.filter(node => !node.hideInSidebar).map(node => {
                            const Icon = node.icon;
                            return (
                                <div 
                                    key={node.type}
                                    className="card" 
                                    onDragStart={(e) => onDragStart(e, node.type)} 
                                    draggable 
                                    style={{ 
                                        padding: '10px 12px', 
                                        cursor: 'grab', 
                                        background: 'var(--glass-bg)', 
                                        borderColor: 'var(--border-default)',
                                        transition: 'all 0.2s ease',
                                        marginBottom: 6
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                            {Icon && <Icon size={14} color={node.color || 'var(--text-muted)'} />}
                                            <p style={{ fontWeight: 600, fontSize: '0.8rem', margin: 0 }}>{node.label}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

        </aside>
    );
};
