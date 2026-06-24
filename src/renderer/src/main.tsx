import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './styles/index.css';
import { applyTheme, getThemePref } from './theme';

// Apply the saved theme before first paint to avoid a flash.
applyTheme(getThemePref());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
