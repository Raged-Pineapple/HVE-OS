import React, { useState, useCallback } from 'react';

const TYPES = ['STRING', 'INT', 'FLOAT', 'BOOLEAN', 'BIGINT', 'TIMESTAMP'];

const detectType = (v) => {
  if (v === null || v === undefined) return 'STRING';
  if (typeof v === 'boolean') return 'BOOLEAN';
  if (typeof v === 'number') return Number.isInteger(v) ? (v > 2147483647 ? 'BIGINT' : 'INT') : 'FLOAT';
  if (typeof v === 'string') { if (/^\d{4}-\d{2}-\d{2}/.test(v)) return 'TIMESTAMP'; return 'STRING'; }
  return 'STRING';
};

// ─── Path Token Utilities ───────────────────────────────────────────
// A "path" is stored as an array of tokens:
//   "elements[*].tags.name" → ["elements", "[*]", "tags", "name"]
// This makes it trivial to render tokens and toggle array indices.

const tokensToPath = (tokens) => {
  let path = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('[')) {
      path += t;
    } else {
      path += (i === 0 ? '' : '.') + t;
    }
  }
  return path;
};

const pathToTokens = (path) => {
  if (!path) return [];
  return path.match(/([^.[\]]+)|(\[\*\])|(\[\d+\])/g) || [];
};

// Produce token array for a clicked node in the tree
const buildTokens = (parentTokens, key, isArrayIndex) => {
  const tokens = [...parentTokens];
  if (isArrayIndex) {
    tokens.push(`[${key}]`);
  } else {
    tokens.push(key);
  }
  // NOTE: No automatic [*] appended. Arrays show their children with explicit
  // indices [0], [1], etc. The user clicks an index token on the right panel
  // to toggle it to [*] wildcard — giving complete manual control.
  return tokens;
};

// ─── Recursive JSON Tree Node ───────────────────────────────────────

function TreeNode({ data, tokens, depth, onLeafClick, mappedPaths }) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (data === null || data === undefined) return null;

  if (typeof data !== 'object') {
    // Primitive leaf
    const path = tokensToPath(tokens);
    const isMapped = mappedPaths.has(path.replace(/\[\*\]/g, '[0]'));
    const type = detectType(data);
    const TYPE_COLOR = { STRING: '#a78bfa', INT: '#34d399', FLOAT: '#34d399', BIGINT: '#34d399', BOOLEAN: '#fbbf24', TIMESTAMP: '#60a5fa' };

    return (
      <div
        onClick={() => !isMapped && onLeafClick(tokens, data)}
        title={isMapped ? 'Already mapped' : `Click to map as ${type}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '3px 8px', borderRadius: 5, cursor: isMapped ? 'default' : 'pointer',
          background: isMapped ? 'hsla(192,100%,55%,0.08)' : 'transparent',
          border: isMapped ? '1px solid var(--cyan)' : '1px solid transparent',
          opacity: isMapped ? 0.6 : 1,
        }}
        onMouseEnter={e => { if (!isMapped) e.currentTarget.style.background = 'hsla(192,100%,55%,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = isMapped ? 'hsla(192,100%,55%,0.08)' : 'transparent'; }}
      >
        <span style={{ color: isMapped ? 'var(--cyan)' : 'var(--text-muted)', fontSize: '0.7rem', width: 12 }}>
          {isMapped ? '✓' : '+'}
        </span>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.78rem', color: '#79c0ff' }}>
          {tokens[tokens.length - 1]}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>:</span>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.72rem', color: TYPE_COLOR[type] || 'var(--text-secondary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {typeof data === 'string' ? `"${data.length > 22 ? data.slice(0, 22) + '…' : data}"` : String(data)}
        </span>
        <span style={{ marginLeft: 'auto', background: 'var(--bg-surface)', padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem', color: 'var(--text-muted)' }}>{type}</span>
      </div>
    );
  }

  const isArr = Array.isArray(data);
  const label = tokens.length > 0 ? tokens[tokens.length - 1] : '(root)';
  const count = isArr ? data.length : Object.keys(data).length;

  // ── Leaf array: array of primitives (not array of objects) ──────────
  // e.g. tags: ["military", "base"] or amenities: [1, 2, 3]
  // Allow clicking the array itself to map it whole as STRING (JSON serialized),
  // AND allow expanding to map individual items.
  const isLeafArray = isArr && data.length > 0 && typeof data[0] !== 'object';

  if (isLeafArray && tokens.length > 0) {
    const path = tokensToPath(tokens);
    const isMapped = mappedPaths.has(path);
    return (
      <div>
        {/* The array header row — click to map whole array as STRING */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 5, userSelect: 'none' }}
        >
          <span
            onClick={() => setExpanded(e => !e)}
            style={{ color: 'var(--cyan)', fontSize: '0.65rem', width: 12, display: 'inline-block', cursor: 'pointer',
              transition: 'transform 0.15s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >▶</span>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.78rem', color: '#fbbf24', fontWeight: 600 }}>{label}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>Array[{count}]</span>
          {/* Button to map the whole array as STRING */}
          <button
            onClick={() => !isMapped && onLeafClick(tokens, data, true)}
            disabled={isMapped}
            title={isMapped ? 'Already mapped' : 'Map whole array as JSON STRING'}
            style={{
              marginLeft: 4, padding: '1px 7px', borderRadius: 4, border: '1px solid',
              borderColor: isMapped ? 'var(--cyan)' : 'var(--border-subtle)',
              background: isMapped ? 'hsla(192,100%,55%,0.08)' : 'var(--bg-elevated)',
              color: isMapped ? 'var(--cyan)' : 'var(--text-muted)',
              fontSize: '0.62rem', cursor: isMapped ? 'default' : 'pointer', whiteSpace: 'nowrap'
            }}
          >
            {isMapped ? '✓ mapped' : '+ map as STRING'}
          </button>
        </div>
        {/* Expandable individual items */}
        {expanded && (
          <div style={{ paddingLeft: 16, borderLeft: '1px dashed var(--border-subtle)', marginLeft: 4 }}>
            {data.map((item, idx) => (
              <TreeNode
                key={idx}
                data={item}
                tokens={buildTokens(tokens, idx, true)}
                depth={depth + 1}
                onLeafClick={onLeafClick}
                mappedPaths={mappedPaths}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {tokens.length > 0 && (
        <div
          onClick={() => setExpanded(e => !e)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 5, cursor: 'pointer', userSelect: 'none' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ color: 'var(--cyan)', fontSize: '0.65rem', width: 12, transition: 'transform 0.15s', display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.78rem', color: isArr ? '#fbbf24' : '#79c0ff', fontWeight: 600 }}>{label}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
            {isArr ? `Array[${count}]` : `Object {${count}}`}
          </span>
        </div>
      )}
      {expanded && (
        <div style={{ paddingLeft: tokens.length > 0 ? 16 : 0, borderLeft: tokens.length > 0 ? '1px dashed var(--border-subtle)' : 'none', marginLeft: tokens.length > 0 ? 4 : 0 }}>
          {isArr
            ? data.map((item, idx) => (
              <TreeNode
                key={idx}
                data={item}
                tokens={buildTokens(tokens, idx, true)}
                depth={depth + 1}
                onLeafClick={onLeafClick}
                mappedPaths={mappedPaths}
              />
            ))
            : Object.entries(data).map(([k, v]) => (
              <TreeNode
                key={k}
                data={v}
                tokens={buildTokens(tokens, k, false)}
                depth={depth + 1}
                onLeafClick={onLeafClick}
                mappedPaths={mappedPaths}
              />
            ))
          }
        </div>
      )}
    </div>
  );
}

// ─── Token Chip Renderer ─────────────────────────────────────────────

function PathTokens({ tokens, onChange }) {
  const toggleArrayToken = (idx) => {
    const newTokens = [...tokens];
    if (newTokens[idx] === '[*]') {
      newTokens[idx] = '[0]';
    } else if (newTokens[idx].match(/^\[\d+\]$/)) {
      newTokens[idx] = '[*]';
    }
    onChange(tokensToPath(newTokens));
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', minHeight: 28 }}>
      {tokens.map((t, i) => {
        const isArr = t.startsWith('[');
        const isWildcard = t === '[*]';
        return (
          <React.Fragment key={i}>
            {i > 0 && !isArr && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>.</span>}
            <div
              onClick={isArr ? () => toggleArrayToken(i) : undefined}
              title={isArr ? 'Click to toggle index ↔ wildcard [*]' : t}
              style={{
                background: isWildcard ? 'var(--cyan-dim)' : isArr ? 'hsla(38,95%,58%,0.15)' : 'var(--bg-surface)',
                color: isWildcard ? 'var(--cyan)' : isArr ? '#fbbf24' : '#79c0ff',
                border: '1px solid',
                borderColor: isWildcard ? 'var(--cyan)' : isArr ? '#fbbf24' : 'var(--border-subtle)',
                padding: '2px 7px',
                borderRadius: 5,
                fontFamily: 'JetBrains Mono',
                fontSize: '0.72rem',
                cursor: isArr ? 'pointer' : 'default',
                userSelect: 'none',
                display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              {t}
              {isArr && <span style={{ fontSize: '0.5rem', opacity: 0.6 }}>⇅</span>}
            </div>
          </React.Fragment>
        );
      })}
      {tokens.length === 0 && (
        <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', fontStyle: 'italic' }}>No path — click a field on the left</span>
      )}
    </div>
  );
}

// ─── Main Canvas ─────────────────────────────────────────────────────

export default function JMESPathCanvas({ preview, bps, setBPs, saveBPs, bpSaving, bpSaved, silverPreview }) {

  const rawData = preview?.preview?.[0] || null;

  // Compute mapped paths set (normalise wildcards to [0] for comparison)
  const mappedPaths = new Set(
    bps.map(bp => tokensToPath(pathToTokens(bp.jmes_path)).replace(/\[\*\]/g, '[0]'))
  );

  const handleLeafClick = useCallback((tokens, value, isLeafArray = false) => {
    const path = tokensToPath(tokens);
    if (bps.some(bp => bp.jmes_path === path)) return;
    const lastKey = tokens.filter(t => !t.startsWith('[')).slice(-1)[0] || 'field';
    const newBP = {
      target_field: lastKey.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase(),
      jmes_path: path,
      // Leaf arrays are always stored as STRING (JSON serialized)
      data_type: isLeafArray ? 'STRING' : detectType(value),
      is_primary_key: lastKey === 'id',
      is_required: false,
      should_explode: !isLeafArray,
    };
    setBPs(prev => [...prev.filter(b => b.target_field || b.jmes_path), newBP]);
  }, [bps, setBPs]);

  const updateBP = (index, key, value) => {
    setBPs(prev => prev.map((bp, i) => i === index ? { ...bp, [key]: value } : bp));
  };

  const updatePath = (index, newPath) => {
    setBPs(prev => prev.map((bp, i) => i === index ? { ...bp, jmes_path: newPath } : bp));
  };

  const removeBP = (index) => {
    setBPs(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div style={{ display: 'flex', gap: 24, minHeight: 600 }}>

      {/* ── LEFT: Full JSON Explorer ─────────────────────────────── */}
      <div style={{ width: 340, flexShrink: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 2 }}>API Response Explorer</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Full JSON — all items collapsed. <strong>Click any value</strong> to map it.
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '10px 8px' }}>
          {rawData ? (
            <TreeNode
              data={rawData}
              tokens={[]}
              depth={0}
              onLeafClick={handleLeafClick}
              mappedPaths={mappedPaths}
            />
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              No preview data.<br />Go back to Preview and click Send first.
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Blueprint Builder ──────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 2 }}>JMESPath Blueprint Builder</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {bps.filter(b => b.jmes_path).length} fields mapped — click <code style={{ background: 'var(--bg-elevated)', padding: '1px 4px', borderRadius: 3 }}>[0]</code> tokens to toggle <code style={{ background: 'var(--cyan-dim)', color: 'var(--cyan)', padding: '1px 4px', borderRadius: 3 }}>[*]</code> wildcard
            </div>
          </div>
          <button className="btn btn-primary" onClick={saveBPs} disabled={bpSaving || bps.filter(b => b.jmes_path).length === 0}>
            {bpSaving ? <span className="spinner" /> : bpSaved ? '✓ Saved' : '💾 Save Blueprints'}
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {bps.map((bp, i) => {
            const tokens = pathToTokens(bp.jmes_path);
            return (
              <div key={i} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 16, position: 'relative' }}>
                <button
                  onClick={() => removeBP(i)}
                  style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1 }}
                  title="Remove field"
                >×</button>

                {/* Column name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Column name</span>
                  <input
                    value={bp.target_field}
                    onChange={e => updateBP(i, 'target_field', e.target.value)}
                    placeholder="my_column"
                    style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 700, padding: '2px 0', outline: 'none' }}
                  />
                </div>

                {/* Visual JMESPath token display */}
                <div style={{ background: 'var(--bg-surface)', borderRadius: 7, padding: '8px 12px', marginBottom: 12, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>JMESPath</div>
                  <PathTokens tokens={tokens} onChange={(newPath) => updatePath(i, newPath)} />
                </div>

                {/* Controls */}
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Type</span>
                    <select
                      value={bp.data_type}
                      onChange={e => updateBP(i, 'data_type', e.target.value)}
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 5, fontSize: '0.75rem', padding: '4px 8px' }}
                    >
                      {TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={bp.is_primary_key} onChange={e => updateBP(i, 'is_primary_key', e.target.checked)} />
                    Primary Key
                  </label>
                  <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={bp.is_required} onChange={e => updateBP(i, 'is_required', e.target.checked)} />
                    Required
                  </label>
                  <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)' }}>
                    <input type="checkbox" checked={bp.should_explode !== false} onChange={e => updateBP(i, 'should_explode', e.target.checked)} />
                    <span style={{ color: bp.should_explode !== false ? 'var(--cyan)' : 'var(--text-muted)', fontWeight: bp.should_explode !== false ? 600 : 400 }}>Explode Array</span>
                  </label>
                </div>
              </div>
            );
          })}

          {bps.filter(b => b.jmes_path).length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-muted)', border: '1px dashed var(--border-subtle)', borderRadius: 10 }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🖱️</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Click any value in the explorer</div>
              <div style={{ fontSize: '0.8rem' }}>Each click creates a blueprint field.<br />Expand arrays to map nested values.</div>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Silver Table Preview ──────────────────────────────── */}
      <div style={{ width: 340, flexShrink: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#34d399' }}>●</span> Silver Table Preview
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Live data passed through your blueprints.
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: 16 }}>
          {silverPreview ? (
            <div style={{ borderRadius: 8, border: '1px solid var(--border-subtle)', overflowX: 'auto', background: 'var(--bg-elevated)' }}>
              <table style={{ borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.75rem', whiteSpace: 'nowrap', minWidth: '100%' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
                    {Object.keys(Array.isArray(silverPreview) ? (silverPreview[0] || {}) : silverPreview).map(k => (
                      <th key={k} style={{ padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, borderRight: '1px solid var(--border-subtle)' }}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(silverPreview) ? silverPreview : [silverPreview]).map((row, rowIdx) => (
                    <tr key={rowIdx} style={{ borderBottom: '1px solid var(--border-subtle)', background: rowIdx % 2 === 0 ? 'transparent' : 'var(--bg-hover)' }}>
                      {Object.values(row).map((v, i) => {
                        const isObj = typeof v === 'object' && v !== null;
                        const strVal = isObj ? JSON.stringify(v) : String(v);
                        return (
                          <td key={i} title={strVal} style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono', color: isObj ? '#a78bfa' : 'var(--text-secondary)', fontSize: '0.72rem', borderRight: '1px solid var(--border-subtle)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {strVal}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-muted)', border: '1px dashed var(--border-subtle)', borderRadius: 10 }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>💾</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>No preview available</div>
              <div style={{ fontSize: '0.8rem' }}>Click "Save Blueprints" to generate a live table preview.</div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
