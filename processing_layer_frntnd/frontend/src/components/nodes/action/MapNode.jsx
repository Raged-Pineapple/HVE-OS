import React, { memo, useState } from 'react';
import { Handle, Position, useEdges, useNodes, useReactFlow } from 'reactflow';
import { Globe, ShieldAlert, Check } from 'lucide-react';
import BaseNode from '../BaseNode';

export const config = {
  type: 'mapNode',
  category: 'action',
  label: 'Geospatial Map',
  icon: Globe,
  color: '#2563EB',
  hideInSidebar: false,
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const incomingEdges = edges.filter(e => e.target === nodeId);
    const availableKeys = new Set();
    
    incomingEdges.forEach(edge => {
      const node = nodes.find(n => n.id === edge.source);
      if (!node) return;
      
      let dataToProcess = null;
      if (node.data && edge.sourceHandle && node.data[edge.sourceHandle] !== undefined) {
        dataToProcess = node.data[edge.sourceHandle];
      } else {
        dataToProcess = node.data?.data ?? node.data?.resolvedEntity ?? node.data?.extracted ?? null;
      }

      const entitiesToProcess = Array.isArray(dataToProcess) 
        ? dataToProcess 
        : (dataToProcess && typeof dataToProcess === 'object' ? [dataToProcess] : []);
      
      entitiesToProcess.forEach(item => {
        if (item && typeof item === 'object') {
          Object.keys(item).forEach(k => availableKeys.add(k));
        }
      });
    });

    const keyOptions = Array.from(availableKeys).sort();

    const SelectOrInput = ({ label, field, placeholder }) => {
      const val = formData[field] || '';
      return (
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 600 }}>{label}</label>
          {keyOptions.length > 0 ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <select 
                value={val} 
                onChange={e => handleChange(field, e.target.value)}
                style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
              >
                <option value="">-- Select Field --</option>
                {keyOptions.map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <input 
                value={val}
                onChange={e => handleChange(field, e.target.value)}
                placeholder="Or type manual"
                style={{ width: '90px', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.75rem' }}
              />
            </div>
          ) : (
            <input 
              value={val}
              onChange={e => handleChange(field, e.target.value)}
              placeholder={placeholder}
              style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem' }}
            />
          )}
        </div>
      );
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ padding: '6px 10px', background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.22)', borderRadius: 6, fontSize: '0.65rem', color: '#2563EB', fontWeight: 600 }}>
          🌐 Map Action — automatically processes coordinates and updates the Geospatial Map.
        </div>

        <SelectOrInput label="Latitude Field" field="latField" placeholder="e.g. latitude" />
        <SelectOrInput label="Longitude Field" field="lonField" placeholder="e.g. longitude" />
        <SelectOrInput label="Label Field" field="labelField" placeholder="e.g. name" />
        <SelectOrInput label="Value/Telemetry Field" field="valueField" placeholder="e.g. value" />
        <SelectOrInput label="Status/Severity Field" field="statusField" placeholder="e.g. status" />

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Tracking Boundary Region
          </label>
          <textarea
            value={formData.trackingBoundary || ''}
            onChange={e => handleChange('trackingBoundary', e.target.value)}
            placeholder="e.g. [11.5, 74.8], [16.0, 74.8], [16.0, 78.8], [11.5, 78.8], [11.5, 74.8]"
            rows={3}
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              fontFamily: 'JetBrains Mono, monospace',
              resize: 'vertical'
            }}
          />
          <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', display: 'block', marginTop: 3 }}>
            Format: [lat, lon], [lat, lon], ...
          </span>
        </div>
      </div>
    );
  }
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  
  const edges = useEdges();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();
  const prevInputRef = React.useRef(undefined);

  React.useEffect(() => {
    const incomingEdges = edges.filter(e => e.target === id);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);
    
    let sampleEntity = null;
    for (const node of incomingNodes) {
      const ent = node.data?.data || node.data?.extracted || node.data?.resolvedEntity || node.data?.pinned || node.data?.unpinned;
      const candidates = Array.isArray(ent) ? ent : (ent && typeof ent === 'object' ? [ent] : []);
      if (candidates.length > 0) {
        sampleEntity = candidates[0];
        break;
      }
    }

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

  React.useEffect(() => {
    if (data.trackingBoundary !== undefined) {
      localStorage.setItem('hve_world_map_tracking_boundary', data.trackingBoundary);
      window.dispatchEvent(new CustomEvent('map-config-updated', { detail: { trackingBoundary: data.trackingBoundary } }));
    }
  }, [data.trackingBoundary]);

  const mappedCount = Array.isArray(data.data) ? data.data.length : 0;
  const statusColor = data.success ? '#10B981' : (data.error ? '#EF4444' : 'var(--text-muted)');

  return (
    <BaseNode
      label={data.label || config.label}
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
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.65rem', color: statusColor }}>
          {data.success ? <Check size={10} /> : (data.error ? <ShieldAlert size={10} /> : null)}
          <span>{mappedCount > 0 ? `${mappedCount} mapped` : 'standby'}</span>
        </span>
      }
    >
      <Handle type="target" position={Position.Left} id="data" style={{ left: -6, top: '50%', background: 'var(--amber)', width: 12, height: 12, border: '2px solid var(--bg-surface)', zIndex: 10 }} />
      
      <div style={{ padding: '8px 0 0 0', borderTop: '1px solid var(--border-subtle)', marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Mapped points:</span>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#2563EB', background: 'rgba(37,99,235,0.08)', padding: '2px 6px', borderRadius: 4 }}>
            {mappedCount}
          </span>
        </div>

        {data.error && (
          <div style={{ fontSize: '0.62rem', color: 'var(--rose)', background: 'var(--rose-dim)', padding: '4px 6px', borderRadius: 4, marginTop: 4, display: 'flex', gap: 4 }}>
            <ShieldAlert size={10} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{data.error}</span>
          </div>
        )}

        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
          {mappedCount > 0 
            ? `Successfully pushed ${mappedCount} coordinates to local Geospatial Map.`
            : 'Pending execution run.'
          }
        </div>
      </div>
    </BaseNode>
  );
});
