// §13 Printouts (HTML print views, letter size, black and white). "Save as PDF" from the print dialog.
import { h, card, electiveBadge, emptyState, select } from '../ui.js';
import { db, classById, rotationById, studentsInClass, sortByName } from '../data.js';
import { groupsOf, sizes, spreadOf, cohort, currentRotation, stage, STAGE_LABEL, regStatus, inRotation, heldFor } from '../domain.js';
import { ELECTIVES, ELECTIVE_INFO, GRADES } from '../engine/constants.js';
import { niceDate } from '../engine/calendar.js';
import { gradeName, periodText, fridaysText, rotationPicker } from './common.js';

const PERIOD_ORDER = ['5', '4', '3', '1', 'K', '2'];
const school = () => (db.settings.schoolName ? `${db.settings.schoolName} · ` : '');
const FOOT = () => h('p', { class: 'footer-note' }, `Student information — do not post publicly; shred when done. Printed ${new Date().toLocaleString()}.`);
const printBar = (back = '#/reports') => h('div', { class: 'row noprint', style: { marginBottom: '1rem' } }, h('button', { class: 'btn primary', onclick: () => window.print() }, '🖨 Print / Save as PDF'), h('a', { class: 'btn', href: back }, '← All printouts'));
const shortName = (s) => `${s.last}, ${s.first}`;

function gradeRoster(main, rot, grade) {
  const g = groupsOf(rot, grade);
  main.append(printBar(), h('div', { class: 'printpage' },
    h('h1', {}, `${school()}Friday Electives — ${gradeName(grade)}`),
    h('p', {}, `${rot.id} · ${fridaysText(rot)} · ${periodText(grade)} · Spread ${spreadOf(sizes(rot, grade))}`),
    h('div', { class: 'columns' }, ELECTIVES.map((e) => h('section', { class: 'col show' },
      h('h2', {}, `${ELECTIVE_INFO[e].label} (${g[e].length})`), h('p', { class: 'hint', style: { padding: '0 0.75rem' } }, db.settings.rooms[e]),
      h('ol', {}, sortByName(g[e]).map((s) => h('li', {}, `${shortName(s)} — ${classById(s.classId).code}`)))))),
    FOOT()));
}

function packet(main, rot, elective) {
  main.append(printBar(), h('p', { class: 'noprint' }, `My Friday packet — ${ELECTIVE_INFO[elective].label}, ${rot.id}. One page per period, in time order.`));
  for (const grade of PERIOD_ORDER) {
    const list = sortByName(groupsOf(rot, grade)[elective]);
    if (!list.length) continue;
    const held = heldFor(rot, grade, elective);
    main.append(h('section', { class: 'printpage card' },
      h('h1', {}, `${ELECTIVE_INFO[elective].label} — ${gradeName(grade)} — ${periodText(grade)}`),
      h('p', {}, `${school()}Friday Electives · ${rot.id}:${fridaysText(rot)} · Room: ${db.settings.rooms[elective]} · ${list.length} students`),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Student'), h('th', {}, 'Class / Track'), held.map((d) => h('th', {}, niceDate(d, false))), h('th', {}, 'Notes'))),
        h('tbody', {}, list.map((s, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, shortName(s)), h('td', {}, `${classById(s.classId).code} · T${classById(s.classId).track}`), held.map(() => h('td', {}, '☐')), h('td', { style: { width: '30%' } }, ''))))),
      FOOT()));
  }
}

function attendanceSheet(main, rot, grade, elective) {
  const list = sortByName(groupsOf(rot, grade)[elective]);
  main.append(printBar(), h('div', { class: 'printpage' },
    h('h1', {}, `Attendance — ${ELECTIVE_INFO[elective].label} — ${gradeName(grade)}`),
    h('p', {}, `${rot.id}: ${fridaysText(rot)} · ${periodText(grade)} · Mark A (absent) or E (excused); leave blank if present.`),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', {}, 'Class'), rot.fridays.map((d) => h('th', {}, niceDate(d, false))))),
      h('tbody', {}, list.map((s) => h('tr', {}, h('td', {}, shortName(s)), h('td', {}, classById(s.classId).code), rot.fridays.map(() => h('td', {}, ''))))))),
    FOOT());
}

function lineup(main, rot, c) {
  const a = db.assignments[rot.id] || {};
  const kids = studentsInClass(c.id).filter((s) => inRotation(s, rot));
  main.append(printBar(), h('div', { class: 'printpage' },
    h('h1', {}, `Line-up — ${c.code} (${c.teacher || 'Teacher TBD'})`),
    h('p', {}, `${fridaysText(rot)} · ${periodText(c.grade)}`),
    h('div', { class: 'grid2' }, ELECTIVES.map((e) => h('div', {}, h('h2', {}, `${ELECTIVE_INFO[e].label} — ${db.settings.rooms[e]}`),
      h('ul', {}, kids.filter((s) => a[s.id]?.elective === e).map((s) => h('li', {}, `${s.first} ${s.last[0] || ''}.`)))))),
    FOOT()));
}

function statusReport(main, rot) {
  main.append(printBar(), h('h1', {}, `Sign-up status — ${rot.id} (${fridaysText(rot)})`),
    h('table', {}, h('thead', {}, h('tr', {}, ['Class', 'Teacher', 'Done', 'In progress', 'Not started', 'Needs help'].map((x) => h('th', {}, x)))),
      h('tbody', {}, db.classes.filter((c) => rot.tracks.includes(c.track)).map((c) => {
        const kids = studentsInClass(c.id);
        const n = { done: 0, in_progress: 0, not_started: 0 };
        for (const s of kids) n[regStatus(rot, s.id)]++;
        const help = kids.filter((s) => db.assignments[rot.id]?.[s.id]?.needsHelp).length;
        return h('tr', {}, h('td', {}, c.code), h('td', {}, c.teacher || 'TBD'), h('td', {}, n.done), h('td', {}, n.in_progress), h('td', {}, n.not_started), h('td', {}, help));
      }))), FOOT());
}

function balance(main, rot) {
  main.append(printBar(), h('h1', {}, `Balance summary — ${rot.id}`),
    h('table', {}, h('thead', {}, h('tr', {}, ['Grade', 'Status', ...ELECTIVES.map((e) => ELECTIVE_INFO[e].label), 'Spread'].map((x) => h('th', {}, x)))),
      h('tbody', {}, GRADES.map((g) => {
        const sz = sizes(rot, g);
        return h('tr', {}, h('td', {}, gradeName(g)), h('td', {}, STAGE_LABEL[stage(rot, g)]), ELECTIVES.map((e) => h('td', {}, sz[e])), h('td', {}, spreadOf(sz)));
      }))), FOOT());
}

function history(main, grade) {
  const rots = [...db.rotations].sort((a, b) => a.number - b.number);
  const cell = (r, s) => {
    const a = db.assignments[r.id]?.[s.id];
    if (!a) return h('td', {}, '');
    const mark = a.completion === 'not_completed' ? ' ✖' : a.completion === 'completed' ? ' ✓' : '';
    return h('td', {}, `${ELECTIVE_INFO[a.elective].label}${mark}`);
  };
  const people = sortByName(db.students.filter((s) => s.grade === grade && s.active));
  const body = h('tbody', {}, people.map((s) => h('tr', {}, h('td', {}, shortName(s)), h('td', {}, classById(s.classId).code), rots.map((r) => cell(r, s)))));
  const head = h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', {}, 'Class'), rots.map((r) => h('th', {}, r.id))));
  main.append(printBar(), h('h1', {}, `Student history — ${gradeName(grade)}`), h('div', { class: 'tablewrap' }, h('table', {}, head, body)), FOOT());
}

function csvDownload(rot) {
  const rows = [['Rotation', 'Grade', 'Elective', 'Last', 'First', 'Class', 'Track']];
  for (const g of GRADES) for (const e of ELECTIVES) for (const s of sortByName(groupsOf(rot, g)[e])) rows.push([rot.id, g, ELECTIVE_INFO[e].label, s.last, s.first, classById(s.classId).code, classById(s.classId).track]);
  const safe = (v) => { const t = String(v); return /^[=+\-@]/.test(t) ? `'${t}` : t; };
  const csv = rows.map((r) => r.map((v) => `"${safe(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `friday-electives-${rot.id}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
}

export function renderReports(main, { session, params }) {
  const [kind, a, b, c] = params;
  if (kind === 'grade') return gradeRoster(main, rotationById(a), b);
  if (kind === 'packet') return packet(main, rotationById(a), b);
  if (kind === 'attendance') return attendanceSheet(main, rotationById(a), b, c);
  if (kind === 'lineup') return lineup(main, rotationById(a), classById(b));
  if (kind === 'status') return statusReport(main, rotationById(a));
  if (kind === 'balance') return balance(main, rotationById(a));
  if (kind === 'history') return history(main, a || '5');

  const rot = rotationById(a) || currentRotation();
  const el = session.elective || 'MUSIC';
  main.append(h('div', { class: 'row' }, h('h1', { style: { margin: 0 } }, 'Printouts'), h('span', { class: 'spacer' }), rotationPicker(rot, (id) => (location.hash = `#/reports/index/${id}`))));
  const link = (href, label, hint) => h('li', {}, h('a', { href }, label), hint ? h('span', { class: 'hint' }, ` — ${hint}`) : null);
  main.append(card(`For ${rot.id} (${fridaysText(rot)})`, h('ul', {},
    ELECTIVES.map((e) => link(`#/reports/packet/${rot.id}/${e}`, `My Friday packet — ${ELECTIVE_INFO[e].label}`, e === el ? 'yours' : null)),
    GRADES.map((g) => link(`#/reports/grade/${rot.id}/${g}`, `Combined roster — ${gradeName(g)}`)),
    link(`#/reports/status/${rot.id}`, 'Sign-up status by class'),
    link(`#/reports/balance/${rot.id}`, 'Balance summary'),
    h('li', {}, h('button', { class: 'btn small', onclick: () => csvDownload(rot) }, 'Download groups as a spreadsheet (CSV)')))));
  main.append(card('Line-up sheets (homeroom)', h('div', { class: 'picklist' }, db.classes.filter((x) => rot.tracks.includes(x.track)).map((x) => h('a', { class: 'btn', href: `#/reports/lineup/${rot.id}/${x.id}` }, x.code)))));
  main.append(card('Student history', h('div', { class: 'row' }, GRADES.map((g) => h('a', { class: 'btn', href: `#/reports/history/${g}` }, gradeName(g))))));
}
