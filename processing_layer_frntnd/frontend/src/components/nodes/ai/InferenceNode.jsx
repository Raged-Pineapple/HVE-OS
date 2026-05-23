import React, { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position, useEdges, useNodes, useReactFlow } from 'reactflow';
import { Brain, Play, Database, AlertTriangle, TrendingUp, Activity, CheckCircle, HelpCircle } from 'lucide-react';
import BaseNode from '../BaseNode';
import { listTrainedModels } from '../../../api/client.js';

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const collectInferencePreview = (incomingEdges, incomingNodes) => {
  const attrRow = {};
  let attrEdgeCount = 0;

  for (const edge of incomingEdges) {
    if (!edge.sourceHandle?.startsWith('attr-out-')) continue;
    const sourceNode = incomingNodes.find((node) => node.id === edge.source);
    const sourceValue = sourceNode?.data?.[edge.sourceHandle];
    if (isPlainObject(sourceValue)) {
      Object.assign(attrRow, sourceValue);
      attrEdgeCount += 1;
    }
  }

  if (attrEdgeCount > 0) {
    return {
      previewData: [attrRow],
      columnsSchema: Object.keys(attrRow),
      snapshotPath: null,
    };
  }

  for (const n of incomingNodes) {
    if (!n.data) continue;
    const candidates = [n.data.data, n.data.extracted, n.data.resolvedEntity, n.data.pinned, n.data.unpinned];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) {
        return {
          previewData: c.slice(0, 10),
          columnsSchema: Array.isArray(n.data?.columns) ? n.data.columns : Object.keys(c[0] || {}),
          snapshotPath: n.data?.snapshotPath || null,
        };
      }
    }
    for (const c of candidates) {
      if (isPlainObject(c)) {
        return {
          previewData: [c],
          columnsSchema: Array.isArray(n.data?.columns) ? n.data.columns : Object.keys(c),
          snapshotPath: n.data?.snapshotPath || null,
        };
      }
    }
    if (Array.isArray(n.data.rows) && n.data.rows.length > 0) {
      return {
        previewData: n.data.rows.slice(0, 10),
        columnsSchema: Array.isArray(n.data?.columns) ? n.data.columns : Object.keys(n.data.rows[0] || {}),
        snapshotPath: n.data?.snapshotPath || null,
      };
    }
  }

  return { previewData: null, columnsSchema: null, snapshotPath: null };
};

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
  }
  return [];
};

export const config = {
  type: 'inference',
  category: 'ai',
  label: 'Inference',
  icon: Brain,
  color: 'var(--accent-purple, #8B5CF6)',
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const [models, setModels] = useState([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [modelsError, setModelsError] = useState('');
    const [availableFields, setAvailableFields] = useState([]);
    const [localFeatures, setLocalFeatures] = useState(formData.features || []);
    const [localSequenceLength, setLocalSequenceLength] = useState(String(formData.sequenceLength ?? 2));
    
    const localFeaturesRef = useRef(localFeatures);
    const localSequenceLengthRef = useRef(localSequenceLength);

    useEffect(() => {
      localFeaturesRef.current = localFeatures;
    }, [localFeatures]);

    useEffect(() => {
      localSequenceLengthRef.current = localSequenceLength;
    }, [localSequenceLength]);

    useEffect(() => {
      const currentFeatures = formData.features || [];
      if (JSON.stringify(currentFeatures) !== JSON.stringify(localFeaturesRef.current)) {
        setLocalFeatures(currentFeatures);
      }
    }, [formData.features]);

    useEffect(() => {
      const currentSequenceLength = String(formData.sequenceLength ?? 2);
      if (currentSequenceLength !== localSequenceLengthRef.current) {
        setLocalSequenceLength(currentSequenceLength);
      }
    }, [formData.sequenceLength]);

    const handleLocalFeaturesChange = (newFeatures) => {
      setLocalFeatures(newFeatures);
      handleChange('features', newFeatures);
    };

    // 1. Fetch trained models from S3 Silver bucket via gateway endpoint
    useEffect(() => {
      setLoadingModels(true);
      listTrainedModels()
        .then(data => {
          setModels(data || []);
          setLoadingModels(false);
        })
        .catch(err => {
          console.error("Failed to load models list:", err);
          setModelsError('Unable to load trained models.');
          setLoadingModels(false);
        });
    }, []);

    // 2. Discover available fields from upstream snapshot data
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

    const handleRunInference = () => {
      handleChange({
        features: localFeatures,
        sequenceLength: Math.max(1, parseInt(localSequenceLength, 10) || 2),
        inferenceMode: formData.inferenceMode || 'plaintext',
        _execute_trigger: Date.now()
      });
    };

    const isRunning = formData._execute_trigger && !formData.success && !formData.error;

    return (
      <>
        {/* Model Selector */}
        <div className="field" style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Select Trained Model Checkpoint
          </label>
          {loadingModels ? (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', padding: '6px 0' }}>
              <span className="spinner" style={{ width: 10, height: 10, marginRight: 6 }} /> Loading checkpoints...
            </div>
          ) : modelsError ? (
            <div style={{ fontSize: '0.7rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={12} /> {modelsError}
            </div>
          ) : models.length === 0 ? (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '6px 0' }}>
              No trained models available in Silver Bucket.
            </div>
          ) : (
            <select
              value={formData.modelPath || ''}
              onChange={(e) => handleChange('modelPath', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
            >
              <option value="">-- Choose Model --</option>
              {models.map(m => (
                <option key={m.path} value={m.path}>
                  {m.name} ({Math.round(m.size_bytes / 1024)} KB)
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Time-Series Settings */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
          <div className="field">
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Sequence Length
            </label>
            <input 
              type="number" 
              min="1" max="50"
              value={localSequenceLength}
              onChange={(e) => {
                const nextValue = e.target.value;
                setLocalSequenceLength(nextValue);
                const parsedValue = parseInt(nextValue, 10);
                if (!Number.isNaN(parsedValue)) {
                  handleChange('sequenceLength', Math.max(1, parsedValue));
                }
              }}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
            />
          </div>

          <div className="field">
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Group By Column
            </label>
            <select
              value={formData.groupBy || ''}
              onChange={(e) => handleChange('groupBy', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
            >
              <option value="">Continuous</option>
              {availableFields.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field" style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Inference Mode
          </label>
          <select
            value={formData.inferenceMode || 'plaintext'}
            onChange={(e) => handleChange('inferenceMode', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-input, rgba(255,255,255,0.05))', color: 'var(--text-primary)' }}
          >
            <option value="plaintext">Plaintext</option>
            <option value="encrypted">Encrypted (FHE)</option>
          </select>
        </div>

        {/* Features Checklist */}
        <div className="field" style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Feature Columns (Must match model training inputs)
          </label>
          <div style={{
            maxHeight: '120px',
            overflowY: 'auto',
            padding: '8px',
            borderRadius: 4,
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
            background: 'var(--bg-input, rgba(0,0,0,0.15))'
          }}>
            {availableFields.length === 0 ? (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                No fields detected from upstream snapshot.
              </span>
            ) : (
              availableFields.map(field => {
                const isChecked = localFeatures.includes(field);
                return (
                  <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', padding: '3px 0', cursor: 'pointer', color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          handleLocalFeaturesChange([...localFeatures, field]);
                        } else {
                          handleLocalFeaturesChange(localFeatures.filter(f => f !== field));
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    {field}
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* Run Button */}
        <button
          onClick={handleRunInference}
          disabled={isRunning || !formData.previewInput || !formData.modelPath || localFeatures.length === 0}
          className="btn btn-primary"
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'var(--accent-purple, #8B5CF6)',
            borderColor: 'var(--accent-purple, #8B5CF6)',
            opacity: isRunning || !formData.previewInput || !formData.modelPath || localFeatures.length === 0 ? 0.7 : 1
          }}
        >
          {isRunning ? (
            <><span className="spinner" style={{ width: 14, height: 14 }} /> Running Inference...</>
          ) : (
            <><Play size={14} /> Run Inference</>
          )}
        </button>
      </>
    )
  }
};

const InferenceNode = memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const edges = useEdges();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();
  const prevInputRef = useRef(undefined);

  // Automatically wire upstream data snapshots into the configuration preview state
  useEffect(() => {
    const incomingEdges = edges.filter(e => e.target === id);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);

    const { previewData, columnsSchema, snapshotPath } = collectInferencePreview(incomingEdges, incomingNodes);

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

  const outputRows = data.data || [];
  const hasPredictions = Array.isArray(outputRows) && outputRows.length > 0;
  
  // Find which prediction columns were created
  const features = data.features || [];
  const predCols = features.map(col => `${col}_pred`);

  return (
    <BaseNode
      label="Inference"
      icon={Brain}
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
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: '0 0 4px 0', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          Model: <span style={{ color: 'var(--accent-purple, #8B5CF6)', fontWeight: 600 }}>{data.modelPath ? data.modelPath.split('/').pop() : 'None'}</span>
        </p>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: '0 0 8px 0' }}>
          Window size: <span style={{ color: 'var(--text-primary)' }}>{data.sequenceLength ?? 2}</span>
        </p>
        <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: '0 0 8px 0' }}>
          Mode: <span style={{ color: 'var(--text-primary)' }}>{data.inferenceMode || 'plaintext'}</span>
        </p>

        {hasPredictions ? (
          <div style={{ padding: '8px', borderRadius: 4, background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle size={12} style={{ color: 'var(--green, #10B981)' }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                Predictions generated!
              </span>
            </div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)' }}>
              Appended: <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{predCols.join(', ')}</span>
            </div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)' }}>
              Total: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{(data.row_count || outputRows.length).toLocaleString()} rows</span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
            <HelpCircle size={12} style={{ color: 'var(--text-tertiary, rgba(255,255,255,0.4))' }} />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              Model Idle / Untrained
            </span>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="data" style={{ right: -6, top: '50%', background: 'var(--cyan)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
    </BaseNode>
  );
});

export default InferenceNode;
