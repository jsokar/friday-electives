// Small DOM helpers. All text goes in through textContent (never innerHTML), so names from imports are safe.
import { ELECTIVE_INFO } from './engine/constants.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Polite announcement for screen readers (and a visible toast that stays until closed). */
export function announce(message, { toast = true, kind = 'info' } = {}) {
  const live = document.getElementById('live');
  if (live) {
    live.textContent = '';
    setTimeout(() => (live.textContent = message), 30);
  }
  if (!toast) return;
  const area = document.getElementById('toasts');
  if (!area) return;
  const t = h('div', { class: `toast toast-${kind}`, role: 'status' },
    h('span', {}, message),
    h('button', { class: 'toast-close', 'aria-label': 'Close message', onclick: () => t.remove() }, '×'));
  area.append(t);
  if (area.children.length > 4) area.firstChild.remove();
}

export function photo(student, size = 44, photoBase = '') {
  const initials = `${(student.first || '?')[0]}${(student.last || '')[0] || ''}`.toUpperCase();
  const wrap = h('span', { class: 'avatar', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` }, 'aria-hidden': 'true' });
  if (student.photo && student.photoOk && !document.body.classList.contains('hide-photos')) {
    const src = typeof photoBase === 'function' ? photoBase(student.photo) : photoBase + student.photo;
    const img = h('img', { src, alt: '', loading: 'lazy', width: size, height: size });
    img.addEventListener('error', () => {
      img.remove();
      wrap.textContent = initials;
    });
    wrap.append(img);
  } else wrap.textContent = initials;
  return wrap;
}

export function electiveBadge(code, extra = '') {
  const info = ELECTIVE_INFO[code];
  if (!info) return h('span', { class: 'badge' }, '—');
  return h('span', { class: `badge el-${code.toLowerCase()}` }, h('span', { 'aria-hidden': 'true' }, info.icon), ` ${info.label}${extra}`);
}

/** Info button (ⓘ): works on hover, tap and keyboard focus; Esc closes; never times out. */
export function info(label, text) {
  const id = `tip-${Math.random().toString(36).slice(2, 8)}`;
  const tip = h('span', { class: 'tip', role: 'tooltip', id, hidden: true }, text);
  const btn = h('button', { type: 'button', class: 'info-btn', 'aria-label': `About ${label}`, 'aria-describedby': id, 'aria-expanded': 'false' }, 'i');
  const wrap = h('span', { class: 'info-wrap' }, btn, tip);
  const show = () => {
    tip.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  };
  const hide = () => {
    tip.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => (tip.hidden ? show() : hide()));
  btn.addEventListener('focus', show);
  btn.addEventListener('blur', hide);
  wrap.addEventListener('mouseenter', show);
  wrap.addEventListener('mouseleave', () => document.activeElement !== btn && hide());
  wrap.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  return wrap;
}

/** Accessible modal dialog. Returns a promise resolved with the button value. */
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], onOpen }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const d = h('dialog', { class: 'dlg', 'aria-labelledby': 'dlg-title' });
    const close = (value) => {
      d.close();
      d.remove();
      if (prev && prev.focus) prev.focus();
      resolve(value);
    };
    const valueOf = (b) => (typeof b.value === 'function' ? b.value(d) : b.value);
    const primary = buttons.find((b) => b.primary);
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); if (primary) close(valueOf(primary)); } },
      h('h2', { id: 'dlg-title' }, title),
      h('div', { class: 'dlg-body' }, body),
      h('div', { class: 'dlg-actions' }, buttons.map((b) =>
        h('button', { type: b.primary ? 'submit' : 'button', class: b.primary ? 'btn primary' : b.danger ? 'btn danger' : 'btn', onclick: b.primary ? null : () => close(valueOf(b)) }, b.label))));
    d.append(form);
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    document.body.append(d);
    d.showModal();
    if (onOpen) onOpen(d);
  });
}

export function field(label, input, hint) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function select(options, value, attrs = {}) {
  return h('select', attrs, options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
}

export function card(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h2', {}, title) : null, ...children);
}

export function emptyState(text, action) {
  return h('div', { class: 'empty' }, h('p', {}, text), action || null);
}
