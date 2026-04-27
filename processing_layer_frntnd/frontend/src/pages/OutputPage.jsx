import React from 'react';

export default function OutputPage() {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', flexDirection:'column', gap:16 }}>
      <div style={{ fontSize:'3rem' }}>📊</div>
      <h1 style={{ color:'var(--text-primary)' }}>Output</h1>
      <p style={{ color:'var(--text-muted)', fontSize:'0.9rem', maxWidth:400, textAlign:'center' }}>
        Dashboards, visualizations, and export pipelines will be configured here.
      </p>
      <div style={{ background:'var(--cyan-dim)', border:'1px solid hsla(192,100%,55%,0.2)', borderRadius:10, padding:'14px 24px', fontSize:'0.82rem', color:'var(--cyan)', marginTop:8 }}>
        🚧 Coming soon — use the <strong>Query</strong> tab in Ingestion to run SQL against Silver tables
      </div>
    </div>
  );
}
