import React, { memo, useState, useEffect } from 'react';
import { Lock } from 'lucide-react';
import BaseNode from '../BaseNode';
import { discoverSecurityProviders } from '../../../../../../frontend/src/api/client';

export const config = {
  type: 'encryptNode',
  category: 'security',
  label: 'Encrypt',
  icon: Lock,
  color: 'var(--accent-red)',
  SettingsForm: ({ nodeId, formData, handleChange }) => {
    const [providers, setProviders] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      // Force the action to always be 'encrypt' for this node
      if (formData.action !== 'encrypt') {
        handleChange('action', 'encrypt');
      }

      discoverSecurityProviders()
        .then(data => {
          setProviders(data);
          setLoading(false);
          // Auto-select first available provider if none selected
          if (!formData.provider && Object.keys(data).length > 0) {
            handleChange('provider', Object.keys(data)[0]);
          }
        })
        .catch(err => {
          console.error("Failed to load security providers", err);
          setLoading(false);
        });
    }, []);

    const selectedProviderId = formData.provider;
    const providerMeta = providers[selectedProviderId];

    return (
      <>
        <div className="field">
          <label>Encryption Engine</label>
          {loading ? (
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Loading engines...</p>
          ) : (
            <select 
              value={selectedProviderId || ''} 
              onChange={(e) => handleChange('provider', e.target.value)}
            >
              {Object.entries(providers).map(([id, meta]) => (
                <option key={id} value={id} disabled={!meta.available}>
                  {meta.name} {!meta.available && '(Unavailable)'}
                </option>
              ))}
            </select>
          )}
        </div>

        {providerMeta && providerMeta.available && (
          <>
            <div className="field">
              <label>Target Field to Encrypt</label>
              <input 
                value={formData.field || ''} 
                onChange={(e) => handleChange('field', e.target.value)}
                placeholder="e.g. revenue"
              />
            </div>

            {/* Render dynamic parameters for encryption based on schema */}
            {providerMeta.params_schema && providerMeta.params_schema['encrypt'] && (
              <div style={{ padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4, marginTop: 8 }}>
                <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                  Encryption Parameters
                </p>
                {Object.entries(providerMeta.params_schema['encrypt']).map(([paramName, paramType]) => {
                  const paramValue = (formData.params && formData.params[paramName]) || '';
                  
                  return (
                    <div className="field" key={paramName} style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: '0.65rem' }}>{paramName}</label>
                      {Array.isArray(paramType) ? (
                        <select 
                          style={{ fontSize: '0.65rem', padding: '4px' }}
                          value={paramValue || paramType[0]}
                          onChange={(e) => {
                            const newParams = { ...(formData.params || {}), [paramName]: e.target.value };
                            handleChange('params', newParams);
                          }}
                        >
                          {paramType.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input 
                          style={{ fontSize: '0.65rem', padding: '4px' }}
                          type="text"
                          value={paramValue}
                          onChange={(e) => {
                            const newParams = { ...(formData.params || {}), [paramName]: e.target.value };
                            handleChange('params', newParams);
                          }}
                          placeholder={paramType}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </>
    );
  }
};

export default memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

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
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>
          Engine: <span style={{ color: 'var(--cyan)' }}>{data.provider || 'Unconfigured'}</span>
        </p>
        {data.field && (
          <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>
            Target: <span style={{ color: '#fff' }}>{data.field}</span>
          </p>
        )}
      </div>
    </BaseNode>
  );
});
