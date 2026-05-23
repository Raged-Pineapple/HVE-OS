import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  Globe, Play, Pause, RefreshCw, Sliders, Search, Activity, 
  AlertTriangle, Database, Plus, Trash2, ShieldAlert, ArrowRight,
  TrendingUp, MapPin, Compass, ChevronDown, CheckCircle2, Navigation,
  Terminal, ShieldCheck, HelpCircle, Server
} from 'lucide-react';
import { listSilverTables, runQuery } from '../api/client';

// Standard geo presets for our core industrial/analytics hubs
const REGIONAL_HUBS = {
  Bangalore: [12.9716, 77.5946],
  Munich: [48.1351, 11.5820],
  Tokyo: [35.6762, 139.6503],
  NewYork: [40.7128, -74.0060],
  London: [51.5074, -0.1278],
  Singapore: [1.3521, 103.8198],
  Sydney: [-33.8688, 151.2093]
};

const DEFAULT_POINTS = [
  { id: 'node_in_1', label: 'Bangalore Hangar Sensor', lat: 12.9716, lon: 77.5946, status: 'healthy', type: 'iot', value: '24.8°C', details: 'Cooling system nominal. Air pressure 1013hPa.' },
  { id: 'node_in_2', label: 'Munich Gateway Hub', lat: 48.1351, lon: 11.5820, status: 'warning', type: 'cyber', value: 'High Latency', details: 'Unusual spike in packets detected from subnet 192.168.4.xx.' },
  { id: 'node_in_3', label: 'Tokyo Edge Datacenter', lat: 35.6762, lon: 139.6503, status: 'healthy', type: 'iot', value: '94% CPU', details: 'Continuous graph execution processing load.' },
  { id: 'node_in_4', label: 'New York FX Engine', lat: 40.7128, lon: -74.0060, status: 'critical', type: 'transaction', value: 'FHE Error', details: 'TenSEAL fully homomorphic encryption key handshake timed out.' },
  { id: 'node_in_5', label: 'London Edge Server', lat: 51.5074, lon: -0.1278, status: 'healthy', type: 'cyber', value: 'Active', details: 'Kafka stream buffer healthy, zero lag.' },
  { id: 'node_in_6', label: 'Sydney IoT Collector', lat: -33.8688, lon: 151.2093, status: 'healthy', type: 'iot', value: '18.2°C', details: 'Sensory telemetry broadcasting every 10s.' }
];

const DEFAULT_CONNECTIONS = [
  { id: 'conn_1', fromId: 'node_in_1', toId: 'node_in_2', label: 'Telemetry Pipe', from: [12.9716, 77.5946], to: [48.1351, 11.5820], status: 'healthy' },
  { id: 'conn_2', fromId: 'node_in_3', toId: 'node_in_2', label: 'Edge Graph Link', from: [35.6762, 139.6503], to: [48.1351, 11.5820], status: 'warning' },
  { id: 'conn_3', fromId: 'node_in_4', toId: 'node_in_5', label: 'Secure FHE Tunnel', from: [40.7128, -74.0060], to: [51.5074, -0.1278], status: 'critical' },
  { id: 'conn_4', fromId: 'node_in_5', toId: 'node_in_2', label: 'Kafka Mirror', from: [51.5074, -0.1278], to: [48.1351, 11.5820], status: 'healthy' }
];

// Flight simulation is removed

// Helper to calculate a curved path of coordinates between two points (quadratic Bezier)
const getCurveCoords = (fromLatLng, toLatLng, pointsCount = 30) => {
  const coords = [];
  const [lat1, lon1] = fromLatLng;
  const [lat2, lon2] = toLatLng;
  
  const midLat = (lat1 + lat2) / 2;
  const midLon = (lon1 + lon2) / 2;
  
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const len = Math.sqrt(dLat * dLat + dLon * dLon);
  if (len === 0) return [fromLatLng, toLatLng];
  
  const offset = len * 0.18; // curve height multiplier
  
  // Perpendicular vector
  const pLat = -dLon / len;
  const pLon = dLat / len;
  
  const ctrlLat = midLat + pLat * offset;
  const ctrlLon = midLon + pLon * offset;
  
  for (let i = 0; i <= pointsCount; i++) {
    const t = i / pointsCount;
    const mt = 1 - t;
    const lat = mt * mt * lat1 + 2 * mt * t * ctrlLat + t * t * lat2;
    const lon = mt * mt * lon1 + 2 * mt * t * ctrlLon + t * t * lon2;
    coords.push([lat, lon]);
  }
  return coords;
};

export default function OutputPage({ theme }) {
  // Map References
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const connectionsLayerRef = useRef(null);
  
  // States
  const [points, setPoints] = useState(() => {
    const cached = localStorage.getItem('hve_world_map_points');
    return cached ? JSON.parse(cached) : DEFAULT_POINTS;
  });
  
  const [connections, setConnections] = useState(() => {
    const cached = localStorage.getItem('hve_world_map_connections');
    return cached ? JSON.parse(cached) : DEFAULT_CONNECTIONS;
  });

  // Flights tracking is disabled
  
  const [logs, setLogs] = useState([
    { id: 1, time: new Date().toLocaleTimeString(), text: 'System initialized. Geospatial tracking engine operational.', type: 'info' },
    { id: 2, time: new Date().toLocaleTimeString(), text: 'Kafka streaming gateway bound to localhost:9094.', type: 'info' },
    { id: 3, time: new Date().toLocaleTimeString(), text: 'Loaded 6 core telemetry edge hubs.', type: 'info' }
  ]);
  
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [sqlQuery, setSqlQuery] = useState('');
  const [isQueryRunning, setIsQueryRunning] = useState(false);
  const [queryError, setQueryError] = useState(null);
  
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [isLive, setIsLive] = useState(true);
  const [totalProcessedCount, setTotalProcessedCount] = useState(1482);
  
  // Selected detail cards
  const [selectedItem, setSelectedItem] = useState(null);
  
  // Manual Coordinate Injection Form State
  const [formLat, setFormLat] = useState('');
  const [formLon, setFormLon] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formType, setFormType] = useState('iot');
  const [formStatus, setFormStatus] = useState('healthy');

  // Load Silver tables on start
  useEffect(() => {
    let active = true;
    const fetchTables = async () => {
      try {
        const tableList = await listSilverTables();
        if (active && Array.isArray(tableList)) {
          setTables(tableList);
          if (tableList.length > 0) {
            const defaultRow = tableList.find(t => {
              const name = typeof t === 'object' ? (t.table_name || '') : t;
              return name.toLowerCase().includes('flight') || name.toLowerCase().includes('sensor');
            }) || tableList[0];
            
            const tableName = typeof defaultRow === 'object' ? defaultRow.table_name : defaultRow;
            setSelectedTable(tableName);
            setSqlQuery(`SELECT * FROM ${tableName} LIMIT 50`);
          }
        }
      } catch (err) {
        console.warn('Failed to retrieve active Silver tables, using simulated platform layers:', err);
      }
    };
    fetchTables();
    return () => { active = false; };
  }, []);

  // Save changes locally to retain persistent setups
  useEffect(() => {
    localStorage.setItem('hve_world_map_points', JSON.stringify(points));
    localStorage.setItem('hve_world_map_connections', JSON.stringify(connections));
  }, [points, connections]);

  // Log message adder
  const addLog = useCallback((text, type = 'info') => {
    setLogs(prev => [
      { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), text, type },
      ...prev.slice(0, 49) // Cap at 50 logs
    ]);
  }, []);

  // ── 1. Map Initialization ─────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;
    
    const map = L.map(mapContainerRef.current, {
      center: [20, 30],
      zoom: 2.5,
      minZoom: 1.5,
      maxZoom: 16,
      zoomControl: false,
      attributionControl: false
    });

    L.control.attribution({ prefix: false }).addAttribution('HVE-OS Engine &copy; CARTO').addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);

    const tileUrl = theme === 'dark' 
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
      
    const tiles = L.tileLayer(tileUrl, {
      maxZoom: 20,
    }).addTo(map);

    tileLayerRef.current = tiles;
    markersLayerRef.current = L.layerGroup().addTo(map);
    connectionsLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Sync theme changes with tile URL
  useEffect(() => {
    if (tileLayerRef.current) {
      const tileUrl = theme === 'dark' 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
      tileLayerRef.current.setUrl(tileUrl);
    }
  }, [theme]);

  // Handle Fly-To animation
  const handleFlyTo = useCallback((coords, label) => {
    if (mapInstanceRef.current && Array.isArray(coords)) {
      mapInstanceRef.current.flyTo(coords, 6, {
        animate: true,
        duration: 1.8
      });
      addLog(`Pan viewport to ${label} [${coords[0].toFixed(3)}, ${coords[1].toFixed(3)}]`, 'info');
    }
  }, [addLog]);

  // ── 2. Real-Time Telemetry Simulation ─────────────────
  useEffect(() => {
    if (!isLive) return;
    
    const interval = setInterval(() => {
      setTotalProcessedCount(c => c + Math.floor(Math.random() * 3 * speedMultiplier));
    }, 50);

    return () => clearInterval(interval);
  }, [isLive, speedMultiplier]);

  // ── 3. Periodic Telemetry Status Flutter / Ingestion Simulation ────────
  useEffect(() => {
    if (!isLive) return;

    const eventTimer = setInterval(() => {
      if (Math.random() > 0.6) {
        setPoints(prevPoints => {
          const randomIndex = Math.floor(Math.random() * prevPoints.length);
          const oldPoint = prevPoints[randomIndex];
          
          if (!oldPoint.id.startsWith('node_in_')) return prevPoints;

          const statuses = ['healthy', 'warning', 'critical'];
          const randomStatus = statuses[Math.floor(Math.random() * 3)];
          
          if (oldPoint.status !== randomStatus) {
            let logType = 'info';
            if (randomStatus === 'warning') logType = 'warning';
            if (randomStatus === 'critical') logType = 'error';
            
            addLog(
              `State transition: Hub [${oldPoint.label}] shifted status from ${oldPoint.status.toUpperCase()} to ${randomStatus.toUpperCase()}.`,
              logType
            );
          }

          return prevPoints.map((pt, idx) => 
            idx === randomIndex ? { ...pt, status: randomStatus } : pt
          );
        });
      }

      if (Math.random() > 0.7 && points.length > 1) {
        const fromIdx = Math.floor(Math.random() * points.length);
        let toIdx = Math.floor(Math.random() * points.length);
        while (toIdx === fromIdx) {
          toIdx = Math.floor(Math.random() * points.length);
        }
        
        const source = points[fromIdx];
        const target = points[toIdx];
        
        addLog(`Asynchronous stream packet dispatched: [${source.label}] ➔ [${target.label}]`, 'info');
      }

    }, 6000);

    return () => clearInterval(eventTimer);
  }, [isLive, points, addLog]);

  // ── 4. Filtering Nodes based on UI Selection ────────────────
  const filteredPoints = useMemo(() => {
    return points.filter(p => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesLabel = p.label?.toLowerCase().includes(query);
        const matchesType = p.type?.toLowerCase().includes(query);
        const matchesId = p.id?.toLowerCase().includes(query);
        if (!matchesLabel && !matchesType && !matchesId) return false;
      }
      
      if (filterStatus !== 'all' && p.status !== filterStatus) return false;
      if (filterType !== 'all' && p.type !== filterType) return false;
      
      return true;
    });
  }, [points, filterStatus, filterType, searchQuery]);

  // ── 5. Rebuilding Map Markers and Vectors on State Change ────
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !connectionsLayerRef.current) return;

    markersLayerRef.current.clearLayers();
    connectionsLayerRef.current.clearLayers();

    const getStatusColor = (status) => {
      switch (status) {
        case 'critical': return 'var(--rose)';
        case 'warning': return 'var(--amber)';
        case 'healthy':
        default: return 'var(--emerald)';
      }
    };

    filteredPoints.forEach(point => {
      const color = getStatusColor(point.status);
      
      const customIcon = L.divIcon({
        className: 'custom-pulsing-icon',
        html: `
          <div style="position: relative; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
            <div style="position: absolute; width: 10px; height: 10px; border-radius: 50%; background-color: ${color}; z-index: 2; border: 1.5px solid #fff;"></div>
            <div class="pulse-ring" style="position: absolute; width: 26px; height: 26px; border-radius: 50%; background-color: ${color}; opacity: 0.55; z-index: 1;"></div>
          </div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const marker = L.marker([point.lat, point.lon], { icon: customIcon });
      
      const popupContent = `
        <div style="font-family:'Inter',sans-serif; padding: 4px; min-width: 170px;">
          <h4 style="margin: 0 0 6px 0; font-size: 13px; font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--border-subtle); padding-bottom: 4px; display: flex; align-items: center; gap: 6px;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background:${color}; display:inline-block;"></span>
            ${point.label}
          </h4>
          <p style="margin: 0 0 4px 0; font-size: 11px; color: var(--text-secondary);">
            <strong>Type:</strong> <span style="text-transform: uppercase; font-weight:600;">${point.type}</span>
          </p>
          <p style="margin: 0 0 4px 0; font-size: 11px; color: var(--text-secondary);">
            <strong>Telemetry:</strong> <span style="color:var(--text-primary); font-weight: 500;">${point.value || 'N/A'}</span>
          </p>
          <p style="margin: 0; font-size: 10px; color: var(--text-muted); line-height: 1.4;">
            ${point.details || ''}
          </p>
        </div>
      `;
      marker.bindPopup(popupContent, { closeButton: false });

      marker.on('click', () => {
        setSelectedItem({ ...point, itemType: 'hub' });
      });

      marker.addTo(markersLayerRef.current);
    });

    connections.forEach(conn => {
      const color = getStatusColor(conn.status);
      const curveCoordinates = getCurveCoords(conn.from, conn.to, 30);
      
      const polyline = L.polyline(curveCoordinates, {
        color: color,
        weight: 2,
        opacity: 0.75,
        className: 'connection-vector',
      });
      
      polyline.bindPopup(`
        <div style="font-family:'Inter',sans-serif; font-size: 11px; padding: 2px;">
          <strong>Vector:</strong> ${conn.label || 'Static Tunnel'}<br/>
          <span style="color:var(--text-muted);">Capacity nominal | Active transfer</span>
        </div>
      `, { closeButton: false });
      
      polyline.addTo(connectionsLayerRef.current);
    });

  }, [filteredPoints, connections]);

  // ── 6. Manual Node Injection Handler ────────────────────────
  const handleAddPoint = useCallback((e) => {
    e.preventDefault();
    if (!formLat || !formLon || !formLabel) {
      alert('Please fill out all required fields (Latitude, Longitude, Label).');
      return;
    }
    
    const lat = parseFloat(formLat);
    const lon = parseFloat(formLon);
    
    if (isNaN(lat) || lat < -90 || lat > 90) {
      alert('Latitude must be a valid float between -90 and 90.');
      return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      alert('Longitude must be a valid float between -180 and 180.');
      return;
    }

    const newPoint = {
      id: `node_user_${Date.now()}`,
      label: formLabel,
      lat: lat,
      lon: lon,
      status: formStatus,
      type: formType,
      value: formType === 'iot' ? 'Nominal' : 'Active Channel',
      details: 'Manually injected edge node during active operations monitor.'
    };

    setPoints(prev => [...prev, newPoint]);
    addLog(`Manually registered new edge node: "${formLabel}" at [${lat.toFixed(4)}, ${lon.toFixed(4)}]`, 'success');
    
    handleFlyTo([lat, lon], formLabel);

    setFormLat('');
    setFormLon('');
    setFormLabel('');
  }, [formLat, formLon, formLabel, formType, formStatus, handleFlyTo, addLog]);

  // ── 7. Cyber Attack Event Simulation Trigger ─────────────────
  const triggerCyberAttackSim = useCallback(() => {
    if (points.length < 2) {
      alert('Please add at least 2 points to simulate cybersecurity attack vectors.');
      return;
    }

    const fromIdx = Math.floor(Math.random() * points.length);
    let toIdx = Math.floor(Math.random() * points.length);
    while (toIdx === fromIdx) {
      toIdx = Math.floor(Math.random() * points.length);
    }
    
    const attacker = points[fromIdx];
    const victim = points[toIdx];

    setPoints(prev => 
      prev.map(p => p.id === victim.id ? { ...p, status: 'critical', details: `Intrusion threat vector detected from ${attacker.label}. Critical state triggered.` } : p)
    );

    const newConn = {
      id: `attack_vector_${Date.now()}`,
      fromId: attacker.id,
      toId: victim.id,
      label: 'Unauthorized Flow',
      from: [attacker.lat, attacker.lon],
      to: [victim.lat, victim.lon],
      status: 'critical'
    };

    setConnections(prev => [...prev, newConn]);
    
    addLog(`🚨 CYBER THREAT DETECTED: Denial-of-Service / Intrusion sequence initiated from [${attacker.label}] ➔ [${victim.label}]! Port scan active.`, 'error');
    handleFlyTo([victim.lat, victim.lon], `Threat Target: ${victim.label}`);

    setTimeout(() => {
      setPoints(prev => 
        prev.map(p => p.id === victim.id ? { ...p, status: 'healthy', details: 'System recovered. Cyber threat mitigation successfully executed by perimeter firewall.' } : p)
      );
      setConnections(prev => prev.filter(c => c.id !== newConn.id));
      addLog(`🛡️ Incident mitigation complete: Unauthorized connection from [${attacker.label}] blocked. Threat resolved.`, 'info');
    }, 9000);

  }, [points, handleFlyTo, addLog]);

  // ── 8. Executing Custom SQL Queries against Silver DuckDB ────
  const executeDuckDBQuery = useCallback(async () => {
    if (!sqlQuery.trim()) return;
    setIsQueryRunning(true);
    setQueryError(null);
    addLog(`Executing Control SQL against Silver Catalog...`, 'info');

    try {
      const response = await runQuery(sqlQuery);
      
      if (!response || !Array.isArray(response.records) || response.records.length === 0) {
        addLog(`Query completed successfully but returned 0 spatial coordinates.`, 'warning');
        setIsQueryRunning(false);
        return;
      }
      
      const records = response.records;
      addLog(`Query successful! Fetched ${records.length} records. Parsing spatial schemas...`, 'success');
      
      let latField = null;
      let lonField = null;
      let labelField = null;
      let valField = null;

      const latPatterns = ['latitude', 'lat', 'y', 'coordinate_y', 'lat_dec'];
      const lonPatterns = ['longitude', 'lon', 'lng', 'x', 'coordinate_x', 'lon_dec'];
      const labelPatterns = ['source_id', 'sensor_id', 'callsign', 'icao24', 'name', 'id', 'label'];
      const valPatterns = ['value', 'temperature', 'temp', 'altitude', 'velocity', 'intensity', 'count'];

      const firstRecord = records[0];
      const keys = Object.keys(firstRecord);
      for (const k of keys) {
        const lk = k.toLowerCase();
        if (!latField && latPatterns.some(p => lk === p || lk.includes(p))) latField = k;
        if (!lonField && lonPatterns.some(p => lk === p || lk.includes(p))) lonField = k;
        if (!labelField && labelPatterns.some(p => lk === p || lk.includes(p))) labelField = k;
        if (!valField && valPatterns.some(p => lk === p || lk.includes(p))) valField = k;
      }

      if (!latField || !lonField) {
        addLog(`Critical: Could not auto-detect coordinate columns (lat/lon) in Silver Schema. Keys: ${keys.join(', ')}`, 'error');
        setQueryError(`No spatial coordinates columns detected. Please project fields containing 'latitude'/'longitude'.`);
        setIsQueryRunning(false);
        return;
      }

      addLog(`Geospatial schema mapping confirmed: Lat: "${latField}", Lon: "${lonField}", Label: "${labelField || 'Index'}"`, 'info');
      
      const queriedPoints = records.map((row, idx) => {
        const latVal = parseFloat(row[latField]);
        const lonVal = parseFloat(row[lonField]);
        
        if (isNaN(latVal) || isNaN(lonVal)) return null;

        const statuses = ['healthy', 'warning', 'critical'];
        const statusVal = row.dq_failed ? 'critical' : statuses[Math.abs(Math.sin(idx)) > 0.85 ? 1 : 0];

        return {
          id: `node_db_${idx}_${Date.now()}`,
          label: String(row[labelField] || `${selectedTable}_node_${idx}`),
          lat: latVal,
          lon: lonVal,
          status: statusVal,
          type: 'database',
          value: String(row[valField] || 'Read Nominally'),
          details: `Silver record extracted from DuckDB table "${selectedTable}". Full row: ${JSON.stringify(row)}`
        };
      }).filter(p => p !== null);

      if (queriedPoints.length > 0) {
        setPoints(prev => {
          const simulatedOnly = prev.filter(p => p.id.startsWith('node_in_'));
          return [...simulatedOnly, ...queriedPoints];
        });
        
        addLog(`Successfully loaded and mapped ${queriedPoints.length} Iceberg Table coordinates to Map overlay!`, 'success');
        handleFlyTo([queriedPoints[0].lat, queriedPoints[0].lon], queriedPoints[0].label);
      } else {
        addLog(`Error parsing table rows. Coordinate parsing failed.`, 'error');
      }

    } catch (err) {
      console.error(err);
      const errMsg = err.response?.data?.detail || err.message || 'Unknown DuckDB execution failure';
      setQueryError(errMsg);
      addLog(`DuckDB SQL execution failed: ${errMsg}`, 'error');
    } finally {
      setIsQueryRunning(false);
    }
  }, [sqlQuery, selectedTable, handleFlyTo, addLog]);

  const handleTableChange = (e) => {
    const tbl = e.target.value;
    setSelectedTable(tbl);
    setSqlQuery(`SELECT * FROM ${tbl} LIMIT 50`);
  };

  const handleReset = useCallback(() => {
    setPoints(DEFAULT_POINTS);
    setConnections(DEFAULT_CONNECTIONS);
    setSelectedItem(null);
    addLog('Reset all geospatial layers and telemetry state to standard defaults.', 'info');
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([20, 30], 2.5);
    }
  }, [addLog]);

  const handleClear = useCallback(() => {
    setPoints(DEFAULT_POINTS.filter(p => p.id.startsWith('node_in_')));
    setConnections([]);
    setSelectedItem(null);
    addLog('Cleared manually loaded coordinates and connection tunnels.', 'info');
  }, [addLog]);

  const stats = useMemo(() => {
    const active = points.length;
    const warning = points.filter(p => p.status === 'warning').length;
    const critical = points.filter(p => p.status === 'critical').length;
    const healthPercentage = active > 0 ? Math.round(((active - critical) / active) * 100) : 100;
    return { active, warning, critical, healthPercentage };
  }, [points]);

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}>
      
      <style>{`
        .leaflet-container {
          background: ${theme === 'dark' ? '#1a1918' : '#Fcfaf8'} !important;
          font-family: 'Inter', sans-serif;
        }
        
        @keyframes marker-pulse {
          0% { transform: scale(0.65); opacity: 0.95; }
          50% { opacity: 0.4; }
          100% { transform: scale(1.65); opacity: 0; }
        }
        
        .custom-pulsing-icon {
          background: transparent;
          border: none;
        }
        
        .pulse-ring {
          animation: marker-pulse 1.8s infinite ease-out;
        }
        
        @keyframes stroke-flow {
          to {
            stroke-dashoffset: -30;
          }
        }
        
        .connection-vector {
          stroke-dasharray: 6, 3;
          animation: stroke-flow 1.2s linear infinite;
        }
        
        .custom-scroll::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: var(--border-default);
          border-radius: 99px;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover {
          background: var(--border-strong);
        }
        
        .glass-card {
          background: ${theme === 'dark' ? 'rgba(38, 36, 35, 0.88)' : 'rgba(255, 255, 255, 0.9)'};
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid var(--border-subtle);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
        }
      `}</style>

      {/* ─── LEFT PANEL: Control Center ─── */}
      <div 
        className="glass-card custom-scroll" 
        style={{
          width: 390,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1000,
          borderRight: '1px solid var(--border-subtle)',
          overflowY: 'auto',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            background: 'var(--cyan-dim)',
            color: 'var(--cyan)',
            padding: 8,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Globe size={20} className={isLive ? 'spin' : ''} style={{ animationDuration: '25s' }} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
              Geospatial Operations
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span className="status-dot dot-green" style={{ width: 6, height: 6, background: isLive ? 'var(--emerald)' : 'var(--text-muted)' }} />
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                {isLive ? 'Live Tracking Pipeline Active' : 'Pipeline Standby'}
              </span>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: '0.7rem', fontWeight: 500, textTransform: 'uppercase' }}>
              <Activity size={12} color="var(--cyan)" />
              Active Nodes
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 600, marginTop: 6, color: 'var(--text-primary)' }}>
              {stats.active}
            </div>
          </div>
          
          <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: '0.7rem', fontWeight: 500, textTransform: 'uppercase' }}>
              <AlertTriangle size={12} color="var(--rose)" />
              Threat Alerts
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 600, marginTop: 6, color: stats.critical > 0 ? 'var(--rose)' : 'var(--text-primary)' }}>
              {stats.critical}
            </div>
          </div>

          <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12, gridColumn: 'span 2' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'between', width: '100%' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: '0.7rem', fontWeight: 500, textTransform: 'uppercase' }}>
                <TrendingUp size={12} color="var(--emerald)" />
                Stream Ingest Index
              </span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--emerald)', marginLeft: 'auto' }}>
                {stats.healthPercentage}% Stable
              </span>
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: 6, color: 'var(--text-primary)', display: 'flex', alignItems: 'baseline', gap: 4 }}>
              {totalProcessedCount.toLocaleString()}
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>pkts telemetry</span>
            </div>
            <div style={{ width: '100%', background: 'var(--border-subtle)', height: 4, borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: `${stats.healthPercentage}%`, background: 'var(--emerald)', height: '100%' }}></div>
            </div>
          </div>
        </div>

        {/* Dynamic Silver Table Integration */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 style={{ marginBottom: 12, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Database size={13} />
            Iceberg / DuckDB Ingest
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.75rem', margin: '0 0 6px 0', color: 'var(--text-secondary)' }}>Silver Catalog Table</label>
              {tables.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Server size={12} />
                  No Active Lakehouse Tables
                </div>
              ) : (
                <select 
                  value={selectedTable} 
                  onChange={handleTableChange}
                  style={{ padding: '8px 10px', fontSize: '0.8rem' }}
                >
                  {tables.map((t, idx) => {
                    const name = typeof t === 'object' ? (t.table_name || '') : t;
                    const rows = typeof t === 'object' && t.row_count !== undefined ? ` (${t.row_count.toLocaleString()} rows)` : '';
                    return (
                      <option key={`${name}_${idx}`} value={name}>
                        {name}{rows}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', margin: '0 0 6px 0', color: 'var(--text-secondary)' }}>Target SQL Query</label>
              <textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.75rem',
                  padding: '8px',
                  minHeight: 60,
                  width: '100%',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 6
                }}
                disabled={tables.length === 0}
              />
            </div>

            {queryError && (
              <div style={{ fontSize: '0.72rem', color: 'var(--rose)', background: 'var(--rose-dim)', padding: '6px 10px', borderRadius: 4, display:'flex', gap: 6 }}>
                <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                <span>{queryError}</span>
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={executeDuckDBQuery}
              disabled={isQueryRunning || tables.length === 0}
              style={{
                fontSize: '0.78rem',
                padding: '8px 14px',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: 'var(--cyan)',
                color: '#fff',
                borderColor: 'transparent',
                fontWeight: 600
              }}
            >
              {isQueryRunning ? (
                <>
                  <RefreshCw className="spin" size={13} />
                  Scanning Lakehouse...
                </>
              ) : (
                <>
                  <Database size={13} />
                  Execute Spatial Query
                </>
              )}
            </button>
          </div>
        </div>

        {/* Global Node Filters */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 style={{ marginBottom: 12, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sliders size={13} />
            Overlay Controls
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search Active Nodes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ padding: '8px 12px 8px 32px', fontSize: '0.8rem' }}
              />
              <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: '0.72rem', margin: '0 0 4px 0', color: 'var(--text-secondary)' }}>Status Severity</label>
                <select 
                  value={filterStatus} 
                  onChange={(e) => setFilterStatus(e.target.value)}
                  style={{ padding: '6px 8px', fontSize: '0.76rem' }}
                >
                  <option value="all">All States</option>
                  <option value="healthy">Healthy</option>
                  <option value="warning">Warnings</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', margin: '0 0 4px 0', color: 'var(--text-secondary)' }}>Telemetry Type</label>
                <select 
                  value={filterType} 
                  onChange={(e) => setFilterType(e.target.value)}
                  style={{ padding: '6px 8px', fontSize: '0.76rem' }}
                >
                  <option value="all">All Layers</option>
                  <option value="iot">IoT Sensors</option>
                  <option value="cyber">Cyber traffic</option>
                  <option value="transaction">Transactions</option>
                  <option value="database">Lakehouse Query</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Custom Point Injection Tool */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 style={{ marginBottom: 12, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} />
            Register Manual Coordinate
          </h3>

          <form onSubmit={handleAddPoint} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="text"
              placeholder="Edge Point Label (e.g. Milan Hub)"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              style={{ padding: '6px 10px', fontSize: '0.78rem' }}
              required
            />
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input
                type="number"
                step="any"
                placeholder="Latitude (e.g. 45.464)"
                value={formLat}
                onChange={(e) => setFormLat(e.target.value)}
                style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                required
              />
              <input
                type="number"
                step="any"
                placeholder="Longitude (e.g. 9.190)"
                value={formLon}
                onChange={(e) => setFormLon(e.target.value)}
                style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <select 
                value={formType} 
                onChange={(e) => setFormType(e.target.value)}
                style={{ padding: '6px 8px', fontSize: '0.76rem' }}
              >
                <option value="iot">IoT</option>
                <option value="cyber">Cyber</option>
                <option value="transaction">Fintech</option>
              </select>
              <select 
                value={formStatus} 
                onChange={(e) => setFormStatus(e.target.value)}
                style={{ padding: '6px 8px', fontSize: '0.76rem' }}
              >
                <option value="healthy">Healthy</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            <button 
              type="submit" 
              className="btn btn-primary"
              style={{ padding: '6px 12px', fontSize: '0.75rem', width: '100%', justifyContent: 'center', marginTop: 4 }}
            >
              Inject Event Point
            </button>
          </form>
        </div>

        {/* Global Simulation Actions */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
          <button
            className="btn btn-danger"
            onClick={triggerCyberAttackSim}
            disabled={!isLive}
            style={{
              padding: '10px 14px',
              fontSize: '0.78rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              border: '1px solid var(--rose)',
              fontWeight: 600,
              width: '100%'
            }}
          >
            <ShieldAlert size={14} />
            Simulate Cyber Intrusion
          </button>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleReset} style={{ fontSize: '0.75rem', padding: '8px 12px', justifyContent: 'center' }}>
              Restore Defaults
            </button>
            <button className="btn btn-ghost" onClick={handleClear} style={{ fontSize: '0.75rem', padding: '8px 12px', justifyContent: 'center', border: '1px solid var(--border-default)' }}>
              Clear Custom
            </button>
          </div>
        </div>
      </div>

      {/* ─── MAIN RIGHT MAP AREA ─── */}
      <div style={{ flex: 1, height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        
        {/* Map Container Viewport */}
        <div ref={mapContainerRef} style={{ flex: 1, width: '100%' }} />

        {/* Global Navigation Presets Overlay (Top Left) */}
        <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 999, display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 'calc(100% - 100px)' }}>
          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            <Compass size={12} color="var(--cyan)" />
            Fly To:
          </div>
          {Object.entries(REGIONAL_HUBS).map(([name, coords]) => (
            <button
              key={name}
              className="glass-card btn"
              onClick={() => handleFlyTo(coords, name)}
              style={{
                padding: '4px 10px',
                borderRadius: 8,
                fontSize: '0.74rem',
                fontWeight: 500,
                color: 'var(--text-primary)',
                background: 'rgba(var(--bg-surface), 0.75)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              📍 {name}
            </button>
          ))}
        </div>

        {/* Map Floating Legend (Bottom Left) */}
        <div 
          className="glass-card" 
          style={{
            position: 'absolute',
            bottom: 24,
            left: 24,
            zIndex: 999,
            padding: '12px 16px',
            borderRadius: 10,
            width: 190,
            fontSize: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={12} />
            Telemetry Legend
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--emerald)' }}></span>
            <span>Healthy / Nominal</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--amber)' }}></span>
            <span>Latency / Warning</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--rose)' }}></span>
            <span>Intrusion / Critical</span>
          </div>
          {/* Active Aircraft legend key is removed */}
        </div>

        {/* Map Floating Simulator Speed Controls (Bottom Middle) */}
        <div 
          className="glass-card" 
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 999,
            padding: '8px 16px',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}
        >
          <button 
            className="btn" 
            onClick={() => setIsLive(!isLive)}
            style={{
              padding: 6,
              background: 'var(--cyan-dim)',
              color: 'var(--cyan)',
              border: 'none',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {isLive ? <Pause size={14} /> : <Play size={14} />}
          </button>
          
          <div style={{ height: 16, width: 1, background: 'var(--border-subtle)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}>Sim Speed:</span>
            {[1, 2, 5].map(speed => (
              <button
                key={speed}
                onClick={() => setSpeedMultiplier(speed)}
                style={{
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  border: '1px solid transparent',
                  cursor: 'pointer',
                  background: speedMultiplier === speed ? 'var(--cyan)' : 'var(--bg-base)',
                  color: speedMultiplier === speed ? '#fff' : 'var(--text-secondary)',
                  transition: 'all 0.15s'
                }}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>

        {/* Selected Hub/Flight Detail Panel (Right Sidebar overlay) */}
        {selectedItem && (
          <div 
            className="glass-card" 
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              width: 320,
              zIndex: 999,
              borderRadius: 10,
              padding: '16px 20px',
              animation: 'slideIn 0.25s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10, marginBottom: 12 }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <MapPin size={14} />
                {selectedItem.label}
              </h4>
              <button 
                onClick={() => setSelectedItem(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', fontWeight: 600 }}
              >
                &times;
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.76rem' }}>
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Active State:</span>
                  <span style={{
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    color: selectedItem.status === 'healthy' ? 'var(--emerald)' : selectedItem.status === 'warning' ? 'var(--amber)' : 'var(--rose)'
                  }}>{selectedItem.status}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Layer Type:</span>
                  <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>{selectedItem.type}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Geo Coordinates:</span>
                  <span style={{ fontWeight: 600 }}>{selectedItem.lat.toFixed(4)}, {selectedItem.lon.toFixed(4)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Dynamic Reading:</span>
                  <span style={{ fontWeight: 600 }}>{selectedItem.value}</span>
                </div>
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', lineHeight: 1.4, fontSize: '0.72rem' }}>
                  <strong>Diagnostics:</strong><br/>
                  {selectedItem.details}
                </div>
              </>
            </div>
          </div>
        )}

        {/* ─── BOTTOM PANEL: Live Geospatial Event Ticker ─── */}
        <div 
          className="glass-card" 
          style={{
            height: 120,
            width: '100%',
            borderTop: '1px solid var(--border-subtle)',
            padding: '12px 24px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 999
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Terminal size={13} color="var(--cyan)" />
              Geospatial Message Log
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              Total events tracked: {logs.length}
            </div>
          </div>
          
          <div className="custom-scroll" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem' }}>
            {logs.map((log) => (
              <div 
                key={log.id} 
                style={{ 
                  display: 'flex', 
                  gap: 12, 
                  color: log.type === 'error' ? 'var(--rose)' : log.type === 'warning' ? 'var(--amber)' : log.type === 'success' ? 'var(--emerald)' : 'var(--text-secondary)' 
                }}
              >
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>[{log.time}]</span>
                <span style={{ fontWeight: log.type !== 'info' ? 500 : 400 }}>{log.text}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
