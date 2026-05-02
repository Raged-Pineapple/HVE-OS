import React, { memo, useState } from 'react';
import { Brain } from 'lucide-react';
import BaseNode from '../BaseNode';

export const config = {
  type: 'aiAnalysis',
  category: 'ai',
  label: 'AI Analysis',
  icon: Brain,
  color: 'var(--accent-purple)',
  SettingsForm: ({ formData, handleChange }) => (
    <>
      <div className="field">
        <label>AI Model</label>
        <select 
          value={formData.model || 'Kalman Filter'} 
          onChange={(e) => handleChange('model', e.target.value)}
        >
          <option>Kalman Filter</option>
          <option>Random Forest</option>
          <option>LSTM Neural Net</option>
          <option>Prophet Forecast</option>
        </select>
      </div>
      <div className="field">
        <label>Confidence Threshold ({formData.threshold || 0.8})</label>
        <input 
          type="range" 
          min="0" max="1" step="0.05"
          value={formData.threshold || 0.8}
          onChange={(e) => handleChange('threshold', parseFloat(e.target.value))}
        />
      </div>
    </>
  )
};

export default memo(({ data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <BaseNode
      label="AI Analysis"
      icon={Brain}
      type="ai"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color="var(--accent-purple)"
    >
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Model: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{data.model || 'Kalman Filter'}</span>
        </p>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          Confidence: <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{data.threshold || 0.8}</span>
        </p>
      </div>
    </BaseNode>
  );
});
