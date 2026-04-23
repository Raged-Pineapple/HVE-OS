import React, { useState, useRef, useCallback, useEffect } from 'react';
import { parseCurl } from '../api/curlParser.js';

const PRESETS = [
  { label: 'Health check',   cmd: 'curl http://localhost:8000/health' },
  { label: 'List sources',   cmd: 'curl http://localhost:8000/api/v1/sources' },
  { label: 'Silver tables',  cmd: 'curl http://localhost:8000/api/v1/silver/tables' },
  { label: 'Query Silver',   cmd: `curl -X POST http://localhost:8000/api/v1/query -H "Content-Type: application/json" -d '{"sql":"SELECT * FROM bangalore_military LIMIT 5"}'` },
  { label: 'Stream debug',   cmd: `curl -X POST http://localhost:8000/api/v1/ingest/stream -H "Content-Type: application/json" -d '{"source_id":"bangalore_military","data":{"id":1,"lat":12.97,"lon":77.59},"debug":true}'` },
];

function fmt(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

export default function CurlTerminal() {
  const [entries, setEntries] = useState([
    { type: 'info', text: 'Type a curl command and press Enter ↵ — or pick a preset from the button above.' }
  ]);
  const [cmd, setCmd] = useState('curl http://localhost:8000/health');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [showPresets, setShowPresets] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const run = useCallback(async (rawCmd) => {
    const c = (rawCmd || cmd).trim();
    if (!c || loading) return;
    setLoading(true);
    setShowPresets(false);

    setEntries(prev => [...prev, { type: 'cmd', text: c, ts: new Date().toLocaleTimeString('en-GB') }]);

    try {
      const { method, url, headers, body } = parseCurl(c);
      if (!url) throw new Error('No URL found in command');

      const t0 = performance.now();
      const res = await fetch(url, { method, headers, ...(body ? { body } : {}) });
      const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
      const ct = res.headers.get('content-type') || '';
      const text = ct.includes('application/json')
        ? fmt(await res.json())
        : await res.text();

      setEntries(prev => [...prev, { type: res.ok ? 'success' : 'error', status: res.status, elapsed, text }]);
    } catch (e) {
      setEntries(prev => [...prev, { type: 'error', status: 0, elapsed: '0.000', text: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
      setHistory(h => [c, ...h.filter(x => x !== c)].slice(0, 50));
      setHistIdx(-1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [cmd, loading]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      if (history[next]) setCmd(history[next]);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setCmd(next === -1 ? '' : history[next]);
    }
  };

  const pickPreset = (p) => {
    setCmd(p.cmd);
    setShowPresets(false);
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Controls row */}
      <div style={{ display: 'flex', gap: 8, padding: '5px 12px', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowPresets(p => !p)}
            style={{ padding: '3px 10px', fontSize: '0.7rem', borderRadius: 5, cursor: 'pointer', background: showPresets ? 'var(--bg-hover)' : 'var(--bg-elevated)', color: showPresets ? 'var(--text-primary)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)', fontFamily: 'JetBrains Mono' }}>
            presets ▾
          </button>
          {showPresets && (
            <div style={{ position: 'absolute', top: '110%', left: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, zIndex: 200, minWidth: 540, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
              {PRESETS.map(p => (
                <div key={p.label} onMouseDown={() => pickPreset(p)}
                  style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', gap: 12, borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ color: 'var(--text-primary)', fontSize: '0.75rem', minWidth: 110, flexShrink: 0 }}>{p.label}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontFamily: 'JetBrains Mono', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.cmd}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => setEntries([])}
          style={{ padding: '3px 10px', fontSize: '0.7rem', borderRadius: 5, cursor: 'pointer', background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', fontFamily: 'JetBrains Mono' }}>
          clear
        </button>
      </div>

      {/* Output */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0', fontFamily: 'JetBrains Mono', fontSize: '0.74rem', lineHeight: 1.6 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ padding: '3px 14px', borderBottom: '1px solid hsla(222,28%,15%,0.4)' }}>
            {e.type === 'info' && <span style={{ color: 'var(--text-muted)' }}>{e.text}</span>}
            {e.type === 'cmd' && (
              <div style={{ color: 'var(--text-primary)' }}>
                <span style={{ color: 'hsl(220,12%,35%)', marginRight: 8 }}>{e.ts}</span>
                <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>$</span>
                {e.text}
              </div>
            )}
            {(e.type === 'success' || e.type === 'error') && (
              <div>
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: 'hsl(220,12%,35%)', marginRight: 8 }}>{e.ts}</span>
                  <span style={{ color: e.type === 'success' ? 'var(--emerald)' : 'var(--rose)', fontWeight: 700 }}>
                    {e.status ? `HTTP ${e.status}` : 'ERROR'}
                  </span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 10, fontSize: '0.7rem' }}>{e.elapsed}s</span>
                </div>
                <pre style={{ color: e.type === 'success' ? 'hsl(158,60%,75%)' : 'hsl(352,70%,75%)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{e.text}</pre>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', flexShrink: 0 }}>
        <span style={{ color: 'var(--emerald)', fontFamily: 'JetBrains Mono', fontSize: '0.85rem', flexShrink: 0 }}>$</span>
        <input
          ref={inputRef}
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="curl http://localhost:8000/health"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontFamily: 'JetBrains Mono',
            fontSize: '0.82rem',
            color: 'var(--text-primary)',
            padding: '4px 0',
          }}
        />
        {loading
          ? <span className="spinner" style={{ width: 15, height: 15 }} />
          : (
            <button onClick={() => run()} style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)', cursor: 'pointer', padding: '3px 10px', borderRadius: 6, fontFamily: 'JetBrains Mono', fontSize: '0.72rem' }}>
              ↵ run
            </button>
          )
        }
      </div>
    </div>
  );
}
