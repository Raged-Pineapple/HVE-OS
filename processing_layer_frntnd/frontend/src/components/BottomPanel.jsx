import React, { useState, useEffect, useRef, useCallback } from 'react';
import LogTerminal from './LogTerminal.jsx';
import CurlTerminal from './CurlTerminal.jsx';

export default function BottomPanel() {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(260);
  const [tab, setTab] = useState('log'); // 'log' | 'curl' | 'neo4j'
  const [logCount, setLogCount] = useState(0);

  // Resize drag
  const startDrag = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const onMove = (me) => setHeight(Math.max(140, Math.min(620, startH + (startY - me.clientY))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [height]);

  const TabBtn = ({ id, label, badge }) => (
    <button
      onClick={(e) => { e.stopPropagation(); setTab(id); if (!open) setOpen(true); }}
      style={{
        padding: '0 14px', height: '100%', border: 'none', cursor: 'pointer',
        background: tab === id && open ? 'var(--bg-hover)' : 'transparent',
        color: tab === id && open ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderBottom: tab === id && open ? '2px solid var(--text-primary)' : '2px solid transparent',
        fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.07em',
        fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: 7,
        transition: 'all 0.15s',
      }}
    >
      {label}
      {badge ? (
        <span style={{ background: 'var(--border-subtle)', color: 'var(--text-primary)', fontSize: '0.65rem', padding: '2px 8px', borderRadius: 99 }}>
          {badge}
        </span>
      ) : null}
    </button>
  );

  return (
    <div style={{
      position: 'relative',
      flexShrink: 0,
      borderTop: '1px solid var(--border-subtle)',
      background: 'var(--bg-surface)',
      height: open ? height : 36,
      display: 'flex',
      flexDirection: 'column',
      transition: 'height 0.18s ease',
    }}>
      {/* Drag handle */}
      {open && (
        <div onMouseDown={startDrag} style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 5,
          cursor: 'ns-resize', zIndex: 10,
        }} />
      )}

      {/* Header with tabs */}
      <div style={{
        display: 'flex', alignItems: 'stretch', height: 36, flexShrink: 0,
        borderBottom: open ? '1px solid var(--border-subtle)' : 'none',
      }}>
        <TabBtn id="log"  label="SYSTEM LOG" badge={logCount > 0 ? logCount : null} />
        <TabBtn id="curl" label="CURL" />
        <TabBtn id="neo4j" label="NEO4J BROWSER" />
        <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setOpen(o => !o)} />
        <button
          onClick={() => setOpen(o => !o)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 14px', fontSize: '0.75rem' }}
        >
          {open ? '▾' : '▴'}
        </button>
      </div>

      {/* Content */}
      {open && (
        <div style={{ flex: 1, minHeight: 0, position: 'relative', display: tab === 'log' ? 'flex' : 'block', flexDirection: 'column' }}>
          {/* LogTerminal mounted always (keeps SSE connection alive) */}
          <div style={{ display: tab === 'log' ? 'contents' : 'none' }}>
            <LogTerminal onCountChange={setLogCount} inPanel />
          </div>
          {tab === 'curl' && <CurlTerminal />}
          {tab === 'neo4j' && <iframe src="http://localhost:7474" style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} title="Neo4j Browser" />}
        </div>
      )}
    </div>
  );
}
