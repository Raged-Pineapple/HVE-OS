import React, { useState, useEffect } from 'react';
import { getHealth } from '../api/client.js';

const Dot = ({ status }) => {
  const cls = status === 'connected' ? 'dot-green' : status === 'checking' ? 'dot-amber' : 'dot-red';
  return <span className={`status-dot ${cls}`} />;
};

export default function StatusBar({ activePage, onNavigate }) {
  const [health, setHealth] = useState({ status: 'checking', postgres: 'checking', minio: 'checking', kafka: 'checking' });

  const check = async () => {
    try {
      const h = await getHealth();
      setHealth(h);
    } catch {
      setHealth({ status: 'error', postgres: 'error', minio: 'error', kafka: 'error' });
    }
  };

  useEffect(() => {
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, []);

  const navItems = [
    { id: 'ingestion', label: 'Ingestion', icon: '⬇' },
    { id: 'processing', label: 'Processing', icon: '⚙' },
    { id: 'output', label: 'Output', icon: '⬆' },
  ];

  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', height: '56px', flexShrink: 0,
      background: 'hsla(222,28%,7%,0.9)',
      borderBottom: '1px solid var(--border-subtle)',
      backdropFilter: 'blur(16px)'
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.8rem', fontWeight: 700, color: 'white'
        }}>H</div>
        <span style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.02em' }}>HVE-OS</span>
        <span className="badge badge-muted" style={{ marginLeft: 4 }}>Lakehouse</span>
      </div>

      {/* Nav */}
      <nav style={{ display: 'flex', gap: 4 }}>
        {navItems.map(n => (
          <button
            key={n.id}
            onClick={() => onNavigate(n.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 16px', borderRadius: 8, border: 'none',
              fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer',
              background: activePage === n.id ? 'var(--cyan-dim)' : 'transparent',
              color: activePage === n.id ? 'var(--cyan)' : 'var(--text-secondary)',
              transition: 'all 0.15s',
            }}
          >
            <span>{n.icon}</span> {n.label}
          </button>
        ))}
      </nav>

      {/* System Health */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {[['PG', 'postgres'], ['S3', 'minio'], ['KFK', 'kafka']].map(([label, key]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Dot status={health[key]} />
            <span>{label}</span>
          </div>
        ))}
        <button onClick={check} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem', padding: '2px 6px' }}>↺</button>
      </div>
    </header>
  );
}
