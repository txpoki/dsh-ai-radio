import React from 'react';
import { App } from './app.jsx';
import { RadioController } from './engine.js';
import css from './style.css';

export const inject = ['slots'];
export function apply(ctx) {
  const controller = new RadioController(); const slots = ctx.get('slots');
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = 'dsh-ai-radio'; style.textContent = css; document.head.append(style); return () => style.remove(); }, 'ai-radio: styles');
  ctx.effect(() => slots.inject('conversation.input.dock', () => slots.register({ name: 'conversation.input.dock', id: 'ai-radio-player', order: 42 }, () => React.createElement(App, { controller, miniOnly: true }))), 'ai-radio: dock');
  ctx.effect(() => slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'ai-radio-panel', order: 24 }, () => React.createElement(App, { controller, panelOnly: true }))), 'ai-radio: panel');
  ctx.effect(() => () => controller.dispose(), 'ai-radio: browser cleanup');
  controller.init();
}
