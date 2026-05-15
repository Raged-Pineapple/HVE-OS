import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { ShieldCheck, Pin, PinOff, Search, MessageSquare, ArrowLeft, Send } from 'lucide-react';
import BaseNode from '../BaseNode';

const getEntityName = (entity, displayProperty) => {
  if (!displayProperty) {
    return entity.name || entity.title || entity.id || entity._hve_id || 'Unknown';
  }
  const parts = displayProperty.split('.');
  let current = entity;
  for (const part of parts) {
    if (current === null || current === undefined) break;
    current = current[part];
  }
  return typeof current === 'string' || typeof current === 'number' ? String(current) : (entity.name || entity.title || entity._hve_id || 'Unknown');
};

const formatMarkdown = (text) => {
  if (!text) return null;
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
};

export const config = {
  type: 'mitigationNode',
  category: 'ai',
  label: 'Mitigation Strategies',
  icon: ShieldCheck,
  color: '#8B5CF6',
  hideInSidebar: false,
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('all');
    const [testStatus, setTestStatus] = useState(null);
    const [availableModels, setAvailableModels] = useState([]);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [selectedChatEntity, setSelectedChatEntity] = useState(null);
    const [chatMessage, setChatMessage] = useState('');
    const [isSending, setIsSending] = useState(false);

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

    React.useEffect(() => {
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

    const availableKeys = new Set();
    const allData = Array.isArray(formData.data) ? formData.data : (formData.data ? [formData.data] : []);
    
    allData.forEach(item => {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach(k => availableKeys.add(k));
      }
    });
    const keyOptions = Array.from(availableKeys).sort();

    const highRisk = allData.filter(e => e._risk_level === 'HIGH' || e._risk_score >= 70);
    const mediumRisk = allData.filter(e => e._risk_level === 'MEDIUM' || (e._risk_score >= 35 && e._risk_score < 70));
    const lowRisk = allData.filter(e => e._risk_level === 'LOW' || (e._risk_score !== undefined && e._risk_score < 35));

    const riskTabs = [
      { key: 'all', label: 'All Data', data: allData, color: 'var(--text-primary)' },
      { key: 'high', label: 'High', data: highRisk, color: '#EF4444' },
      { key: 'medium', label: 'Medium', data: mediumRisk, color: '#F59E0B' },
      { key: 'low', label: 'Low', data: lowRisk, color: '#10B981' }
    ];

    const activeData = riskTabs.find(t => t.key === activeTab)?.data || [];
    const filteredData = activeData.filter(e => getEntityName(e, formData.displayNameProperty).toLowerCase().includes(searchTerm.toLowerCase()));

    const handleSendMessage = async () => {
      if (!chatMessage.trim() || !selectedChatEntity) return;
      const provider = formData.aiProvider || 'gemini';
      const apiKey = provider === 'mistral' ? formData.mistralApiKey : formData.geminiApiKey;
      if (!apiKey) {
        alert("Please set your API key first.");
        return;
      }

      const entityName = getEntityName(selectedChatEntity, formData.displayNameProperty);
      const currentHistory = (formData.chatHistories || {})[entityName] || [];
      const newHistory = [...currentHistory, { role: 'user', content: chatMessage }];
      
      const newHistories = { ...(formData.chatHistories || {}), [entityName]: newHistory };
      handleChange('chatHistories', newHistories);
      setChatMessage('');
      setIsSending(true);

      const sysPrompt = `Business Context: ${formData.businessContext || 'None provided.'}\n\nYou are analyzing a high risk entity.\nEntity Name: ${entityName}\nRisk Score: ${selectedChatEntity._risk_score || 'Unknown'}\nPath Trace: ${JSON.stringify(selectedChatEntity._path_trace || [])}\n\nAct as a risk mitigation expert. Provide actionable strategies based on the above context.`;

      try {
        let aiResponseText = '';
        if (provider === 'mistral') {
          const model = formData.mistralModel || 'mistral-large-latest';
          const messages = [{ role: 'system', content: sysPrompt }, ...newHistory];
          const res = await fetch(`https://api.mistral.ai/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages, temperature: 0.2 })
          });
          if (res.ok) {
            const data = await res.json();
            aiResponseText = data.choices[0]?.message?.content || 'No response';
          } else {
            const errData = await res.json().catch(() => ({}));
            aiResponseText = `**API Error ${res.status}**: ${errData.error?.message || errData.message || res.statusText}`;
          }
        } else {
          const model = formData.geminiModel || 'gemini-2.5-flash';
          const contents = newHistory.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
          contents.unshift({ role: 'user', parts: [{ text: `SYSTEM INSTRUCTION: ${sysPrompt}\n\nUnderstand the context above, then respond to my messages.` }] });
          contents.push({ role: 'model', parts: [{ text: "Understood." }] }); // mock response to sys prompt
          
          // Re-map actual history
          newHistory.forEach(m => contents.push({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));

          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents, generationConfig: { temperature: 0.2 } })
          });
          if (res.ok) {
            const data = await res.json();
            aiResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
          } else {
            const errData = await res.json().catch(() => ({}));
            aiResponseText = `**API Error ${res.status}**: ${errData.error?.message || errData.message || res.statusText}`;
          }
        }
        
        handleChange('chatHistories', {
          ...newHistories,
          [entityName]: [...newHistory, { role: 'ai', content: aiResponseText }]
        });
      } catch (err) {
        handleChange('chatHistories', {
          ...newHistories,
          [entityName]: [...newHistory, { role: 'ai', content: `Request failed: ${err.message}` }]
        });
      }
      setIsSending(false);
    };

    if (selectedChatEntity) {
      const entityName = getEntityName(selectedChatEntity, formData.displayNameProperty);
      const history = (formData.chatHistories || {})[entityName] || [];

      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 300 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
            <button 
              onClick={() => setSelectedChatEntity(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>Chat: {entityName}</div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Risk Score: {selectedChatEntity._risk_score || 'N/A'}</div>
            </div>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, paddingRight: 4 }}>
            {history.length === 0 && (
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 20 }}>
                Ask for a specific mitigation strategy. The AI knows your business context and the exact path trace for this entity.
              </div>
            )}
            {history.map((msg, idx) => (
              <div key={idx} style={{ 
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                background: msg.role === 'user' ? 'var(--cyan)' : 'var(--bg-elevated)',
                color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                padding: '6px 10px', borderRadius: 8, fontSize: '0.7rem', maxWidth: '85%',
                whiteSpace: 'pre-wrap', lineHeight: 1.4, border: msg.role !== 'user' ? '1px solid var(--border-subtle)' : 'none'
              }}>
                {formatMarkdown(msg.content)}
              </div>
            ))}
            {isSending && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>AI is thinking...</div>}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
            <input 
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(); }}
              placeholder="Ask for a mitigation strategy..."
              style={{ flex: 1, padding: '6px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 16, color: 'var(--text-primary)', fontSize: '0.7rem' }}
            />
            <button 
              onClick={handleSendMessage}
              disabled={isSending || !chatMessage.trim()}
              style={{ background: 'var(--cyan)', color: '#fff', border: 'none', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: (isSending || !chatMessage.trim()) ? 'not-allowed' : 'pointer', opacity: (isSending || !chatMessage.trim()) ? 0.5 : 1 }}
            >
              <Send size={12} />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* AI Config */}
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
              placeholder={`Enter ${formData.aiProvider === 'mistral' ? 'Mistral' : 'Gemini'} API Key`}
            />
            <button 
              onClick={(e) => { e.preventDefault(); testConnection(); }}
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
                  <option value="mistral-large-latest">Mistral Large</option>
                  <option value="mistral-medium-latest">Mistral Medium</option>
                  <option value="mistral-small-latest">Mistral Small</option>
                </>
              ) : (
                <>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                </>
              )
            )}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Display Name Property</label>
          <select 
            value={formData.displayNameProperty || ''}
            onChange={(e) => handleChange('displayNameProperty', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          >
            <option value="">-- Default (name, id, title) --</option>
            {keyOptions.map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Business Context (For AI)</label>
          <textarea 
            value={formData.businessContext || ''}
            onChange={(e) => handleChange('businessContext', e.target.value)}
            placeholder="e.g. We are a logistics company prioritizing fast delivery. Describe operational constraints here..."
            style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.75rem', minHeight: 60, resize: 'vertical' }}
          />
        </div>

        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={!!formData.autoGenerate}
              onChange={(e) => handleChange('autoGenerate', e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Auto-Generate Strategies on Execution
          </label>
          <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4, marginLeft: 18 }}>
            If disabled, the backend will skip expensive batch generations. You can still generate strategies manually using Chat.
          </p>
        </div>

        {/* List UI */}
        <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
            {riskTabs.map(tab => (
              <div
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '4px 8px',
                  fontSize: '0.65rem',
                  cursor: 'pointer',
                  borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : '2px solid transparent',
                  color: activeTab === tab.key ? tab.color : 'var(--text-muted)',
                  fontWeight: activeTab === tab.key ? 600 : 400
                }}
              >
                {tab.label} ({tab.data.length})
              </div>
            ))}
          </div>

          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
            <input 
              placeholder="Search entities..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '6px 8px 6px 26px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.75rem' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {(formData.selectedEntities || []).length} Selected for Mitigation
            </span>
            <div style={{ display: 'flex', gap: 8, fontSize: '0.6rem' }}>
              <span onClick={(e) => { 
                  e.preventDefault(); 
                  const currentSelected = new Set(formData.selectedEntities || []);
                  filteredData.forEach(ent => currentSelected.add(getEntityName(ent, formData.displayNameProperty)));
                  handleChange('selectedEntities', Array.from(currentSelected));
                }} style={{ color: 'var(--cyan)', cursor: 'pointer', fontWeight: 600 }}>Select All</span>
              <span onClick={(e) => { 
                  e.preventDefault(); 
                  const currentSelected = new Set(formData.selectedEntities || []);
                  filteredData.forEach(ent => currentSelected.delete(getEntityName(ent, formData.displayNameProperty)));
                  handleChange('selectedEntities', Array.from(currentSelected));
                }} style={{ color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}>Deselect All</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
            {filteredData.map((entity, idx) => {
              const name = getEntityName(entity, formData.displayNameProperty);
              const isSelected = (formData.selectedEntities || []).includes(name);
              
              return (
                <div 
                  key={`sel-${idx}-${name}`}
                  onClick={() => {
                    const currentSelected = formData.selectedEntities || [];
                    if (isSelected) {
                      handleChange('selectedEntities', currentSelected.filter(n => n !== name));
                    } else {
                      handleChange('selectedEntities', [...currentSelected, name]);
                    }
                  }}
                  style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: '0.7rem', 
                    color: isSelected ? 'var(--cyan)' : 'var(--text-primary)', 
                    cursor: 'pointer', padding: '6px 10px', borderRadius: 6,
                    background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface)',
                    border: `1px solid ${isSelected ? 'var(--cyan)' : 'var(--border-subtle)'}`,
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 600 : 400, flex: 1 }}>
                        {name}
                        {entity._risk_score !== undefined && (
                          <span style={{ marginLeft: 8, fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                            Risk: {entity._risk_score}
                          </span>
                        )}
                      </span>
                    </div>
                    {entity._mitigation_strategy && (
                      <div style={{ 
                        marginTop: 4, padding: '6px 8px', background: 'rgba(139, 92, 246, 0.08)', 
                        borderLeft: '2px solid var(--purple)', borderRadius: 4, fontSize: '0.65rem',
                        color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.4 
                      }}>
                        <strong style={{ color: 'var(--purple)', display: 'block', marginBottom: 2 }}>Recommended Mitigation Strategy:</strong>
                        {formatMarkdown(entity._mitigation_strategy)}
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setSelectedChatEntity(entity); }}
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: 4, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      title="Chat about this risk"
                    >
                      <MessageSquare size={12} />
                    </button>
                    {isSelected ? <Pin size={12} fill="var(--cyan)" color="var(--cyan)" style={{ flexShrink: 0 }} /> : <PinOff size={12} color="var(--text-muted)" style={{ flexShrink: 0, opacity: 0.5 }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
};

const resolveUpstreamData = (incomingEdges, nodes) => {
  for (const e of incomingEdges) {
    const n = nodes.find(node => node.id === e.source);
    if (!n || !n.data) continue;
    
    // Strictly respect the output handle that was explicitly wired by the user
    if (e.sourceHandle && n.data[e.sourceHandle]) {
      const specificData = n.data[e.sourceHandle];
      if (Array.isArray(specificData) && specificData.length > 0) return specificData;
      if (typeof specificData === 'object' && !Array.isArray(specificData)) return [specificData];
    }

    // Fallback if handle wasn't specific or was empty
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

export default memo(({ id, data, selected, edges, nodes, setNodes }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Sync upstream data
  const prevInputRef = React.useRef(undefined);
  React.useEffect(() => {
    if (!edges || !nodes || !setNodes) return;
    const incomingEdges = edges.filter(e => e.target === id);
    const dataList = resolveUpstreamData(incomingEdges, nodes);
    
    if (dataList.length > 0) {
      const serialised = JSON.stringify(dataList);
      if (prevInputRef.current !== serialised) {
        prevInputRef.current = serialised;
        setNodes(nds => nds.map(n => {
          if (n.id === id) {
            return { ...n, data: { ...n.data, data: dataList } };
          }
          return n;
        }));
      }
    }
  }, [edges, nodes, id, setNodes]);

  const inputData = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
  const selectedCount = (data.selectedEntities || []).length;

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
      collapsedInfo={<span style={{ color: 'var(--cyan)' }}>{selectedCount} selected for Mitigation</span>}
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        
        {/* Input Handle */}
        <Handle type="target" position={Position.Left} id="data" style={{ left: -6 }} />
        
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 8 }}>
          Entities available: <strong style={{ color: 'var(--text-primary)' }}>{inputData.length}</strong>
        </div>
        
        {selectedCount > 0 && (
          <div style={{ padding: '6px 8px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 6, marginBottom: 8 }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--cyan)', fontWeight: 600 }}>
              {selectedCount} entities selected for AI strategy generation
            </span>
          </div>
        )}

        {/* Output Handle */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ marginRight: '8px', color: 'var(--text-main)', fontSize: '0.75rem' }}>Data</span>
          <Handle type="source" position={Position.Right} id="data" style={{ right: -6 }} />
        </div>
        
      </div>
    </BaseNode>
  );
});
