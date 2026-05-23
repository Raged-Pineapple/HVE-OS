import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Phone, Send, MessageSquare, CheckCircle, XCircle, Loader, Radio, AlignLeft, AlertTriangle, Zap } from 'lucide-react';
import BaseNode from '../BaseNode';

// ─── mode definitions ─────────────────────────────────────────────────────────
const MODES = [
  {
    key: 'highlighted',
    label: 'Highlighted Entity',
    icon: Zap,
    color: '#F59E0B',
    desc: 'Sends only the highest-risk entity. Skips if unchanged since last run (deduplication).',
  },
  {
    key: 'static',
    label: 'Static Message',
    icon: AlignLeft,
    color: '#8B5CF6',
    desc: 'One message per run. Optionally use {field} tokens from the first entity.',
  },
  {
    key: 'template',
    label: 'Entity Template',
    icon: Radio,
    color: '#3B82F6',
    desc: 'One message per entity in the input using {field} interpolation.',
  },
  {
    key: 'risk_filter',
    label: 'Risk Alert',
    icon: AlertTriangle,
    color: '#EF4444',
    desc: 'Like Entity Template but only fires for entities above a risk score threshold.',
  },
];

const EXAMPLE_VARS = [
  '{name}', '{title}', '{_risk_score}', '{_risk_level}', '{_hve_id}', '{_hops}', '{address.city}',
];

// ─── config export ────────────────────────────────────────────────────────────
export const config = {
  type: 'twilioNode',
  category: 'action',
  label: 'Twilio Notify',
  icon: Phone,
  color: '#F22F46',
  hideInSidebar: false,

  SettingsForm: ({ nodeId, formData, handleChange }) => {
    const [testStatus, setTestStatus] = useState(null);
    const [testMsg,    setTestMsg   ] = useState('');

    const mode    = formData.sendMode || 'highlighted';
    const channel = formData.channel  || 'sms';

    const inp = {
      width: '100%', padding: '6px 8px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem',
    };

    const testConnection = async () => {
      const sid   = (formData.accountSid || '').trim();
      const token = (formData.authToken  || '').trim();
      if (!sid || !token) { setTestStatus('error'); setTestMsg('Enter SID and Token first.'); return; }
      setTestStatus('testing'); setTestMsg('');
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
          headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}` },
        });
        if (res.ok) {
          const d = await res.json();
          setTestStatus('ok'); setTestMsg(`Connected as "${d.friendly_name}"`);
        } else {
          const e = await res.json().catch(() => ({}));
          setTestStatus('error'); setTestMsg(e.message || `HTTP ${res.status}`);
        }
      } catch (e) { setTestStatus('error'); setTestMsg(e.message); }
    };

    const insertVar = (v) => handleChange('messageTemplate', (formData.messageTemplate || '') + v);

    const activeModeColor = MODES.find(m => m.key === mode)?.color || '#F22F46';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* action badge */}
        <div style={{ padding: '6px 10px', background: 'rgba(242,47,70,0.07)', border: '1px solid rgba(242,47,70,0.22)', borderRadius: 6, fontSize: '0.65rem', color: '#F22F46', fontWeight: 600 }}>
          🔴 Action Node — sends live Twilio messages on every pipeline execution
        </div>

        {/* ── Mode selector ── */}
        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6, fontWeight: 600 }}>Send Mode</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {MODES.map(m => {
              const Icon   = m.icon;
              const active = mode === m.key;
              return (
                <div key={m.key} onClick={() => handleChange('sendMode', m.key)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                    background: active ? `${m.color}11` : 'var(--bg-surface)',
                    border: `1px solid ${active ? m.color : 'var(--border-subtle)'}`,
                    transition: 'all 0.12s',
                  }}>
                  <Icon size={13} color={active ? m.color : 'var(--text-muted)'} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: active ? 700 : 400, color: active ? m.color : 'var(--text-primary)' }}>{m.label}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{m.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

        {/* ── Credentials ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Twilio Credentials</label>
          <div>
            <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Account SID</label>
            <input type="text" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={formData.accountSid || ''} onChange={e => handleChange('accountSid', e.target.value)} style={inp} />
          </div>
          <div>
            <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Auth Token</label>
            <input type="password" placeholder="••••••••••••••••••••••••••••••••"
              value={formData.authToken || ''} onChange={e => handleChange('authToken', e.target.value)} style={inp} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={testConnection} disabled={testStatus === 'testing'}
              style={{ flex: 1, padding: '5px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.72rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {testStatus === 'testing'
                ? <Loader size={11} style={{ animation: 'spin 1s linear infinite' }} />
                : <CheckCircle size={11} />}
              Test Connection
            </button>
            {testStatus && testStatus !== 'testing' && (
              <span style={{ fontSize: '0.6rem', color: testStatus === 'ok' ? '#10B981' : '#EF4444', display: 'flex', alignItems: 'center', gap: 3 }}>
                {testStatus === 'ok' ? <CheckCircle size={10} /> : <XCircle size={10} />} {testMsg}
              </span>
            )}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

        {/* ── Delivery ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Delivery</label>
          <div>
            <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Channel</label>
            <select value={channel} onChange={e => handleChange('channel', e.target.value)} style={inp}>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="call">Voice Call</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>From</label>
              <input type="text" placeholder="+15551234567"
                value={formData.fromNumber || ''} onChange={e => handleChange('fromNumber', e.target.value)} style={inp} />
            </div>
            <div>
              <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>To</label>
              <input type="text" placeholder="+15559876543"
                value={formData.toNumber || ''} onChange={e => handleChange('toNumber', e.target.value)} style={inp} />
            </div>
          </div>
        </div>

        {/* ── Risk threshold (risk_filter only) ── */}
        {mode === 'risk_filter' && (
          <div>
            <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              Risk Score Threshold — only alert above this value
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="range" min={0} max={100} step={1}
                value={formData.riskThreshold ?? 70}
                onChange={e => handleChange('riskThreshold', Number(e.target.value))}
                style={{ flex: 1 }} />
              <span style={{
                fontSize: '0.8rem', fontWeight: 700, minWidth: 32, textAlign: 'right',
                color: (formData.riskThreshold ?? 70) >= 70 ? '#EF4444' : (formData.riskThreshold ?? 70) >= 35 ? '#F59E0B' : '#10B981',
              }}>
                {formData.riskThreshold ?? 70}
              </span>
            </div>
          </div>
        )}

        {/* ── Message template ── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {mode === 'static' ? 'Message' : 'Message Template'}
            </label>
          </div>
          <textarea
            value={formData.messageTemplate || ''}
            onChange={e => handleChange('messageTemplate', e.target.value)}
            placeholder={
              mode === 'static'
                ? 'Enter your message. Use {field} tokens to embed data from the first entity.'
                : '⚠️ HVE-OS Alert\nEntity: {name}\nRisk Score: {_risk_score} ({_risk_level})\nHops: {_hops}'
            }
            style={{ ...inp, minHeight: 90, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.5 }}
          />
          {/* Variable chips — all modes */}
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginBottom: 4 }}>Quick insert:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {EXAMPLE_VARS.map(v => (
                <button key={v} onClick={() => insertVar(v)}
                  style={{ padding: '2px 7px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 4, fontSize: '0.6rem', color: 'var(--cyan)', cursor: 'pointer', fontFamily: 'monospace' }}>
                  {v}
                </button>
              ))}
            </div>
            <p style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {mode === 'static'
                ? <><code style={{ color: 'var(--cyan)' }}>{'{field}'}</code> tokens are resolved from the <strong>first entity</strong> in the input.</>
                : <><code style={{ color: 'var(--cyan)' }}>{'{field}'}</code> resolved per entity. Supports dot-notation: <code style={{ color: 'var(--cyan)' }}>{'{address.city}'}</code></>
              }
            </p>
          </div>
        </div>

      </div>
    );
  }
};

// ─── Rendered node ────────────────────────────────────────────────────────────
export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const mode      = data.sendMode   || 'highlighted';
  const channel   = data.channel    || 'sms';
  const threshold = data.riskThreshold ?? 70;
  const entities  = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);

  const sent    = entities.filter(e => e._twilio_status === 'sent').length;
  const failed  = entities.filter(e => e._twilio_status?.startsWith('failed')).length;
  const skipped = entities.filter(e => e._twilio_skipped).length;
  const pending = mode === 'risk_filter'
    ? entities.filter(e => (e._risk_score ?? 0) >= threshold).length
    : mode === 'highlighted' ? (entities.length > 0 ? 1 : 0)
    : entities.length;

  const modeObj  = MODES.find(m => m.key === mode) || MODES[0];
  const ModeIcon = modeObj.icon;
  const ChanIcon = channel === 'whatsapp' ? MessageSquare : channel === 'call' ? Phone : Send;

  // Top entity for highlighted mode display
  const topEntity = entities.length > 0
    ? entities.reduce((a, b) => (parseFloat(a._risk_score || 0) >= parseFloat(b._risk_score || 0) ? a : b))
    : null;

  const statusColor = failed > 0 ? '#EF4444' : sent > 0 ? '#10B981' : skipped > 0 ? '#F59E0B' : 'var(--text-muted)';

  return (
    <BaseNode
      label="Twilio Notify"
      icon={config.icon}
      type={config.type}
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color={config.color}
      collapsedInfo={
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.65rem' }}>
          <ModeIcon size={10} color={modeObj.color} />
          <ChanIcon size={10} color="var(--text-muted)" />
          <span style={{ color: statusColor }}>
            {sent > 0 ? `${sent} sent`
              : failed > 0 ? `${failed} failed`
              : skipped > 0 ? `skipped (unchanged)`
              : `${pending} queued`}
          </span>
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '6px 0' }}>

        {/* Mode + channel row */}
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1, padding: '4px 8px', background: `${modeObj.color}11`, border: `1px solid ${modeObj.color}44`, borderRadius: 5, fontSize: '0.6rem', color: modeObj.color, display: 'flex', alignItems: 'center', gap: 4 }}>
            <ModeIcon size={9} /> {modeObj.label}
          </div>
          <div style={{ padding: '4px 8px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 5, fontSize: '0.6rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ChanIcon size={9} /> {channel.toUpperCase()}
          </div>
        </div>

        {/* Highlighted entity summary */}
        {mode === 'highlighted' && topEntity && (
          <div style={{ padding: '6px 8px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
            <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginBottom: 2 }}>Top entity</div>
            <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                {topEntity.name || topEntity.title || topEntity._hve_id || 'Unknown'}
              </span>
              <span style={{ color: parseFloat(topEntity._risk_score || 0) >= 70 ? '#EF4444' : parseFloat(topEntity._risk_score || 0) >= 35 ? '#F59E0B' : '#10B981', fontWeight: 700, flexShrink: 0 }}>
                {topEntity._risk_score ?? '—'}
              </span>
            </div>
            {topEntity._twilio_status && (
              <div style={{ fontSize: '0.58rem', marginTop: 3, color: topEntity._twilio_status === 'sent' ? '#10B981' : topEntity._twilio_skipped ? '#F59E0B' : '#EF4444' }}>
                {topEntity._twilio_status === 'sent' ? `✓ Sent (SID: ${topEntity._twilio_sid?.slice(0,8)}…)` : topEntity._twilio_status}
              </div>
            )}
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ padding: '2px 7px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 4, fontSize: '0.58rem', color: 'var(--text-muted)' }}>
            {entities.length} in
          </span>
          {mode === 'risk_filter' && (
            <span style={{ padding: '2px 7px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, fontSize: '0.58rem', color: '#EF4444' }}>
              ≥{threshold}: {pending}
            </span>
          )}
          {sent > 0 && (
            <span style={{ padding: '2px 7px', background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 4, fontSize: '0.58rem', color: '#10B981' }}>
              ✓ {sent} sent
            </span>
          )}
          {skipped > 0 && (
            <span style={{ padding: '2px 7px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 4, fontSize: '0.58rem', color: '#F59E0B' }}>
              ⏭ unchanged
            </span>
          )}
          {failed > 0 && (
            <span style={{ padding: '2px 7px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, fontSize: '0.58rem', color: '#EF4444' }}>
              ✗ {failed} failed
            </span>
          )}
        </div>

        {/* Template preview */}
        {data.messageTemplate && (
          <div style={{ padding: '5px 8px', background: 'var(--bg-surface)', borderRadius: 5, border: '1px solid var(--border-subtle)', fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 44, overflow: 'hidden' }}>
            {data.messageTemplate.slice(0, 100)}{data.messageTemplate.length > 100 ? '…' : ''}
          </div>
        )}
      </div>

      <Handle type="target" position={Position.Left}  id="data" style={{ background: '#F22F46' }} />
      <Handle type="source" position={Position.Right} id="data" style={{ background: '#F22F46' }} />
    </BaseNode>
  );
});
