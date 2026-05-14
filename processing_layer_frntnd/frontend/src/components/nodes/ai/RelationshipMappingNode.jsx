import React, { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position, useEdges, useNodes, useReactFlow } from 'reactflow';
import { Network, X } from 'lucide-react';
import BaseNode from '../BaseNode';

// Do NOT modify this function - Golden standard for extracting upstream payload
const resolveUpstreamData = (incomingNodes) => {
  for (const n of incomingNodes) {
    if (!n.data) continue;
    const candidates = [n.data.data, n.data.extracted, n.data.resolvedEntity, n.data.pinned, n.data.unpinned];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) return c;
    }
    for (const c of candidates) {
      if (c && typeof c === 'object' && !Array.isArray(c)) return [c];
    }
  }
  return [];
};

export const config = {
  type: 'relationshipMappingNode',
  category: 'ai',
  label: 'Relationship Mapping',
  icon: Network,
  color: '#8B5CF6',
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const incomingEdges = edges.filter(e => e.target === nodeId);
    
    const [testStatus, setTestStatus] = useState(null);
    const [availableModels, setAvailableModels] = useState([]);
    const [fetchingModels, setFetchingModels] = useState(false);

    const sourceEdges = incomingEdges.filter(e => e.targetHandle === 'source_entity');
    const targetEdges = incomingEdges.filter(e => e.targetHandle === 'target_entity');

    const sourceNodes = sourceEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    const targetNodes = targetEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);

    const sourceAvailableKeys = new Set();
    const sourceDataList = resolveUpstreamData(sourceNodes);
    
    sourceDataList.forEach(item => {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach(k => sourceAvailableKeys.add(k));
      }
    });

    const targetAvailableKeys = new Set();
    const targetDataList = resolveUpstreamData(targetNodes);
    
    targetDataList.forEach(item => {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach(k => targetAvailableKeys.add(k));
      }
    });

    const sourceKeyOptions = Array.from(sourceAvailableKeys).sort();
    const targetKeyOptions = formData.interRelationship ? sourceKeyOptions : Array.from(targetAvailableKeys).sort();
    
    const sourceFields = formData.sourceFields || [];
    const targetFields = formData.targetFields || [];

    const addSourceField = (field) => {
      if (!field || sourceFields.includes(field)) return;
      handleChange('sourceFields', [...sourceFields, field]);
    };
    const removeSourceField = (field) => {
      handleChange('sourceFields', sourceFields.filter(f => f !== field));
    };

    const addTargetField = (field) => {
      if (!field || targetFields.includes(field)) return;
      handleChange('targetFields', [...targetFields, field]);
    };
    const removeTargetField = (field) => {
      handleChange('targetFields', targetFields.filter(f => f !== field));
    };

    const fetchModels = async (provider, apiKey) => {
      if (!apiKey) {
        setAvailableModels([]);
        return;
      }
      setFetchingModels(true);
      try {
        if (provider === 'mistral') {
          const url = `https://api.mistral.ai/v1/models`;
          const res = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
          if (res.ok) {
            const data = await res.json();
            const models = data.data.map(m => ({ id: m.id, label: m.id }));
            setAvailableModels(models);
          }
        } else {
          const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            const models = data.models
              ?.filter(m => m.supportedGenerationMethods?.includes("generateContent"))
              .map(m => ({ id: m.name.replace('models/', ''), label: m.displayName })) || [];
            setAvailableModels(models);
          }
        }
      } catch (err) {
        console.error(`Failed to fetch ${provider} models`, err);
      }
      setFetchingModels(false);
    };

    useEffect(() => {
      const provider = formData.aiProvider || 'gemini';
      const apiKey = provider === 'mistral' ? formData.mistralApiKey : formData.geminiApiKey;
      if (apiKey) {
        fetchModels(provider, apiKey);
      } else {
        setAvailableModels([]);
      }
    }, [formData.aiProvider]);

    const testConnection = async () => {
      const provider = formData.aiProvider || 'gemini';
      const apiKey = provider === 'mistral' ? formData.mistralApiKey : formData.geminiApiKey;
      
      if (!apiKey) {
        setTestStatus({ type: 'error', msg: 'API Key missing' });
        return;
      }
      setTestStatus({ type: 'loading', msg: 'Testing connection...' });
      try {
        await fetchModels(provider, apiKey);
        
        if (provider === 'mistral') {
          const model = formData.mistralModel || 'mistral-large-latest';
          const url = `https://api.mistral.ai/v1/chat/completions`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: "user", content: "Hello" }]
            })
          });
          
          if (res.ok) {
            setTestStatus({ type: 'success', msg: 'Connection successful!' });
          } else {
            const errData = await res.json();
            setTestStatus({ type: 'error', msg: errData.message || 'Connection failed' });
          }
        } else {
          const model = formData.geminiModel || 'gemini-2.5-flash';
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "Hello" }] }]
            })
          });
          
          if (res.ok) {
            setTestStatus({ type: 'success', msg: 'Connection successful!' });
          } else {
            const errData = await res.json();
            setTestStatus({ type: 'error', msg: errData.error?.message || 'Connection failed' });
          }
        }
      } catch (err) {
        setTestStatus({ type: 'error', msg: err.message });
      }
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', padding: '6px', background: 'var(--bg-base)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
          <span style={{ color: sourceEdges.length ? 'var(--emerald)' : 'var(--text-muted)' }}>● Source {sourceEdges.length ? 'Connected' : 'Missing'}</span>
          <span style={{ color: targetEdges.length ? 'var(--emerald)' : 'var(--text-muted)' }}>● Target {targetEdges.length ? 'Connected' : 'Missing'}</span>
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Relation Type</label>
          <input 
            type="text" 
            value={formData.relationType || 'RELATES_TO'}
            onChange={(e) => handleChange('relationType', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
            placeholder="e.g. WORKS_AT, OWNS"
          />
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>AI Provider</label>
          <select 
            value={formData.aiProvider || 'gemini'}
            onChange={(e) => {
              handleChange('aiProvider', e.target.value);
              setTestStatus(null);
            }}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          >
            <option value="gemini">Google Gemini</option>
            <option value="mistral">Mistral AI</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{formData.aiProvider === 'mistral' ? 'Mistral API Key' : 'Gemini API Key'}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input 
              type="password" 
              value={formData.aiProvider === 'mistral' ? (formData.mistralApiKey || '') : (formData.geminiApiKey || '')}
              onChange={(e) => handleChange(formData.aiProvider === 'mistral' ? 'mistralApiKey' : 'geminiApiKey', e.target.value)}
              style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
              placeholder={formData.aiProvider === 'mistral' ? "Enter Mistral API Key..." : "Enter Gemini API Key..."}
            />
            <button 
              onClick={testConnection}
              style={{ padding: '6px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.7rem', cursor: 'pointer' }}
            >
              Test
            </button>
          </div>
          {testStatus && (
            <p style={{ fontSize: '0.65rem', marginTop: 4, color: testStatus.type === 'success' ? 'var(--emerald)' : testStatus.type === 'error' ? '#ef4444' : 'var(--cyan)' }}>
              {testStatus.msg}
            </p>
          )}
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{formData.aiProvider === 'mistral' ? 'Mistral Model' : 'Gemini Model'}</span>
            {fetchingModels && <span style={{ color: 'var(--cyan)' }}>Loading...</span>}
          </label>
          <select 
            value={formData.aiProvider === 'mistral' ? (formData.mistralModel || 'mistral-large-latest') : (formData.geminiModel || 'gemini-2.5-flash')}
            onChange={(e) => handleChange(formData.aiProvider === 'mistral' ? 'mistralModel' : 'geminiModel', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
            disabled={fetchingModels}
          >
            {availableModels.length > 0 ? (
              availableModels.map(m => <option key={m.id} value={m.id}>{m.label} ({m.id})</option>)
            ) : (
              formData.aiProvider === 'mistral' ? (
                <>
                  <option value="mistral-large-latest">Mistral Large (mistral-large-latest)</option>
                  <option value="pixtral-12b-2409">Pixtral 12B (pixtral-12b-2409)</option>
                  <option value="ministral-8b-latest">Ministral 8B (ministral-8b-latest)</option>
                  <option value="mistral-small-latest">Mistral Small (mistral-small-latest)</option>
                </>
              ) : (
                <option value={formData.geminiModel || 'gemini-2.5-flash'}>{formData.geminiModel || 'gemini-2.5-flash'}</option>
              )
            )}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <input 
              type="checkbox" 
              checked={formData.interRelationship || false}
              onChange={(e) => handleChange('interRelationship', e.target.checked)}
            />
            <span style={{ color: 'var(--text-muted)' }}>Inter-Relationship (Map within source entities)</span>
          </label>
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--amber)', display: 'block', marginBottom: 4 }}>Source Attributes</label>
          <select 
            value=""
            onChange={(e) => addSourceField(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          >
            <option value="" disabled>-- Select source attribute --</option>
            {sourceKeyOptions.map(k => <option key={k} value={k} disabled={sourceFields.includes(k)}>{k}</option>)}
          </select>
          {sourceFields.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {sourceFields.map(field => (
                <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 16, fontSize: '0.7rem' }}>
                  <span style={{ color: 'var(--amber)' }}>{field}</span>
                  <button onClick={() => removeSourceField(field)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}><X size={10} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--cyan)', display: 'block', marginBottom: 4 }}>
            {formData.interRelationship ? 'Target Attributes (from Source)' : 'Target Attributes'}
          </label>
          <select 
            value=""
            onChange={(e) => addTargetField(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          >
            <option value="" disabled>-- Select target attribute --</option>
            {targetKeyOptions.map(k => <option key={k} value={k} disabled={targetFields.includes(k)}>{k}</option>)}
          </select>
          {targetFields.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {targetFields.map(field => (
                <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 16, fontSize: '0.7rem' }}>
                  <span style={{ color: 'var(--cyan)' }}>{field}</span>
                  <button onClick={() => removeTargetField(field)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}><X size={10} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const edges = useEdges();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();
  const prevInputRef = useRef(undefined);

  // The previewInput Sync Hook for UI isolation runs
  useEffect(() => {
    // Only pass the Source Entity schema downstream to respect Pass-Through Lineage
    const sourceEdges = edges.filter(e => e.target === id && e.targetHandle === 'source_entity');
    const sourceNodes = sourceEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    
    const dataList = resolveUpstreamData(sourceNodes);
    const sampleEntity = dataList.length > 0 ? dataList[0] : null;

    if (sampleEntity) {
      const serialised = JSON.stringify(sampleEntity);
      if (prevInputRef.current !== serialised) {
        prevInputRef.current = serialised;
        setNodes(nds => nds.map(n => 
          n.id === id ? { ...n, data: { ...n.data, previewInput: sampleEntity } } : n
        ));
      }
    }
  }, [edges, id, nodes, setNodes]);

  const isSourceConnected = edges.some(e => e.target === id && e.targetHandle === 'source_entity');
  const isTargetConnected = edges.some(e => e.target === id && e.targetHandle === 'target_entity');

  return (
    <BaseNode
      label={config.label}
      icon={config.icon}
      type={config.type}
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color={config.color}
      hideDefaultSource={true}
      hideDefaultTarget={true}
      collapsedInfo={
        <span style={{ color: 'var(--cyan)' }}>{data.relationType || 'RELATES_TO'}</span>
      }
    >
      {/* Separated Input Connectors */}
      <Handle type="target" position={Position.Left} id="source_entity" style={{ left: -6, top: '30%', background: 'var(--amber)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
      <Handle type="target" position={Position.Left} id="target_entity" style={{ left: -6, top: '70%', background: 'var(--cyan)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
      
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
           <span style={{ fontSize: '0.6rem', color: 'var(--amber)' }}>● Source: <span style={{ color: isSourceConnected ? 'var(--emerald)' : 'var(--text-muted)' }}>{isSourceConnected ? 'Connected' : 'Missing'}</span></span>
           <span style={{ fontSize: '0.6rem', color: 'var(--cyan)' }}>● Target: <span style={{ color: isTargetConnected ? 'var(--emerald)' : 'var(--text-muted)' }}>{isTargetConnected ? 'Connected' : 'Missing'}</span></span>
        </div>

        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>
          Relation: <span style={{ color: 'var(--cyan)' }}>{data.relationType || 'RELATES_TO'}</span>
        </p>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0, marginTop: 4 }}>
          Provider: <span style={{ color: '#fff' }}>{data.aiProvider === 'mistral' ? 'Mistral' : 'Gemini'}</span>
        </p>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0, marginTop: 4 }}>
          Model: <span style={{ color: '#fff' }}>{data.aiProvider === 'mistral' ? (data.mistralModel || 'mistral-large-latest') : (data.geminiModel || 'gemini-2.5-flash')}</span>
        </p>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0, marginTop: 4 }}>
          Source: <span style={{ color: '#fff' }}>{(data.sourceFields || []).join(', ') || 'None'}</span>
        </p>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0, marginTop: 2 }}>
          Target: <span style={{ color: '#fff' }}>{(data.targetFields || []).join(', ') || 'Entire Payload'}</span>
        </p>
      </div>
      
      <Handle type="source" position={Position.Right} id="data" style={{ right: -6, top: '50%', background: 'var(--cyan)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
    </BaseNode>
  );
});