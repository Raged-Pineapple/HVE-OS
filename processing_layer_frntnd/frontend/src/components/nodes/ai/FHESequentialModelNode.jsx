import React, { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position, useEdges, useNodes, useReactFlow } from 'reactflow';
import { Cpu, Activity, Database, Flame, Clock, X, Cloud } from 'lucide-react';
import BaseNode from '../BaseNode';

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
    if (Array.isArray(n.data.rows) && n.data.rows.length > 0) {
      return n.data.rows;
    }
    if (Array.isArray(n.data.columns)) {
      return [];
    }
  }
  return [];
};

export const config = {
  type: 'fheSequentialModelNode',
  category: 'ai',
  label: 'FHE Sequential Model',
  icon: Cpu,
  color: 'var(--accent-purple, #8B5CF6)',
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const isTraining = formData.isTraining || false;
    const [availableFields, setAvailableFields] = useState([]);
    
    const [localFeatures, setLocalFeatures] = useState(formData.features || []);
    const localFeaturesRef = useRef(localFeatures);

    useEffect(() => {
      localFeaturesRef.current = localFeatures;
    }, [localFeatures]);

    useEffect(() => {
      const currentFeatures = formData.features || [];
      if (JSON.stringify(currentFeatures) !== JSON.stringify(localFeaturesRef.current)) {
        setLocalFeatures(currentFeatures);
      }
    }, [formData.features]);

    const handleLocalFeaturesChange = (newFeatures) => {
      setLocalFeatures(newFeatures);
      handleChange('features', newFeatures);
    };

    // Listen for backend to finish processing (when r2 is available, training is finished)
    const metrics = formData.metrics || formData.metadata?.last_training_result?.metrics;
    const modelInfo = formData.model_info || formData.metadata?.last_training_result?.model_info;



    // Discover available fields from upstream snapshot data
    useEffect(() => {
      let detectedFields = [];
      const previewData = formData?.previewInput;
      if (Array.isArray(previewData) && previewData.length > 0) {
        detectedFields = Object.keys(previewData[0]);
      } else if (previewData && typeof previewData === 'object' && !Array.isArray(previewData)) {
        detectedFields = Object.keys(previewData);
      }
      
      if (detectedFields.length === 0 && Array.isArray(formData?.columns)) {
        detectedFields = formData.columns;
      }
      
      setAvailableFields(detectedFields);
    }, [formData?.previewInput, formData?.columns]);

    const handleTrainClick = () => {
      handleChange({
        features: localFeatures,
        isTraining: true,
        metrics: null,
        model_info: null,
        success: null,
        error: null,
        _execute_trigger: Date.now()
      });
      
      // Safety fallback
      setTimeout(() => {
        handleChange('isTraining', false);
      }, 60000);
    };

    const isActivelyTraining = isTraining || (metrics && metrics.current_epoch && metrics.r2 === undefined);

    return (
      <>
        {/* 1. Group By Column */}
        <div className="field" style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Group By Column (e.g. callsign, device_id)
          </label>
          {availableFields.length > 0 ? (
            <select
              value={formData.groupBy || ''}
              onChange={(e) => handleChange('groupBy', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)', outline: 'none' }}
            >
              <option value="" style={{ background: 'var(--bg-surface, #1e1e2e)', color: 'var(--text-primary, #ffffff)' }}>-- None (Single Continuous Sequence) --</option>
              {availableFields.map(f => (
                <option key={f} value={f} style={{ background: 'var(--bg-surface, #1e1e2e)', color: 'var(--text-primary, #ffffff)' }}>{f}</option>
              ))}
            </select>
          ) : (
            <input 
              type="text" 
              placeholder="e.g. callsign"
              value={formData.groupBy || ''} 
              onChange={(e) => handleChange('groupBy', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
            />
          )}
        </div>

        {/* 2. Feature Columns Selector */}
        <div className="field" style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Training Features (Numeric Predictors)
          </label>
          {availableFields.length > 0 ? (
            <select
              value=""
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return;
                const current = new Set(localFeatures);
                current.add(val);
                handleLocalFeaturesChange(Array.from(current));
              }}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)', fontSize: '0.75rem', outline: 'none' }}
            >
              <option value="" style={{ background: 'var(--bg-surface, #1e1e2e)', color: 'var(--text-primary, #ffffff)' }}>-- Add a feature column --</option>
              {availableFields
                .filter(f => !localFeatures.includes(f))
                .map(f => (
                  <option key={f} value={f} style={{ background: 'var(--bg-surface, #1e1e2e)', color: 'var(--text-primary, #ffffff)' }}>{f}</option>
                ))}
            </select>
          ) : (
            <input 
              type="text" 
              placeholder="e.g. longitude, latitude"
              value={localFeatures.join(', ')} 
              onChange={(e) => handleLocalFeaturesChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
            />
          )}

          {localFeatures.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {localFeatures.map(f => (
                <div key={f} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(139, 92, 246, 0.15)',
                  border: '1px solid rgba(139, 92, 246, 0.4)',
                  color: '#c084fc',
                  padding: '4px 8px', borderRadius: 6, fontSize: '0.65rem'
                }}>
                  <span style={{ fontWeight: 600 }}>{f}</span>
                  <X 
                    size={12} 
                    style={{ cursor: 'pointer', opacity: 0.8, marginLeft: 4 }} 
                    onClick={() => {
                      const current = new Set(localFeatures);
                      current.delete(f);
                      handleLocalFeaturesChange(Array.from(current));
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. Standard model parameters */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
          <div className="field">
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Seq Length
            </label>
            <input 
              type="number" 
              min="1" max="10"
              value={formData.sequenceLength || 2} 
              onChange={(e) => handleChange('sequenceLength', parseInt(e.target.value) || 2)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
            />
          </div>

          <div className="field">
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Hidden Dim
            </label>
            <input 
              type="number" 
              min="2" max="64"
              value={formData.hiddenDim || 8} 
              onChange={(e) => handleChange('hiddenDim', parseInt(e.target.value) || 8)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
          <div className="field">
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Epochs
            </label>
            <input 
              type="number" 
              min="1" max="1000"
              value={formData.epochs || 100} 
              onChange={(e) => handleChange('epochs', parseInt(e.target.value) || 100)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
            />
          </div>

          <div className="field">
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Batch Size
            </label>
            <input 
              type="number" 
              min="4" max="256" step="4"
              value={formData.batchSize || 32} 
              onChange={(e) => handleChange('batchSize', parseInt(e.target.value) || 32)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
          <div className="field">
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Learning Rate
            </label>
            <input 
              type="number" 
              step="0.0001" min="0.0001" max="0.1"
              value={formData.learningRate || 0.001} 
              onChange={(e) => handleChange('learningRate', parseFloat(e.target.value) || 0.001)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
            />
          </div>

          <div className="field">
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Save Checkpoint
            </label>
            <input 
              type="text" 
              placeholder="real_fhe_flight_model.pt"
              value={formData.modelSavePath || 'real_fhe_flight_model.pt'} 
              onChange={(e) => handleChange('modelSavePath', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <button
          onClick={handleTrainClick}
          disabled={isActivelyTraining || !formData.previewInput || localFeatures.length === 0}
          className="btn btn-primary"
          style={{
            marginTop: 16,
            width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'var(--accent-purple, #8B5CF6)',
            borderColor: 'var(--accent-purple, #8B5CF6)',
            opacity: isActivelyTraining || !formData.previewInput || localFeatures.length === 0 ? 0.7 : 1
          }}
        >
          {isActivelyTraining ? (
            <><span className="spinner" style={{ width: 14, height: 14 }} /> Training model...</>
          ) : (
            <><Cpu size={14} /> Run Training</>
          )}
        </button>

        {isActivelyTraining && (
          <button
            onClick={() => {
              handleChange({
                isTraining: false,
                _cancel_trigger: Date.now(),
                error: "Training cancelled by user."
              });
            }}
            className="btn"
            style={{
              marginTop: 10,
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: '#ef4444',
              borderColor: '#ef4444',
              color: '#ffffff'
            }}
          >
            <X size={14} /> Cancel Training
          </button>
        )}

        {/* Dynamic Training Outcomes and S3 minio upload state */}
        {metrics && (
          <div style={{
            marginTop: 20,
            padding: 12,
            borderRadius: 6,
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
            background: 'var(--bg-card, rgba(255,255,255,0.02))'
          }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-purple, #8B5CF6)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={14} style={{ animation: isActivelyTraining ? 'spin 2s linear infinite' : 'none' }} /> 
              {isActivelyTraining ? 'Active Training Monitor' : 'Training Outcomes & Uploads'}
            </h4>

            {/* Real-time Monitor if actively training */}
            {isActivelyTraining && metrics.current_epoch ? (
              <div style={{ marginBottom: 12, padding: 10, borderRadius: 4, background: 'rgba(139, 92, 246, 0.05)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Epoch Tick:</span>
                  <span style={{ fontWeight: 700, color: 'var(--accent-purple, #8B5CF6)' }}>
                    {metrics.current_epoch} / {metrics.epochs || 100}
                  </span>
                </div>
                
                {/* Progress bar */}
                <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.05)', overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    width: `${((metrics.current_epoch) / (metrics.epochs || 100)) * 100}%`,
                    height: '100%',
                    background: 'var(--accent-purple, #8B5CF6)',
                    transition: 'width 0.15s linear'
                  }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Mean Loss:</span>
                  <span style={{ fontWeight: 600, color: 'var(--orange, #F59E0B)', fontFamily: 'monospace' }}>
                    {metrics.epoch_loss ? metrics.epoch_loss.toFixed(6) : 'Calculating...'}
                  </span>
                </div>
              </div>
            ) : metrics.r2 !== undefined ? (
              /* Completed Metrics Cards */
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ padding: '6px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>R² Accuracy</span>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--green, #10B981)' }}>{metrics.r2 !== undefined && metrics.r2 !== null ? metrics.r2.toFixed(4) : 'N/A'}</div>
                </div>
                <div style={{ padding: '6px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>MSE Loss</span>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--orange, #F59E0B)' }}>{metrics.mse !== undefined && metrics.mse !== null ? metrics.mse.toFixed(6) : 'N/A'}</div>
                </div>
                <div style={{ padding: '6px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>Train Time</span>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--cyan, #06B6D4)' }}>{metrics.training_time_s !== undefined && metrics.training_time_s !== null ? `${metrics.training_time_s.toFixed(2)}s` : 'N/A'}</div>
                </div>
                <div style={{ padding: '6px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>Epochs</span>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{metrics.epochs || 100}</div>
                </div>
              </div>
            ) : null}

            {/* Checkpoint Destination in MinIO */}
            {!isActivelyTraining && modelInfo?.minio_path && (
              <div style={{ marginBottom: 12, padding: 8, borderRadius: 4, background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <Cloud size={14} style={{ color: 'var(--green, #10B981)', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', display: 'block' }}>MinIO Bucket Destination:</span>
                  <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--green, #10B981)', wordBreak: 'break-all' }}>{modelInfo.minio_path}</span>
                </div>
              </div>
            )}

            {/* Epoch Loss progression scrollable list */}
            {Array.isArray(metrics.epoch_losses) && metrics.epoch_losses.length > 0 && (
              <div>
                <span style={{ fontSize: '0.68rem', fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Epoch Loss Progression:</span>
                <div style={{
                  maxHeight: 120,
                  overflowY: 'auto',
                  borderRadius: 4,
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                  background: 'rgba(0,0,0,0.15)',
                  padding: '4px 8px',
                  fontFamily: 'monospace',
                  fontSize: '0.68rem'
                }}>
                  {metrics.epoch_losses.map((loss, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Epoch {idx + 1}:</span>
                      <span style={{ color: 'var(--orange, #F59E0B)', fontWeight: 600 }}>{loss.toFixed(6)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </>
    );
  }
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const edges = useEdges();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();
  const prevInputRef = useRef(undefined);

  useEffect(() => {
    const incomingEdges = edges.filter(e => e.target === id);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    
    const dataList = resolveUpstreamData(incomingNodes);
    const previewData = dataList.length > 0 ? dataList.slice(0, 10) : null;

    let columnsSchema = null;
    let snapshotPath = null;

    for (const n of incomingNodes) {
      if (Array.isArray(n.data?.columns) && n.data.columns.length > 0) {
        columnsSchema = n.data.columns;
      }
      if (n.data?.snapshotPath) {
        snapshotPath = n.data.snapshotPath;
      }
    }

    if (previewData || columnsSchema || snapshotPath) {
      const serialised = JSON.stringify({ previewData, columnsSchema, snapshotPath });
      if (prevInputRef.current !== serialised) {
        prevInputRef.current = serialised;
        setNodes(nds => nds.map(n => {
          if (n.id === id) {
            const updates = {};
            if (previewData) updates.previewInput = previewData;
            if (columnsSchema) updates.columns = columnsSchema;
            if (snapshotPath) updates.inputSnapshotPath = snapshotPath;
            return { ...n, data: { ...n.data, ...updates } };
          }
          return n;
        }));
      }
    }
  }, [edges, id, nodes, setNodes]);

  const metrics = data.metrics || data.metadata?.last_training_result?.metrics || null;
  const featuresStr = data.features?.length ? data.features.join(', ') : 'None selected';

  return (
    <BaseNode
      label="FHE Sequential Model"
      icon={Cpu}
      type="ai"
      data={data}
      selected={selected}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      color="var(--accent-purple, #8B5CF6)"
      hideDefaultSource={true}
      hideDefaultTarget={true}
    >
      <Handle type="target" position={Position.Left} id="data" style={{ left: -6, top: '50%', background: 'var(--accent-purple, #8B5CF6)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
      
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.1))', paddingTop: 8 }}>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: '0 0 4px 0' }}>
          GroupBy: <span style={{ color: 'var(--cyan)' }}>{data.groupBy || 'Single continuous'}</span>
        </p>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: '0 0 8px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Features: <span style={{ color: 'var(--text-primary)' }}>{featuresStr}</span>
        </p>
        
        {metrics ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={12} style={{ color: 'var(--green, #10B981)' }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                R² Accuracy: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{metrics.r2 !== undefined && metrics.r2 !== null ? metrics.r2.toFixed(4) : 'N/A'}</span>
              </span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Flame size={12} style={{ color: 'var(--orange, #F59E0B)' }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                MSE Loss: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{metrics.mse !== undefined && metrics.mse !== null ? metrics.mse.toFixed(6) : 'N/A'}</span>
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={12} style={{ color: 'var(--cyan, #06B6D4)' }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                Train Time: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{metrics.training_time_s !== undefined && metrics.training_time_s !== null ? `${metrics.training_time_s.toFixed(2)}s` : 'N/A'}</span>
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Database size={12} style={{ color: 'var(--text-tertiary, rgba(255,255,255,0.4))' }} />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              Model Untrained
            </span>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="data" style={{ right: -6, top: '50%', background: 'var(--cyan)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
    </BaseNode>
  );
});
