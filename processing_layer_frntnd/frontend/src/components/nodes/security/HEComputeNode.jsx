import React, { memo, useState, useEffect } from 'react';
import { Sigma } from 'lucide-react';
import BaseNode from '../BaseNode';
import { discoverSecurityProviders } from '../../../api/client';

export const config = {
  type: 'heComputeNode',
  category: 'security',
  label: 'HE Compute',
  icon: Sigma,
  color: 'var(--accent-blue)',
  SettingsForm: ({ nodeId, formData, handleChange }) => {
    const [providers, setProviders] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      if (formData.action !== 'compute') {
        handleChange('action', 'compute');
      }

      discoverSecurityProviders()
        .then(data => {
          setProviders(data);
          setLoading(false);
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
          <label>Computation Engine</label>
          {loading ? (
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Loading engines...</p>
          ) : (
            <select 
              value={selectedProviderId || ''} 
              onChange={(e) => handleChange('provider', e.target.value)}
            >
              {Object.entries(providers).map(([id, meta]) => (
                <option key={id} value={id} disabled={!meta.available || !meta.operations.includes('compute')}>
                  {meta.name} {!meta.available && '(Unavailable)'}
                </option>
              ))}
            </select>
          )}
        </div>

        {providerMeta && providerMeta.available && (
          <>
            <div className="field">
              <label>Operation</label>
              <select 
                value={formData.operation || 'sum'} 
                onChange={(e) => handleChange('operation', e.target.value)}
              >
                {providerMeta.computations ? (
                  providerMeta.computations.map(op => <option key={op} value={op}>{op.toUpperCase()}</option>)
                ) : (
                  <>
                    <option value="sum">SUM</option>
                    <option value="multiply">MULTIPLY</option>
                  </>
                )}
              </select>
            </div>

            <div className="field">
              <label>Input Field A (Encrypted)</label>
              <input 
                value={formData.field_a || ''} 
                onChange={(e) => handleChange('field_a', e.target.value)}
                placeholder="e.g. encrypted_revenue_2023"
              />
            </div>

            <div className="field">
              <label>Input Field B (Encrypted)</label>
              <input 
                value={formData.field_b || ''} 
                onChange={(e) => handleChange('field_b', e.target.value)}
                placeholder="e.g. encrypted_revenue_2024"
              />
            </div>

            <div className="field">
              <label>Target Result Field</label>
              <input 
                value={formData.target_field || ''} 
                onChange={(e) => handleChange('target_field', e.target.value)}
                placeholder="e.g. encrypted_total_revenue"
              />
            </div>
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
          Op: <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{data.operation?.toUpperCase() || 'SUM'}</span>
        </p>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>
          Engine: <span style={{ color: 'var(--cyan)' }}>{data.provider || 'TenSEAL'}</span>
        </p>
      </div>
    </BaseNode>
  );
});
