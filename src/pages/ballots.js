// §9.3 Printable picture ballots: one slip per child with only their open electives.
import { h, photo, emptyState } from '../ui.js';
import { db, store, classById, studentsInClass, rotationById } from '../data.js';
import { eligibility, inRotation } from '../domain.js';
import { ELECTIVE_INFO } from '../engine/constants.js';
import { rotTitle, teacherRotation, gradeName } from './common.js';
import { HELP } from '../help-text.js';

export function renderBallots(main, { session, params }) {
  const rot = rotationById(params[0]) || teacherRotation(session.classId);
  const c = classById(params[1] || session.classId);
  if (!rot || !c) return main.append(emptyState('Pick a class first.'));
  const kids = studentsInClass(c.id).filter((s) => inRotation(s, rot));
  let withPhotos = true;
  const sheet = h('div', { class: 'ballots' });
  const draw = () => {
    sheet.replaceChildren(...kids.map((s) => {
      const elig = eligibility(s.id, rot);
      return h('div', { class: 'ballot card', style: { breakInside: 'avoid', marginBottom: '0' } },
        h('div', { class: 'row' }, withPhotos ? photo(s, 48, store.photoBase) : null, h('strong', { style: { fontSize: '1.2rem' } }, s.first), h('span', { class: 'muted' }, ` ${c.code}`)),
        elig.available.length === 1
          ? h('p', {}, `Your elective: ${ELECTIVE_INFO[elig.available[0]].icon} ${ELECTIVE_INFO[elig.available[0]].label}`)
          : h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${elig.available.length}, 1fr)`, gap: '0.5rem', marginTop: '0.5rem', textAlign: 'center' } },
            elig.available.map((e) => h('div', {},
              h('div', { style: { fontSize: '2.2rem', lineHeight: 1 }, 'aria-hidden': 'true' }, ELECTIVE_INFO[e].icon),
              h('div', { style: { fontWeight: 700 } }, ELECTIVE_INFO[e].label),
              h('div', { style: { border: '2px solid currentColor', width: '2.2rem', height: '2.2rem', margin: '0.3rem auto 0', borderRadius: '6px' }, 'aria-label': 'box for number' })))));
    }));
  };
  draw();
  main.append(
    h('div', { class: 'noprint' },
      h('h1', {}, `Picture ballots — ${c.code}`),
      h('p', {}, `${gradeName(c.grade)} · ${rotTitle(rot)} · ${kids.length} children. Each slip shows only the electives that child can still choose.`),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => window.print() }, '🖨 Print ballots'),
        h('button', { class: 'btn', 'aria-pressed': 'true', onclick: (e) => { withPhotos = !withPhotos; e.target.setAttribute('aria-pressed', String(withPhotos)); e.target.textContent = withPhotos ? 'Photos: on' : 'Photos: off'; draw(); } }, 'Photos: on'),
        h('a', { class: 'btn', href: '#/class' }, '← Back to my class')),
      h('div', { class: 'card' }, h('h2', {}, 'What to tell the children (K–2 script)'), h('ul', {}, HELP.myclass.kids.map((k) => h('li', {}, k))),
        h('p', {}, 'Say: “Put a 1 in the box under the one you like most, then 2, then 3.”'))),
    h('h2', { class: 'print-only', style: { display: 'none' } }, `${c.code} — ${rotTitle(rot)}`),
    sheet,
    h('p', { class: 'footer-note' }, 'Student information — do not post publicly; shred when done.'));
}
