import React, { useState, useEffect } from 'react';
import { Database, Brain, Filter, Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import { listGraphSources, getEntitiesByLabel } from '../api/client.js';

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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Sources</h3>
                <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', fontSize: '0.9rem' }}>↺</button>
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
                        onDragStart={(e) => onDragStart(e, 'dataTrigger', s.source_id)}
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


export default () => {
    const [isOpen, setIsOpen] = useState(true);
    const [view, setView] = useState('nodes');

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

            <div style={{ display: 'flex', gap: 4, background: 'var(--bg-elevated)', padding: 4, borderRadius: 8 }}>
                <button 
                    onClick={() => setView('nodes')} 
                    style={{ flex: 1, padding: '6px 12px', border: 'none', borderRadius: 6, background: view === 'nodes' ? 'var(--cyan-dim)' : 'transparent', color: view === 'nodes' ? 'var(--cyan)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: view === 'nodes' ? 600 : 400 }}
                >Nodes</button>
                <button 
                    onClick={() => setView('imports')} 
                    style={{ flex: 1, padding: '6px 12px', border: 'none', borderRadius: 6, background: view === 'imports' ? 'var(--cyan-dim)' : 'transparent', color: view === 'imports' ? 'var(--cyan)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: view === 'imports' ? 600 : 400 }}
                >Imports</button>
            </div>

            {view === 'nodes' ? (
                <>
                    <p>Drag nodes onto the canvas to construct your operational pipeline.</p>

                    <div className="dndnode input" onDragStart={(e) => onDragStart(e, 'dataTrigger')} draggable>
                        <Database size={16} color="var(--accent-blue)" />
                        Data Trigger
                    </div>

                    <div className="dndnode ai" onDragStart={(e) => onDragStart(e, 'aiAnalysis')} draggable>
                        <Brain size={16} color="var(--accent-purple)" />
                        AI Analysis
                    </div>

                    <div className="dndnode decision" onDragStart={(e) => onDragStart(e, 'decision')} draggable>
                        <Filter size={16} color="var(--accent-orange)" />
                        Decision Engine
                    </div>

                    <div className="dndnode action" onDragStart={(e) => onDragStart(e, 'action')} draggable>
                        <Zap size={16} color="var(--accent-teal)" />
                        Action Node
                    </div>
                </>
            ) : (
                <ImportsList onDragStart={onDragStart} />
            )}
        </aside>
    );
};
