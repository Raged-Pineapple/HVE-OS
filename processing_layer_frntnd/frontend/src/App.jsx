import React, { useState, useCallback } from 'react';
import StatusBar from './components/StatusBar.jsx';
import { ToastProvider } from './components/ToastProvider.jsx';
import BottomPanel from './components/BottomPanel.jsx';
import IngestionPage from './pages/IngestionPage.jsx';
import ProcessingPage from './pages/ProcessingPage.jsx';
import OutputPage from './pages/OutputPage.jsx';
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
  }, []);

  return (
    <ToastProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <StatusBar activePage={page} onNavigate={navigate} theme={theme} onToggleTheme={toggleTheme} />
        <main style={{ flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative' }}>
          <div style={{ display: page === 'ingestion' ? 'block' : 'none', height: '100%', width: '100%' }}>
            <IngestionPage />
          </div>
          <div style={{ display: page === 'processing' ? 'block' : 'none', height: '100%', width: '100%' }}>
            <ProcessingPage isVisible={page === 'processing'} />
          </div>
          <div style={{ display: page === 'output' ? 'block' : 'none', height: '100%', width: '100%' }}>
            <OutputPage theme={theme} isVisible={page === 'output'} />
          </div>
        </main>
        <BottomPanel />
      </div>
    </ToastProvider>
  );
}
