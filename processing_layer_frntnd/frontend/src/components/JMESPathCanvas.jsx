import React, { useState, useCallback, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { githubLight } from '@uiw/codemirror-theme-github';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';

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

export default function JMESPathCanvas({ 
  sourceId, preview, bps, setBPs, saveBPs, bpSaving, bpSaved, silverPreview, refreshPreview,
  script, setScript, scriptActive, scriptSaving, saveScript, clearScript,
  scriptLogs, scriptError
}) {

  const rawData = preview?.preview?.[0] || null;
  const [tab, setTab] = useState('blueprints'); // 'blueprints' | 'script'
  const [scriptSaved, setScriptSaved] = useState(false);

  const onSaveScript = async () => {
    await saveScript(script);
    setScriptSaved(true);
    setTimeout(() => setScriptSaved(false), 2500);
  };

  const generateTemplate = () => {
    if (!rawData) return "# No data available to generate template";

    const generateSchemaDef = (keys, sampleObj) => {
      let def = "# Declare your Iceberg schema here. The backend will read this variable.\n";
      def += "table_schema = [\n";
      if (keys.length === 0) {
        def += `    {"target_field": "id", "data_type": "STRING", "is_primary_key": True}\n`;
      } else {
        keys.forEach((k, i) => {
          const t = detectType(sampleObj[k]);
          def += `    {"target_field": "${k}", "data_type": "${t}", "is_primary_key": ${i === 0 ? 'True' : 'False'}}${i < keys.length - 1 ? ',' : ''}\n`;
        });
      }
      def += "]\n\n";
      return def;
    };

    if (Array.isArray(rawData) && rawData.length > 0) {
      const first = rawData[0];
      if (typeof first === 'object' && first !== null) {
        const keys = Object.keys(first).filter(k => typeof first[k] !== 'object' || first[k] === null).slice(0, 5);
        const mapping = keys.map(k => `        '${k}': item.get('${k}')`).join(',\n');
        return `${generateSchemaDef(keys, first)}# Auto-generated template for root array\nfor item in payload:\n    rows.append({\n${mapping}\n    })`;
      }
    }

    if (typeof rawData === 'object' && rawData !== null) {
      let targetArrayKey = null;
      let targetArray = null;
      for (const [key, val] of Object.entries(rawData)) {
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
          targetArrayKey = key;
          targetArray = val;
          break;
        }
      }

      if (targetArrayKey && targetArray) {
        const first = targetArray[0];
        const keys = Object.keys(first).filter(k => typeof first[k] !== 'object' || first[k] === null).slice(0, 5);
        const mapping = keys.map(k => `        '${k}': item.get('${k}')`).join(',\n');
        return `${generateSchemaDef(keys, first)}# Auto-generated template for nested array '${targetArrayKey}'\nfor item in get('${targetArrayKey}') or []:\n    rows.append({\n${mapping}\n    })`;
      }

      const keys = Object.keys(rawData).filter(k => typeof rawData[k] !== 'object' || rawData[k] === null).slice(0, 8);
      const mapping = keys.map(k => `    '${k}': get('${k}')`).join(',\n');
      return `${generateSchemaDef(keys, rawData)}# Auto-generated template for flat JSON\nrows.append({\n${mapping}\n})`;
    }

    return "# Could not generate a specific template for this payload format";
  };

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

      {/* ── RIGHT: Blueprint Builder / Script Editor ─────────────── */}
      <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-surface)', border: `1px solid ${scriptActive ? 'var(--cyan)' : 'var(--border-default)'}`, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Tab switcher */}
            {['blueprints', 'script'].map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  background: tab === t ? (t === 'script' ? 'var(--cyan-dim)' : 'var(--bg-elevated)') : 'transparent',
                  border: `1px solid ${tab === t ? (t === 'script' ? 'var(--cyan)' : 'var(--border-default)') : 'transparent'}`,
                  color: tab === t ? (t === 'script' ? 'var(--cyan)' : 'var(--text-primary)') : 'var(--text-muted)',
                  borderRadius: 6, padding: '4px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer'
                }}
              >
                {t === 'blueprints' ? '⚡ JMESPath Blueprints' : `🐍 Python Script${scriptActive ? ' ●' : ''}`}
              </button>
            ))}
          </div>
          {tab === 'blueprints' ? (
            <button className="btn btn-primary" onClick={saveBPs} disabled={bpSaving || bps.filter(b => b.jmes_path).length === 0}>
              {bpSaving ? <span className="spinner" /> : bpSaved ? '✓ Saved' : '💾 Save Blueprints'}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {scriptActive && <button onClick={clearScript} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', borderRadius: 6, padding: '4px 10px', fontSize: '0.78rem', cursor: 'pointer' }}>Clear Script</button>}
              <button className="btn btn-primary" onClick={onSaveScript} disabled={scriptSaving}>
                {scriptSaving ? <span className="spinner" /> : scriptSaved ? '✓ Saved' : '🐍 Save Script'}
              </button>
            </div>
          )}
        </div>

        {/* ── Script Editor Panel ── */}
        {tab === 'script' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-surface)' }}>
            {/* Editor Header */}
            <div style={{ padding: '8px 16px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Python Executor v1.0</span>
                {scriptActive && <span style={{ padding: '2px 6px', background: 'var(--emerald-dim)', border: '1px solid var(--emerald)', color: 'var(--emerald)', borderRadius: 4, fontSize: '0.6rem', fontWeight: 700 }}>ACTIVE</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button 
                  onClick={() => {
                    setScript(generateTemplate());
                  }}
                  style={{ background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', padding: '3px 8px', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}
                >
                  Paste Template
                </button>
                <button 
                  onClick={() => { navigator.clipboard.writeText(script); toast('Copied to clipboard!', 'success'); }}
                  style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', padding: '3px 10px', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <span>📋</span> Copy
                </button>
              </div>
            </div>

            <div style={{ padding: '10px 16px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Available: <code style={{ color: 'var(--amber)' }}>get(path)</code>, <code style={{ color: 'var(--amber)' }}>payload</code>, <code style={{ color: 'var(--amber)' }}>rows</code>, <code style={{ color: 'var(--amber)' }}>uuid</code>, <code style={{ color: 'var(--amber)' }}>json</code>, <code style={{ color: 'var(--amber)' }}>datetime</code><br/>
              Define <code style={{ color: 'var(--cyan)' }}>table_schema = [...]</code> to map Data Types and Primary Keys dynamically.
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <style>{`
                .cm-editor { height: 100%; outline: none !important; }
                .cm-scroller { font-family: 'JetBrains Mono', monospace !important; font-size: 0.85rem; line-height: 1.6; }
                .cm-focused { outline: none !important; }
                .cm-gutters { border-right: 1px solid var(--border-subtle) !important; background-color: transparent !important; color: var(--text-muted) !important; opacity: 0.7; }
                .cm-activeLineGutter { background-color: var(--bg-hover) !important; color: var(--text-primary) !important; }
                .cm-activeLine { background-color: transparent !important; }
              `}</style>
              <CodeMirror
                value={script}
                height="100%"
                theme={document.documentElement.getAttribute('data-theme') === 'dark' ? vscodeDark : githubLight}
                extensions={[python()]}
                onChange={(value) => setScript(value)}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  dropCursor: true,
                  allowMultipleSelections: true,
                  indentOnInput: true,
                  highlightActiveLine: true,
                  highlightActiveLineGutter: true,
                }}
              />
            </div>

            {/* LeetCode-style Console Output */}
            {(scriptLogs || scriptError) && (
              <div style={{ 
                height: '180px', 
                borderTop: '1px solid var(--border-default)', 
                background: 'var(--bg-elevated)', 
                display: 'flex', 
                flexDirection: 'column' 
              }}>
                <div style={{ padding: '6px 16px', background: 'var(--bg-hover)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Console</span>
                  {scriptError && <span style={{ padding: '2px 6px', background: 'var(--rose-dim)', color: 'var(--rose)', borderRadius: 4, fontSize: '0.6rem', fontWeight: 700 }}>RUNTIME ERROR</span>}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {scriptError && (
                    <div style={{ color: 'var(--rose)', marginBottom: 8, padding: 8, background: 'var(--rose-dim)', borderRadius: 4, border: '1px solid var(--rose)' }}>
                      {scriptError}
                    </div>
                  )}
                  {scriptLogs && (
                    <div style={{ color: 'var(--text-primary)' }}>
                      {scriptLogs}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Blueprint Builder Panel ── */}
        {tab === 'blueprints' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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

                {/* Manual JMESPath Editor */}
                <div style={{ background: 'var(--bg-surface)', borderRadius: 7, padding: '8px 12px', marginBottom: 12, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between' }}>
                    <span>JMESPath</span>
                    <span style={{ fontSize: '0.55rem', opacity: 0.6 }}>Supports ||, projections, and filters</span>
                  </div>
                  <input
                    value={bp.jmes_path}
                    onChange={e => updatePath(i, e.target.value)}
                    placeholder="e.g. elements[*].id"
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--cyan)',
                      fontFamily: 'JetBrains Mono',
                      fontSize: '0.8rem',
                      outline: 'none',
                      padding: '4px 0'
                    }}
                  />
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
                  <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)' }}>
                    <input type="checkbox" checked={bp.nested_explode !== false} onChange={e => updateBP(i, 'nested_explode', e.target.checked)} />
                    <span style={{ color: bp.nested_explode !== false ? 'var(--cyan)' : 'var(--text-muted)', fontWeight: bp.nested_explode !== false ? 600 : 400 }}>Deep Explode (Nested)</span>
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
        )}
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
          {silverPreview ? (() => {
            const rows = Array.isArray(silverPreview) ? silverPreview : [silverPreview];
            const allKeys = Object.keys(rows[0] || {});
            // Sort keys: metadata (_ prefix) first, then others
            const sortedKeys = [...allKeys].sort((a, b) => {
              const aMeta = a.startsWith('_');
              const bMeta = b.startsWith('_');
              if (aMeta && !bMeta) return -1;
              if (!aMeta && bMeta) return 1;
              return 0; // maintain order otherwise
            });

            return (
            <div style={{ borderRadius: 8, border: '1px solid var(--border-subtle)', overflowX: 'auto', background: 'var(--bg-elevated)' }}>
              <table style={{ borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.75rem', whiteSpace: 'nowrap', minWidth: '100%' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
                    {sortedKeys.map(k => (
                      <th key={k} style={{ padding: '8px 12px', color: k.startsWith('_') ? 'var(--cyan)' : 'var(--text-muted)', fontWeight: 600, borderRight: '1px solid var(--border-subtle)' }}>
                        {k.startsWith('_') ? <span style={{ opacity: 0.7 }}>{k}</span> : k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIdx) => (
                    <tr key={rowIdx} style={{ borderBottom: '1px solid var(--border-subtle)', background: rowIdx % 2 === 0 ? 'transparent' : 'var(--bg-hover)' }}>
                      {sortedKeys.map((k, i) => {
                        const v = row[k];
                        const isObj = typeof v === 'object' && v !== null;
                        const strVal = isObj ? JSON.stringify(v) : String(v);
                        return (
                          <td key={i} title={strVal} style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono', color: k.startsWith('_') ? 'var(--cyan)' : (isObj ? '#a78bfa' : 'var(--text-secondary)'), fontSize: '0.72rem', borderRight: '1px solid var(--border-subtle)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {strVal}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            );
          })() : (
            <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-muted)', border: '1px dashed var(--border-subtle)', borderRadius: 10 }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>💾</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>No preview available</div>
              <div style={{ fontSize: '0.8rem' }}>Click "Save Blueprints" or "Save Script" to generate a live table preview.</div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
