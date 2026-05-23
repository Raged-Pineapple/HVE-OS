import React, { useState, useCallback } from 'react';
import StatusBar from './components/StatusBar.jsx';
import { ToastProvider } from './components/ToastProvider.jsx';
import BottomPanel from './components/BottomPanel.jsx';
import IngestionPage from './pages/IngestionPage.jsx';
import ProcessingPage from './pages/ProcessingPage.jsx';
import './index.css';

export default function App() {
  const [page, setPage] = useState('ingestion');
  const [processingKey, setProcessingKey] = useState(0);
  const [theme, setTheme] = useState('light');

  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  }, [theme]);

  const navigate = useCallback((p) => {
    setPage(p);
    if (p === 'processing') setProcessingKey(k => k + 1);
  }, []);

  return (
    <ToastProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <StatusBar activePage={page} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} />
        <main style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {page === 'ingestion'  && <IngestionPage />}
          {page === 'processing' && <ProcessingPage key={processingKey} />}
        </main>
        <BottomPanel />
      </div>
    </ToastProvider>
  );
}
