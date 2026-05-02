import React, { useState, useEffect } from 'react';
import { X, Settings, Info, Save } from 'lucide-react';
import { nodeRegistry } from './nodes/registry.js';

export default function SettingsPanel({ node, nodes, edges, onClose, onUpdate }) {
  const [formData, setFormData] = useState(node?.data || {});

  useEffect(() => {
    setFormData(node?.data || {});
  }, [node]);

  if (!node) return null;

  const handleChange = (field, value) => {
    const updatedData = { ...formData, [field]: value };
    setFormData(updatedData);
    onUpdate(node.id, updatedData);
  };

  const nodeConfig = nodeRegistry.find(n => n.type === node.type);
  const SettingsForm = nodeConfig?.SettingsForm;

  return (
    <aside className="settings-panel" style={{
      width: '320px',
      height: '100%',
      background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 20,
      boxShadow: '-4px 0 16px rgba(0,0,0,0.2)',
      animation: 'slideIn 0.3s ease'
    }}>
      <div style={{ 
        padding: '20px', 
        borderBottom: '1px solid var(--border-subtle)', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Settings size={18} color="var(--cyan)" />
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Node Settings</h2>
        </div>
        <button 
          onClick={onClose} 
          className="btn btn-ghost" 
          style={{ padding: '4px', borderRadius: '6px' }}
        >
          <X size={20} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.05em' }}>Node Info</p>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>ID</span>
              <span style={{ fontSize: '0.75rem', fontFamily: 'JetBrains Mono', color: 'var(--text-primary)' }}>{node.id}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Type</span>
              <span className="badge" style={{ fontSize: '0.65rem', textTransform: 'uppercase' }}>{node.type}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: -12, letterSpacing: '0.05em' }}>Configuration</p>
          
          {/* Common Settings: Label/ID */}
          <div className="field">
            <label>Reference Name</label>
            <input 
              value={formData.id || ''} 
              onChange={(e) => handleChange('id', e.target.value)}
              placeholder="e.g. flight_001"
            />
          </div>

          {/* Node Specific Settings */}
          {SettingsForm && (
            <SettingsForm 
              nodeId={node.id}
              formData={formData} 
              handleChange={handleChange} 
              nodes={nodes} 
              edges={edges} 
            />
          )}
        </div>
      </div>

      <div style={{ padding: '20px', borderTop: '1px solid var(--border-subtle)' }}>
        <button 
          className="btn btn-primary" 
          style={{ width: '100%', justifyContent: 'center', gap: 8 }}
          onClick={onClose}
        >
          <Save size={16} />
          Save & Close
        </button>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}} />
    </aside>
  );
}
