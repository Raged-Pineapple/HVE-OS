import React, { useState, useEffect, useRef, useCallback } from 'react';

const LEVEL_STYLE = {
  info:    { color: 'hsl(192,100%,60%)',  prefix: 'INFO ' },
  warning: { color: 'hsl(38,95%,58%)',   prefix: 'WARN ' },
  error:   { color: 'hsl(352,85%,62%)',  prefix: 'ERR  ' },
  debug:   { color: 'hsl(220,15%,55%)',  prefix: 'DBG  ' },
};

// When inPanel=true, LogTerminal renders only the output area (no own header/chrome).
// The parent BottomPanel owns the header.
export default function LogTerminal({ inPanel = false, onCountChange }) {
  const [open, setOpen] = useState(inPanel); // if in panel it's always "open"
  const [height, setHeight] = useState(220);
  const [logs, setLogs] = useState([
    { ts: '--:--:--', level: 'info', logger: 'terminal', message: 'Waiting for log stream...' }
  ]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState('');
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef(null);
  const esRef = useRef(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // Bubble log count up to BottomPanel tab badge
  useEffect(() => {
    onCountChange?.(logs.length);
  }, [logs.length, onCountChange]);

  // Auto-scroll
  useEffect(() => {
    if (!paused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, paused]);

  // SSE connection — open immediately when inPanel, else on expand
  const shouldConnect = inPanel || open;
  useEffect(() => {
    if (!shouldConnect) return;
    if (esRef.current) return;

    const es = new EventSource('http://localhost:8000/api/v1/logs/stream');
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      if (pausedRef.current) return;
      try {
        const entry = JSON.parse(e.data);
        setLogs(prev => {
          const next = [...prev, entry];
          return next.length > 500 ? next.slice(-500) : next;
        });
      } catch {}
    };
    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [shouldConnect]);

  // Resize drag (standalone mode only)
  const startDrag = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const onMove = (me) => setHeight(Math.max(120, Math.min(600, startH + (startY - me.clientY))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [height]);

  const clear = () => setLogs([]);

  const filtered = filter
    ? logs.filter(l => l.message.toLowerCase().includes(filter.toLowerCase()) || l.logger.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  // ── Panel mode (no own header) ──────────────────────────────
  if (inPanel) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Controls row */}
        <div style={{ display: 'flex', gap: 8, padding: '5px 12px', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: connected ? 'var(--emerald)' : 'var(--text-muted)',
            boxShadow: connected ? '0 0 6px var(--emerald)' : 'none',
          }} />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter..."
            style={{ width: 140, padding: '2px 8px', fontSize: '0.72rem', borderRadius: 5, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono' }} />
          <button onClick={() => setPaused(p => !p)}
            style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: 5, cursor: 'pointer', background: paused ? 'var(--amber-dim)' : 'var(--bg-elevated)', color: paused ? 'var(--amber)' : 'var(--text-muted)', border: `1px solid ${paused ? 'hsla(38,95%,58%,0.4)' : 'var(--border-subtle)'}`, fontFamily: 'JetBrains Mono' }}>
            {paused ? '▶ resume' : '⏸ pause'}
          </button>
          <button onClick={clear}
            style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: 5, cursor: 'pointer', background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', fontFamily: 'JetBrains Mono' }}>
            clear
          </button>
        </div>
        {/* Log output */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0', fontFamily: 'JetBrains Mono', fontSize: '0.74rem', lineHeight: 1.6 }}>
          {filtered.map((log, i) => {
            const s = LEVEL_STYLE[log.level] || LEVEL_STYLE.info;
            return (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '0 14px', background: i % 2 === 0 ? 'transparent' : 'hsla(222,28%,7%,0.4)' }}>
                <span style={{ color: 'hsl(220,12%,35%)', flexShrink: 0 }}>{log.ts}</span>
                <span style={{ color: s.color, flexShrink: 0, fontWeight: 600 }}>{s.prefix}</span>
                <span style={{ color: 'hsl(262,60%,65%)', flexShrink: 0 }}>[{log.logger}]</span>
                <span style={{ color: 'hsl(220,15%,70%)' }}>{log.message}</span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>
    );
  }

  // ── Standalone mode (own header + resize) ───────────────────
  return (
    <div style={{ position: 'relative', flexShrink: 0, borderTop: '1px solid var(--border-subtle)', background: 'hsl(222,28%,5%)', transition: 'height 0.2s ease', height: open ? height : 36, display: 'flex', flexDirection: 'column' }}>
      {open && <div onMouseDown={startDrag} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, cursor: 'ns-resize', zIndex: 10 }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 36, flexShrink: 0, cursor: 'pointer', userSelect: 'none', borderBottom: open ? '1px solid var(--border-subtle)' : 'none' }} onClick={() => setOpen(o => !o)}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: connected ? 'var(--emerald)' : 'var(--text-muted)', boxShadow: connected ? '0 0 6px var(--emerald)' : 'none' }} />
        <span style={{ fontSize: '0.75rem', fontFamily: 'JetBrains Mono', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em' }}>SYSTEM LOG</span>
        {logs.length > 1 && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '1px 7px', borderRadius: 99 }}>{logs.length}</span>}
        <div style={{ flex: 1 }} />
        {open && (
          <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter..." style={{ width: 140, padding: '2px 8px', fontSize: '0.72rem', borderRadius: 5, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono' }} />
            <button onClick={() => setPaused(p => !p)} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: 5, cursor: 'pointer', background: paused ? 'var(--amber-dim)' : 'var(--bg-elevated)', color: paused ? 'var(--amber)' : 'var(--text-muted)', border: `1px solid ${paused ? 'hsla(38,95%,58%,0.4)' : 'var(--border-subtle)'}`, fontFamily: 'JetBrains Mono' }}>{paused ? '▶ resume' : '⏸ pause'}</button>
            <button onClick={clear} style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: 5, cursor: 'pointer', background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', fontFamily: 'JetBrains Mono' }}>clear</button>
          </div>
        )}
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 6 }}>{open ? '▾' : '▴'}</span>
      </div>
      {open && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', fontFamily: 'JetBrains Mono', fontSize: '0.74rem', lineHeight: 1.6 }}>
          {filtered.map((log, i) => {
            const s = LEVEL_STYLE[log.level] || LEVEL_STYLE.info;
            return (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '0 14px', background: i % 2 === 0 ? 'transparent' : 'hsla(222,28%,7%,0.4)' }}>
                <span style={{ color: 'hsl(220,12%,35%)', flexShrink: 0 }}>{log.ts}</span>
                <span style={{ color: s.color, flexShrink: 0, fontWeight: 600 }}>{s.prefix}</span>
                <span style={{ color: 'hsl(262,60%,65%)', flexShrink: 0 }}>[{log.logger}]</span>
                <span style={{ color: 'hsl(220,15%,70%)' }}>{log.message}</span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
