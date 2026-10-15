import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// Dynamically inject the Sigma data URI favicon to bypass stale Safari disk caches
(function enforceSigmaFavicon() {
  const sigmaUri = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22bg%22%20x1%3D%220%25%22%20y1%3D%220%25%22%20x2%3D%22100%25%22%20y2%3D%22100%25%22%3E%3Cstop%20offset%3D%220%25%22%20stop-color%3D%22%2338bdf8%22/%3E%3Cstop%20offset%3D%22100%25%22%20stop-color%3D%22%230284c7%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%227.5%22%20fill%3D%22url%28%23bg%29%22/%3E%3Crect%20x%3D%220.5%22%20y%3D%220.5%22%20width%3D%2231%22%20height%3D%2231%22%20rx%3D%227%22%20fill%3D%22none%22%20stroke%3D%22%23ffffff%22%20stroke-opacity%3D%220.35%22%20stroke-width%3D%221%22/%3E%3Cpolyline%20points%3D%2223.5%2C8.5%209.5%2C8.5%2018%2C16%209.5%2C23.5%2023.5%2C23.5%22%20fill%3D%22none%22%20stroke%3D%22%230b1220%22%20stroke-width%3D%223.2%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3C/svg%3E';
  try {
    document.querySelectorAll("link[rel*='icon']").forEach((el) => el.remove());
    const link = document.createElement('link');
    link.type = 'image/svg+xml';
    link.rel = 'icon';
    link.href = sigmaUri;
    document.head.appendChild(link);
  } catch {}
})();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

