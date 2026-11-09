import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.jsx';
import { RadioController } from './engine.js';
import css from './style.css';
const style = document.createElement('style'); style.textContent = css; document.head.append(style);
const controller = new RadioController();
// Exposed only by the standalone preview for reproducible audio endurance checks.
window.__radio = controller;
createRoot(document.getElementById('root')).render(<App controller={controller} standalone/>);
controller.init();
