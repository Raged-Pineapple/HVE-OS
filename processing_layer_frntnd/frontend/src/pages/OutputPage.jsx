import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Globe, Activity, Terminal, MapPin, Pin, PinOff,
  Navigation, TrendingUp, Compass, Server
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────
const PIN_ZOOM  = 11;
const MAX_TRAIL = 80;

// ── Helpers ───────────────────────────────────────────────────────────────────
function computeBounds(pts, boundary) {
  if (!pts.length && (!boundary || !boundary.length)) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  if (boundary) {
    for (const p of boundary) {
      if (p[0] < minLat) minLat = p[0];
      if (p[0] > maxLat) maxLat = p[0];
      if (p[1] < minLon) minLon = p[1];
      if (p[1] > maxLon) maxLon = p[1];
    }
  }
  const padLat = Math.max((maxLat - minLat) * 0.2, 0.4);
  const padLon = Math.max((maxLon - minLon) * 0.2, 0.4);
  return [[minLat - padLat, minLon - padLon], [maxLat + padLat, maxLon + padLon]];
}

function parseTrackingBoundary(str) {
  if (!str || typeof str !== 'string') return [];
  const coords = [];
  const regex = /\[?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]?/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lon)) {
      coords.push([lat, lon]);
    }
  }
  return coords;
}

function normalisePoint(p, idx) {
  const lat = parseFloat(p.lat ?? p.latitude);
  const lon = parseFloat(p.lon ?? p.longitude);
  if (isNaN(lat) || isNaN(lon)) return null;
  return {
    ...p,
    id:    p.id    || `pt_${idx}`,
    label: p.label || p.name || p.callsign || p.icao24 || `Point ${idx}`,
    lat, lon,
    status: p.status || 'healthy',
    track:  parseFloat(p.track ?? p.true_track) || 0,
    _position_changed: p._position_changed === true,
    _prev_lat:  p._prev_lat  ?? null,
    _prev_lon:  p._prev_lon  ?? null,
    _delta_lat: p._delta_lat ?? null,
    _delta_lon: p._delta_lon ?? null,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function OutputPage({ theme, isVisible }) {
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const tileRef         = useRef(null);
  const markersRef      = useRef(null);
  const trailRef        = useRef(null);
  const boundaryRef     = useRef(null);
  const didFitRef       = useRef(false);

  // All points come exclusively from MapNode via the 'map-points-updated' event
  const [points,       setPoints]      = useState([]);
  const [pinnedId,     setPinnedId]    = useState(null);
  const [pinTrail,     setPinTrail]    = useState([]);
  const [boundaryCoords, setBoundaryCoords] = useState(() => {
    return parseTrackingBoundary(localStorage.getItem('hve_world_map_tracking_boundary') || '');
  });
  const [updateCount,  setUpdateCount] = useState(0);
  const [lastUpdated,  setLastUpdated] = useState(null);
  const [logs, setLogs] = useState([
    { id: 1, time: new Date().toLocaleTimeString(), text: 'Waiting for MapNode output from Logic Graph...', type: 'info' }
  ]);

  const addLog = useCallback((text, type = 'info') => {
    setLogs(prev => [
      { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), text, type },
      ...prev.slice(0, 79)
    ]);
  }, []);

  // ── Map init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: [13.5, 77.5],
      zoom: 8,
      minZoom: 3,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: false,
    });
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.attribution({ prefix: false }).addAttribution('© CARTO').addTo(map);

    const tileUrl = theme === 'dark'
      ? 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
      : 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';

    tileRef.current    = L.tileLayer(tileUrl, { maxZoom: 20, crossOrigin: true }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    trailRef.current   = L.layerGroup().addTo(map);
    boundaryRef.current = L.layerGroup().addTo(map);
    mapRef.current     = map;

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tileRef.current) {
      tileRef.current.setUrl(theme === 'dark'
        ? 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
        : 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png');
    }
  }, [theme]);

  // ── Listen to MapNode output ─────────────────────────────────────────────────
  // ProcessingPage fires: window.dispatchEvent(new CustomEvent('map-points-updated', { detail: outputs.data }))
  useEffect(() => {
    const handle = (e) => {
      if (!Array.isArray(e.detail) || e.detail.length === 0) return;

      const incoming = e.detail.map(normalisePoint).filter(Boolean);
      if (!incoming.length) return;

      setPoints(prev => {
        const prevMap = new Map(prev.map(p => [p.id, p]));
        let updCnt = 0;
        const updNames = [];

        const next = incoming.map(curr => {
          const old = prevMap.get(curr.id);
          if (old) {
            const dLat = curr.lat - old.lat;
            const dLon = curr.lon - old.lon;
            if (Math.abs(dLat) > 1e-5 || Math.abs(dLon) > 1e-5) {
              updCnt++;
              updNames.push(curr.label);
              return {
                ...curr,
                _position_changed: true,
                _prev_lat:  old.lat,
                _prev_lon:  old.lon,
                _delta_lat: +dLat.toFixed(6),
                _delta_lon: +dLon.toFixed(6),
              };
            }
          }
          return { ...curr, _position_changed: false };
        });

        if (updCnt > 0) {
          setUpdateCount(c => c + updCnt);
          addLog(
            `MapNode → UPDATED ${updCnt}: ${updNames.slice(0, 5).join(', ')}${updNames.length > 5 ? ` +${updNames.length - 5}` : ''}`,
            'success'
          );
        } else {
          addLog(`MapNode → ${next.length} pts received (no position changes)`, 'info');
        }

        return next;
      });

      setLastUpdated(new Date().toLocaleTimeString());
    };

    window.addEventListener('map-points-updated', handle);
    return () => window.removeEventListener('map-points-updated', handle);
  }, [addLog]);

  // ── Listen to MapNode configuration updates ───────────────────────────────
  useEffect(() => {
    const handleConfig = (e) => {
      if (e.detail?.trackingBoundary !== undefined) {
        setBoundaryCoords(parseTrackingBoundary(e.detail.trackingBoundary));
      }
    };
    window.addEventListener('map-config-updated', handleConfig);
    return () => window.removeEventListener('map-config-updated', handleConfig);
  }, []);

  // ── Draw tracking boundary geofence polygon & vertex circles ────────────────
  useEffect(() => {
    if (!mapRef.current || !boundaryRef.current) return;
    boundaryRef.current.clearLayers();
    if (!boundaryCoords || boundaryCoords.length === 0) return;

    // Draw geofence polygon
    const polygon = L.polygon(boundaryCoords, {
      color: 'var(--cyan)',
      weight: 1.5,
      dashArray: '5 7',
      fillColor: 'var(--cyan)',
      fillOpacity: 0.08,
    });
    polygon.addTo(boundaryRef.current);

    // Draw vertex circle markers representing each coordinates plotting
    boundaryCoords.forEach((coord, i) => {
      L.circleMarker(coord, {
        radius: 4.5,
        fillColor: 'var(--cyan)',
        color: 'var(--bg-surface)',
        weight: 1.5,
        fillOpacity: 1,
        opacity: 0.9,
      }).bindPopup(`
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary);padding:2px;">
          <b style="color:var(--cyan);">Boundary Vertex #${i + 1}</b><br/>
          ${coord[0].toFixed(5)}, ${coord[1].toFixed(5)}
        </div>
      `, { closeButton: false }).addTo(boundaryRef.current);
    });
  }, [boundaryCoords]);

  // ── Trail: append red dot whenever pinned flight moves ────────────────────────
  // Runs every time `points` state updates. If the currently pinned point has
  // _position_changed === true it means it got a new lat/lon this cycle → add dot.
  const prevTrailCoordRef = useRef(null); // deduplicate consecutive identical coords
  useEffect(() => {
    if (!pinnedId) return;
    const moved = points.find(p => p.id === pinnedId && p._position_changed === true);
    if (!moved) return;

    // Guard: skip if coords are identical to the last trail entry (shouldn't happen but safety)
    const key = `${moved.lat.toFixed(6)},${moved.lon.toFixed(6)}`;
    if (prevTrailCoordRef.current === key) return;
    prevTrailCoordRef.current = key;

    const entry = { lat: moved.lat, lon: moved.lon, time: new Date().toLocaleTimeString() };
    setPinTrail(prev => [...prev.slice(-(MAX_TRAIL - 1)), entry]);
    addLog(
      `[PIN] ${moved.label}  lat ${moved._prev_lat?.toFixed(5)}→${moved.lat.toFixed(5)}  lon ${moved._prev_lon?.toFixed(5)}→${moved.lon.toFixed(5)}`,
      'success'
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, pinnedId]);

  // ── Handle map visibility / resize ──────────────────────────────────────────
  useEffect(() => {
    if (isVisible && mapRef.current) {
      const timer = setTimeout(() => {
        if (!mapRef.current) return;
        mapRef.current.invalidateSize({ animate: false });
        
        if (pinnedId) {
          const f = points.find(p => p.id === pinnedId);
          if (f && !isNaN(f.lat) && !isNaN(f.lon)) {
            mapRef.current.setView([f.lat, f.lon], PIN_ZOOM, { animate: false });
          }
        } else if (points.length || (boundaryCoords && boundaryCoords.length)) {
          const bounds = computeBounds(points, boundaryCoords);
          if (bounds) {
            mapRef.current.fitBounds(bounds, { animate: false, padding: [50, 50] });
          }
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isVisible, pinnedId, points, boundaryCoords]);

  // ── Auto-fit on first points ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || didFitRef.current || pinnedId || !isVisible) return;
    if (!points.length && (!boundaryCoords || !boundaryCoords.length)) return;
    const bounds = computeBounds(points, boundaryCoords);
    if (bounds) {
      try {
        mapRef.current.fitBounds(bounds, { animate: true, padding: [50, 50] });
        didFitRef.current = true;
        addLog(`Map fitted to coordinates boundary and points.`, 'info');
      } catch (err) {
        console.warn('Leaflet fitBounds failed:', err);
      }
    }
  }, [points, pinnedId, addLog, isVisible, boundaryCoords]);

  // ── Follow pinned point ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!pinnedId || !mapRef.current || !isVisible) return;
    const f = points.find(p => p.id === pinnedId);
    if (f && !isNaN(f.lat) && !isNaN(f.lon)) {
      try {
        mapRef.current.flyTo([f.lat, f.lon], PIN_ZOOM, { animate: true, duration: 0.7 });
      } catch (err) {
        console.warn('Leaflet flyTo failed:', err);
      }
    }
  }, [pinnedId, points, isVisible]);

  // ── Draw markers ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !markersRef.current) return;
    markersRef.current.clearLayers();

    const col = s => s === 'critical' ? 'var(--rose)' : s === 'warning' ? 'var(--amber)' : 'var(--emerald)';

    points.forEach(p => {
      const isPinned  = p.id === pinnedId;
      const isUpdated = p._position_changed;
      const c = isPinned ? 'var(--violet)' : col(p.status);
      const sz = isPinned ? 22 : 18;

      const glowRing = (isPinned || isUpdated) ? `
        <div style="position:absolute;width:38px;height:38px;border-radius:50%;
          border:1.5px solid ${isPinned ? 'var(--violet)' : 'var(--cyan)'};
          background:${isPinned ? 'var(--violet-dim)' : 'var(--cyan-dim)'};
          animation:ring-pop 1.1s ease-out forwards;left:-3px;top:-3px;z-index:0;"></div>` : '';

      const icon = L.divIcon({
        className: '',
        html: `
          <div style="position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
            ${glowRing}
            <svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="${c}"
              style="transform:rotate(${p.track || 0}deg);position:relative;z-index:1;">
              <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L14 19v-5.5L21 16z"/>
            </svg>
            <div style="position:absolute;bottom:-15px;left:50%;transform:translateX(-50%);
              font-size:${isPinned ? 9 : 7.5}px;font-family:var(--font-sans);font-weight:500;
              color:${c};white-space:nowrap;text-shadow:0 1px 2px var(--bg-surface);">
              ${isPinned ? '📍 ' : ''}${p.label}
            </div>
          </div>`,
        iconSize:   [32, 48],
        iconAnchor: [16, 16],
      });

      const deltaBlock = isUpdated ? `
        <div style="margin-top:7px;padding:5px 8px;background:var(--cyan-dim);border:1px solid var(--border-subtle);border-radius:6px;font-size:10px;color:var(--cyan);font-family:'JetBrains Mono',monospace;">
          <b>MOVED</b>&nbsp;&nbsp;
          Δlat ${p._delta_lat > 0 ? '+' : ''}${p._delta_lat?.toFixed(6)}&nbsp;&nbsp;
          Δlon ${p._delta_lon > 0 ? '+' : ''}${p._delta_lon?.toFixed(6)}
        </div>` : '';

      const extraFields = Object.entries(p)
        .filter(([k]) => !['id','lat','lon','label','status','track','type',
          '_position_changed','_prev_lat','_prev_lon','_delta_lat','_delta_lon'].includes(k))
        .slice(0, 6)
        .map(([k, v]) => `<span>${k}</span><span style="color:var(--text-primary);font-weight:500;">${String(v ?? '—').slice(0, 30)}</span>`)
        .join('');

      const marker = L.marker([p.lat, p.lon], { icon });
      marker.bindPopup(`
        <div style="font-family:var(--font-sans);padding:4px;min-width:190px;color:var(--text-primary);">
          <div style="font-size:13px;font-weight:500;border-bottom:1px solid var(--border-subtle);padding-bottom:6px;margin-bottom:7px;display:flex;align-items:center;gap:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0;"></span>
            ${p.label}${isPinned ? ' <span style="font-size:10px;color:var(--violet);">[PINNED]</span>' : ''}
          </div>
          <div style="font-size:11px;color:var(--text-secondary);display:grid;grid-template-columns:auto 1fr;gap:3px 10px;line-height:1.6;">
            <span>Lat</span><span style="color:var(--text-primary);font-family:'JetBrains Mono',monospace;">${p.lat.toFixed(6)}</span>
            <span>Lon</span><span style="color:var(--text-primary);font-family:'JetBrains Mono',monospace;">${p.lon.toFixed(6)}</span>
            <span>Status</span><span style="color:${c};font-weight:500;text-transform:uppercase;">${p.status}</span>
            ${extraFields}
          </div>
          ${deltaBlock}
          <div style="margin-top:7px;font-size:10px;color:var(--text-muted);text-align:center;">
            Click to ${isPinned ? 'UNPIN' : 'PIN & TRACK'}
          </div>
        </div>
      `, { closeButton: false, maxWidth: 240 });

      marker.on('click', () => {
        if (isPinned) {
          setPinnedId(null);
          setPinTrail([]);
          prevTrailCoordRef.current = null;
          didFitRef.current = false;
          addLog(`Unpinned ${p.label}.`, 'info');
        } else {
          setPinnedId(p.id);
          const startEntry = { lat: p.lat, lon: p.lon, time: new Date().toLocaleTimeString() };
          setPinTrail([startEntry]);
          prevTrailCoordRef.current = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
          addLog(`📍 Pinned ${p.label} at [${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}] — red dots will mark each new position.`, 'info');
        }
      });

      marker.addTo(markersRef.current);
    });
  }, [points, pinnedId, addLog]);

  // ── Draw breadcrumb trail ────────────────────────────────────────────────────
  useEffect(() => {
    if (!trailRef.current) return;
    trailRef.current.clearLayers();
    if (!pinnedId || pinTrail.length === 0) return;

    const total = pinTrail.length;
    pinTrail.forEach((pt, i) => {
      const isLatest = i === total - 1;
      const opacity  = Math.max(0.2, 1 - ((total - 1 - i) / Math.max(total, 1)) * 0.8);
      L.circleMarker([pt.lat, pt.lon], {
        radius:      isLatest ? 7 : 4,
        fillColor:   'var(--rose)',
        color:       isLatest ? 'var(--bg-surface)' : 'rgba(255,255,255,0.25)',
        weight:      isLatest ? 1.5 : 0.5,
        fillOpacity: opacity,
        opacity:     1,
      }).bindPopup(`
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-primary);padding:2px;">
          <b style="color:var(--rose);">Update #${i + 1}</b><br/>
          ${pt.time}<br/>
          ${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}
        </div>
      `, { closeButton: false }).addTo(trailRef.current);
    });

    if (pinTrail.length > 1) {
      L.polyline(pinTrail.map(p => [p.lat, p.lon]), {
        color: 'var(--rose)', weight: 1.2, opacity: 0.4, dashArray: '3 4',
      }).addTo(trailRef.current);
    }
  }, [pinnedId, pinTrail]);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:    points.length,
    updated:  points.filter(p => p._position_changed).length,
    healthy:  points.filter(p => p.status === 'healthy').length,
    critical: points.filter(p => p.status === 'critical' || p.status === 'warning').length,
  }), [points]);

  const pinnedPoint = useMemo(() => points.find(p => p.id === pinnedId) || null, [points, pinnedId]);

  const handleFitAll = useCallback(() => {
    const bounds = computeBounds(points, boundaryCoords);
    if (bounds && mapRef.current) mapRef.current.fitBounds(bounds, { animate: true, padding: [50, 50] });
  }, [points, boundaryCoords]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        .leaflet-container {
          background: var(--bg-base) !important;
          font-family: var(--font-sans);
        }
        .leaflet-popup-content-wrapper {
          background: var(--bg-surface) !important;
          border: 1px solid var(--border-default) !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.06) !important;
          color: var(--text-primary) !important;
        }
        .leaflet-popup-content { 
          margin: 12px 14px !important;
          font-family: var(--font-sans);
          line-height: 1.5;
        }
        .leaflet-popup-tip { 
          background: var(--bg-surface) !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.06) !important;
        }
        @keyframes ring-pop {
          0%   { transform: scale(0.5); opacity: 1; }
          100% { transform: scale(2.5); opacity: 0; }
        }
      `}</style>

      {/* ── LEFT PANEL ─────────────────────────────────────────────────────── */}
      <div style={{ width: 280, height: '100%', display: 'flex', flexDirection: 'column', zIndex: 1000, background: 'var(--bg-surface)', borderRight: '1px solid var(--border-subtle)', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: 'var(--cyan-dim)', color: 'var(--cyan)', padding: 8, borderRadius: 8, display: 'flex', flexShrink: 0 }}>
            <Globe size={17} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Geospatial Output
            </div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>
              Rendering MapNode output
            </div>
          </div>
        </div>

        {/* Source info */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--cyan-dim)' }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Activity size={10} /> Data Source
          </div>
          {points.length === 0 ? (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              No data yet.<br/>
              <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>Run your Logic Graph with a <strong style={{ color: 'var(--cyan)' }}>MapNode</strong> connected to a Source.</span>
            </div>
          ) : (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.7, fontFamily: 'JetBrains Mono, monospace' }}>
              <span style={{ color: 'var(--emerald)' }}>●</span> {points.length} points from MapNode<br/>
              {lastUpdated && <><span style={{ color: 'var(--text-muted)' }}>Last update:</span> {lastUpdated}</>}
            </div>
          )}
        </div>

        {/* Stats */}
        <div style={{ padding: '12px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, borderBottom: '1px solid var(--border-subtle)' }}>
          {[
            { label: 'TOTAL',   value: stats.total,    color: 'var(--cyan)' },
            { label: 'UPDATED', value: stats.updated,  color: 'var(--violet)' },
            { label: 'HEALTHY', value: stats.healthy,  color: 'var(--emerald)' },
            { label: 'ALERTS',  value: stats.critical, color: 'var(--amber)' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '9px 11px' }}>
              <div style={{ fontSize: '0.58rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 500, color: s.color, lineHeight: 1 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 7 }}>
          <button className="btn btn-primary" onClick={handleFitAll} style={{ flex: 1, fontSize: '0.69rem', padding: '6px', justifyContent: 'center' }}>
            <Compass size={11} /> Fit All
          </button>
          <button className="btn btn-danger" onClick={() => { setPinnedId(null); setPinTrail([]); didFitRef.current = false; handleFitAll(); }} disabled={!pinnedId}
            style={{ flex: 1, fontSize: '0.69rem', padding: '6px', justifyContent: 'center' }}>
            <PinOff size={11} /> Unpin
          </button>
        </div>

        {/* Pinned point detail */}
        {pinnedPoint && (
          <div style={{ padding: '12px 18px', background: 'var(--violet-dim)', borderBottom: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--violet)' }}>
            <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--violet)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Pin size={9} /> Tracking
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 5 }}>{pinnedPoint.label}</div>
            <div style={{ fontSize: '0.67rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', lineHeight: 1.8 }}>
              <span style={{ color: 'var(--violet)' }}>lat</span> {pinnedPoint.lat.toFixed(6)}<br/>
              <span style={{ color: 'var(--violet)' }}>lon</span> {pinnedPoint.lon.toFixed(6)}<br/>
              <span style={{ color: 'var(--violet)' }}>trail</span> {pinTrail.length}/{MAX_TRAIL} pts &nbsp;
              <span style={{ color: 'var(--rose)', fontWeight: 500 }}>●</span>
            </div>
            {pinnedPoint._position_changed && (
              <div style={{ marginTop: 7, fontSize: '0.64rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--rose)', background: 'var(--rose-dim)', borderRadius: 6, padding: '4px 7px', border: '1px solid var(--rose-dim)', lineHeight: 1.7 }}>
                Δlat {pinnedPoint._delta_lat > 0 ? '+' : ''}{pinnedPoint._delta_lat?.toFixed(6)}<br/>
                Δlon {pinnedPoint._delta_lon > 0 ? '+' : ''}{pinnedPoint._delta_lon?.toFixed(6)}
              </div>
            )}
          </div>
        )}

        {/* Points list */}
        <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {points.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 18px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              <Server size={28} style={{ marginBottom: 10, opacity: 0.2 }} />
              <div style={{ fontWeight: 600 }}>No MapNode data</div>
              <div style={{ fontSize: '0.64rem', marginTop: 6, lineHeight: 1.5, opacity: 0.7 }}>
                Go to <strong>Processing</strong> tab,<br/>
                connect a <strong>Source → MapNode</strong><br/>
                and run the graph.
              </div>
            </div>
          ) : points.map(p => {
            const isPinned  = p.id === pinnedId;
            const isUpdated = p._position_changed;
            const c = isPinned ? 'var(--violet)' : (p.status === 'healthy' ? 'var(--emerald)' : 'var(--amber)');

            return (
              <div key={p.id}
                onClick={() => {
                  if (isPinned) {
                    setPinnedId(null);
                    setPinTrail([]);
                    prevTrailCoordRef.current = null;
                    didFitRef.current = false;
                    addLog(`Unpinned ${p.label}.`, 'info');
                  } else {
                    setPinnedId(p.id);
                    setPinTrail([{ lat: p.lat, lon: p.lon, time: new Date().toLocaleTimeString() }]);
                    prevTrailCoordRef.current = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
                    addLog(`📍 Pinned ${p.label} at [${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}] — red dots will mark each new position.`, 'info');
                  }
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 18px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'background 0.1s',
                  background: isPinned ? 'var(--violet-dim)' : 'transparent',
                  borderLeft: isPinned ? '3px solid var(--violet)' : isUpdated ? '3px solid var(--cyan)' : '3px solid transparent',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: c }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.74rem', fontWeight: 500,
                  color: isPinned ? 'var(--violet)' : isUpdated ? 'var(--cyan)' : 'var(--text-primary)', minWidth: 60 }}>
                  {p.label}
                </span>
                <span style={{ fontSize: '0.59rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.lat.toFixed(4)},{p.lon.toFixed(4)}
                </span>
                {isPinned && <span className="badge badge-violet" style={{ fontSize: '0.58rem', padding: '1px 5px', flexShrink: 0 }}>📍</span>}
                {!isPinned && isUpdated && <span className="badge badge-cyan" style={{ fontSize: '0.58rem', padding: '1px 5px', flexShrink: 0 }}>UPD</span>}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Click a plane to pin</span>
          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <TrendingUp size={10} color="var(--violet)" /> {updateCount} updates
          </span>
        </div>
      </div>

      {/* ── MAP ────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div ref={mapContainerRef} style={{ flex: 1, width: '100%' }} />

        {/* Pin counter banner */}
        {pinnedId && (
          <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 1001, padding: '6px 16px', borderRadius: 20, fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--rose)', flexShrink: 0 }} />
            <span style={{ fontWeight: 500, color: 'var(--violet)', fontFamily: 'JetBrains Mono, monospace' }}>{pinnedPoint?.label}</span>
            <span style={{ color: 'var(--text-muted)' }}>tracking</span>
            <span style={{ color: 'var(--rose)', fontWeight: 500 }}>{pinTrail.length}</span>
            <span style={{ color: 'var(--text-muted)' }}>position{pinTrail.length !== 1 ? 's' : ''} marked</span>
          </div>
        )}

        {/* Legend */}
        <div style={{ position: 'absolute', bottom: 128, left: 16, zIndex: 999, padding: '10px 14px', borderRadius: 8, fontSize: '0.7rem', display: 'flex', flexDirection: 'column', gap: 5, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.68rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 5, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Activity size={9} color="var(--cyan)" /> Legend
          </div>
          {[
            { color: 'var(--violet)', label: 'Pinned / tracking' },
            { color: 'var(--cyan)', label: 'Position updated' },
            { color: 'var(--emerald)', label: 'Healthy / Airborne' },
            { color: 'var(--amber)', label: 'Warning / Ground' },
            { color: 'var(--rose)', label: 'Trail dot (each update)' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
              {l.label}
            </div>
          ))}
        </div>

        {/* Log panel */}
        <div style={{ height: 116, width: '100%', borderTop: '1px solid var(--border-subtle)', padding: '9px 18px', display: 'flex', flexDirection: 'column', zIndex: 999, background: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Terminal size={11} color="var(--cyan)" /> MapNode → Output Log
            </div>
            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{logs.length} events</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.67rem' }}>
            {logs.map(log => (
              <div key={log.id} style={{ display: 'flex', gap: 9, color: log.type === 'error' ? 'var(--rose)' : log.type === 'success' ? 'var(--emerald)' : 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>[{log.time}]</span>
                <span style={{ fontWeight: log.type === 'success' ? 500 : 400 }}>{log.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
