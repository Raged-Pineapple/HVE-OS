import React, { memo, useState, useEffect } from 'react';
import { useEdges, useNodes } from 'reactflow';
import { Edit, Database } from 'lucide-react';
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
  }
  return [];
};

export const config = {
  type: 'modify',
  category: 'logic',
  label: 'Modify Entity',
  icon: Edit,
  color: 'var(--accent-purple)',
  SettingsForm: ({ nodeId, formData, handleChange, nodes, edges }) => {
    const [entities, setEntities] = useState([]);
    const [loading, setLoading] = useState(false);

    const incomingEdges = edges.filter(e => e.target === nodeId);
    const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);

    useEffect(() => {
      if (incomingNodes.length > 0) {
        setLoading(true);
        const dataList = resolveUpstreamData(incomingNodes);
        setEntities(dataList);
        setLoading(false);
      } else {
        setEntities([]);
      }
    }, [incomingNodes.length, nodes, edges]);

    const selectedEntityIndex = formData.selectedEntityIndex;
    const selectedEntity = selectedEntityIndex !== undefined && selectedEntityIndex !== '' ? entities[selectedEntityIndex] : null;

    // Compute available keys for Display Name Property
    const availableKeys = new Set();
    entities.forEach(item => {
      Object.keys(item).forEach(k => {
        availableKeys.add(k);
        let val = item[k];
        if (typeof val === 'string' && val.trim().startsWith('{')) {
          try { val = JSON.parse(val.replace(/'/g, '"')); } catch (e) {}
        }
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          Object.keys(val).forEach(nk => availableKeys.add(`${k}.${nk}`));
        }
      });
    });
    const keyOptions = Array.from(availableKeys).sort();

    const getDisplayName = (ent, idx) => {
      if (formData.displayNameProperty) {
        const parts = formData.displayNameProperty.split('.');
        let current = ent;
        for (let i = 0; i < parts.length; i++) {
          if (current === null || current === undefined) break;
          if (typeof current === 'string' && current.trim().startsWith('{')) {
            try { current = JSON.parse(current.replace(/'/g, '"')); } catch (e) {}
          }
          current = current[parts[i]];
        }
        if (current !== null && current !== undefined && typeof current !== 'object') {
          return String(current);
        }
      }
      return ent.name || ent.title || ent.id || ent._hve_id || `Entity ${idx + 1}`;
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="field">
          <label>Display Name Property</label>
          <select 
            value={formData.displayNameProperty || ''} 
            onChange={(e) => handleChange('displayNameProperty', e.target.value)}
          >
            <option value="">-- Default (name, id, title) --</option>
            {keyOptions.map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Select Entity to Modify</label>
          {loading ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Loading entities...</p>
          ) : entities.length > 0 ? (
            <select
              value={formData.selectedEntityIndex !== undefined ? formData.selectedEntityIndex : ''}
              onChange={(e) => {
                const val = e.target.value;
                handleChange('selectedEntityIndex', val);
              }}
            >
              <option value="">-- Select an Entity --</option>
              {entities.map((ent, idx) => (
                <option key={idx} value={idx}>
                  {getDisplayName(ent, idx)}
                </option>
              ))}
            </select>
          ) : (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Connect a data source to see available entities.
            </p>
          )}
        </div>

        {selectedEntity && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, letterSpacing: '0.05em' }}>Modify Properties</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.keys(selectedEntity).map(key => {
                const originalValue = selectedEntity[key];
                const modifiedValue = (formData.modifiedProperties && formData.modifiedProperties[key]) !== undefined 
                  ? formData.modifiedProperties[key] 
                  : (typeof originalValue === 'object' ? JSON.stringify(originalValue) : originalValue);

                const isNumber = typeof originalValue === 'number' || (!isNaN(parseFloat(originalValue)) && isFinite(originalValue));

                return (
                  <div key={key} className="field" style={{ marginBottom: 0 }}>
                    <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{key}</span>
                      {formData.modifiedProperties && formData.modifiedProperties[key] !== undefined && String(formData.modifiedProperties[key]) !== String(typeof originalValue === 'object' ? JSON.stringify(originalValue) : originalValue) && (
                        <span style={{ color: 'var(--accent-purple)', fontSize: '0.6rem' }}>Modified</span>
                      )}
                    </label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                      <input
                        type="text"
                        value={modifiedValue !== undefined ? modifiedValue : ''}
                        onChange={(e) => {
                          const newModified = { ...(formData.modifiedProperties || {}) };
                          newModified[key] = e.target.value;
                          handleChange('modifiedProperties', newModified);
                        }}
                        placeholder={`Original: ${typeof originalValue === 'object' ? JSON.stringify(originalValue) : originalValue}`}
                        style={{ flex: 1 }}
                      />
                      {isNumber && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            const currentVal = parseFloat(modifiedValue !== undefined && modifiedValue !== '' ? modifiedValue : originalValue) || 0;
                            const newModified = { ...(formData.modifiedProperties || {}) };
                            newModified[key] = currentVal + 1;
                            handleChange('modifiedProperties', newModified);
                          }}
                          style={{ 
                            padding: '0 8px', 
                            background: 'var(--bg-elevated)', 
                            border: '1px solid var(--border-subtle)', 
                            borderRadius: 4,
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                            fontWeight: 600
                          }}
                        >
                          +1
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
};

export default memo(({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedEntityName, setSelectedEntityName] = useState(null);

  const edges = useEdges();
  const nodes = useNodes();

  useEffect(() => {
    if (data.selectedEntityIndex !== undefined && data.selectedEntityIndex !== '') {
      const incomingEdges = edges.filter(e => e.target === id);
      const incomingNodes = incomingEdges.map(e => nodes.find(n => n.id === e.source)).filter(Boolean);

      if (incomingNodes.length > 0) {
          const dataList = resolveUpstreamData(incomingNodes);
          const ent = dataList[data.selectedEntityIndex];
          if (ent) {
            let customName = null;
            if (data.displayNameProperty) {
              const parts = data.displayNameProperty.split('.');
              let current = ent;
              for (let i = 0; i < parts.length; i++) {
                if (current === null || current === undefined) break;
                if (typeof current === 'string' && current.trim().startsWith('{')) {
                  try { current = JSON.parse(current.replace(/'/g, '"')); } catch (e) {}
                }
                current = current[parts[i]];
              }
              if (current !== null && current !== undefined && typeof current !== 'object') {
                customName = String(current);
              }
            }
            setSelectedEntityName(customName || ent.name || ent.title || ent.id || ent._hve_id || `Entity ${parseInt(data.selectedEntityIndex) + 1}`);
          }
      }
    } else {
      setSelectedEntityName(null);
    }
  }, [data.selectedEntityIndex, edges, id, nodes]);

  const modifiedCount = data.modifiedProperties ? Object.keys(data.modifiedProperties).length : 0;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Database size={12} color="var(--accent-purple)" />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>
            Target: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{selectedEntityName || 'None Selected'}</span>
          </p>
        </div>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>
          Modifications: <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{modifiedCount}</span>
        </p>
      </div>
    </BaseNode>
  );
});
