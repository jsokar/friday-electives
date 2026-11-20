// §9.4 Specials Board: four electives side by side, moves with reasons, approvals, late changes, inbox.
import { h, clear, photo, electiveBadge, info, dialog, field, announce, emptyState, select } from '../ui.js';
import { db, store, classById, rotationById, studentById, changed, log } from '../data.js';
import {
  timetable, stage, STAGE_LABEL, cohort, groupsOf, sizes, spreadOf, makeGroupsFor, moveStudent, approve, lateStudents,
  suggestFor, eligibility, currentRotation, past, registration,
} from '../domain.js';
import { ELECTIVES, ELECTIVE_INFO, GRADES } from '../engine/constants.js';
import { when, rotationPicker, gradeName, periodText, fridaysText } from './common.js';
import { niceDate } from '../engine/calendar.js';

const REASONS = ['Balance', 'Schedule', 'Teacher request', 'Correcting a mistake', 'Other'];
const RANK = ['', '1st choice', '2nd choice', 'not chosen', 'not chosen'];

function spreadView(sp) {
  if (sp <= 2) return h('span', { class: 'spread-ok' }, `Spread ${sp} ✓ Balanced`);
  if (sp === 3) return h('span', { class: 'spread-warn' }, `Spread ${sp} ⚠ Allowed (biggest − smallest = 3)`);
  return h('span', { class: 'spread-bad' }, `Spread ${sp} ✖ Needs all four specialists to accept`);
}

async function moveDialog(rot, s, myElective, rerender) {
  const a = db.assignments[rot.id]?.[s.id];
  const elig = eligibility(s.id, rot);
  const reason = select(REASONS.map((r) => ({ value: r, label: r })), 'Balance');
  const note = h('input', { maxlength: 120, placeholder: 'Short note (optional)' });
  let target = null;
  const btns = ELECTIVES.map((e) => {
    const allowed = elig.available.includes(e);
    return h('button', { type: 'button', class: `btn el-${e.toLowerCase()}`, 'aria-pressed': 'false', disabled: a?.elective === e,
      onclick: (ev) => {
        target = e;
        for (const b of ev.target.parentElement.children) b.setAttribute('aria-pressed', 'false');
        ev.target.setAttribute('aria-pressed', 'true');
      } }, `${ELECTIVE_INFO[e].icon} ${ELECTIVE_INFO[e].label}${a?.elective === e ? ' (now)' : ''}${allowed ? '' : ' — would repeat'}`);
  });
  const ok = await dialog({
    title: `Move ${s.name}`,
    body: [
      h('p', {}, `${classById(s.classId).code} · now in ${a ? ELECTIVE_INFO[a.elective].label : '—'}`),
      h('div', { class: 'bigbtns', role: 'group', 'aria-label': 'Move to' }, btns),
      field('Reason', reason),
      field('Note', note, 'Don’t enter health, behaviour or disability details.'),
    ],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Move', primary: true, value: true }],
  });
  if (!ok || !target) return;
  let r = moveStudent(rot, s.id, target, reason.value, note.value.trim());
  if (!r.ok && r.repeat) {
    const sure = await dialog({ title: 'This would be a repeat', body: h('p', {}, `${s.first} already did ${ELECTIVE_INFO[target].label} in this cycle. Only do this if all four specialists agree.`),
      buttons: [{ label: 'Cancel', value: false }, { label: 'All four agree — move', danger: true, value: true }] });
    if (!sure) return;
    r = moveStudent(rot, s.id, target, reason.value, `${note.value.trim()} [repeat agreed by all four]`, { allowRepeat: true });
  }
  const sz = sizes(rot, s.grade);
  announce(`${s.first} moved to ${ELECTIVE_INFO[target].label}. ${ELECTIVES.map((e) => `${ELECTIVE_INFO[e].label} ${sz[e]}`).join(', ')}. Spread ${spreadOf(sz)}.`);
  rerender();
}

function inbox(main, session, rerender) {
  const mine = db.inbox.filter((m) => m.to === session.elective || (session.role === 'owner' && m.to === 'owner') || (session.role === 'owner' && ELECTIVES.includes(m.to))).slice().reverse();
  main.append(h('h1', {}, 'Inbox'), h('a', { class: 'btn', href: '#/board' }, '← Back to the board'));
  if (!mine.length) main.append(emptyState('No notices.'));
  else main.append(h('div', { class: 'card' }, h('button', { class: 'btn small', onclick: () => { mine.forEach((m) => (m.read = true)); changed(); rerender(); } }, 'Mark all read'),
    h('ul', {}, mine.slice(0, 100).map((m) => h('li', { style: { fontWeight: m.read ? 400 : 700 } }, `${new Date(m.at).toLocaleString()} — ${m.to === 'owner' ? 'Owner' : ELECTIVE_INFO[m.to]?.label || m.to}: ${m.text}`)))));
  const open = db.requests.filter((r) => r.status === 'open');
  main.append(h('div', { class: 'card' }, h('h2', {}, `Requests from teachers (${open.length} open)`),
    db.requests.length ? h('ul', {}, db.requests.slice().reverse().map((r) => h('li', {}, `${new Date(r.at).toLocaleString()} — ${r.text} `,
      h('button', { class: 'btn small', onclick: () => { r.status = r.status === 'open' ? 'done' : 'open'; log('request ' + r.status, { request: r.id }); changed(); rerender(); } }, r.status === 'open' ? 'Mark done' : '✓ Done — reopen')))) : h('p', { class: 'muted' }, 'None.')));
}

export function renderBoard(main, { session, params, rerender }) {
  if (params[0] === 'inbox') return inbox(main, session, rerender);
  const rot = rotationById(params[0]) || currentRotation();
  let grade = params[1] || (() => { try { return localStorage.getItem('fe-board-grade'); } catch { return null; } })() || '5';
  if (!GRADES.includes(grade)) grade = '5';
  try { localStorage.setItem('fe-board-grade', grade); } catch {}
  const goTo = (r, g) => (location.hash = `#/board/${r}/${g}`);
  const t = timetable(rot);
  const st = stage(rot, grade);
  const gs = rot.grades[grade];
  const people = cohort(rot, grade);

  main.append(h('div', { class: 'row noprint' },
    h('h1', { style: { margin: 0 } }, 'Specials Board'),
    h('span', { class: 'spacer' }),
    rotationPicker(rot, (id) => goTo(id, grade)),
    h('a', { class: 'btn small', href: '#/board/inbox' }, '📬 Inbox'),
    session.role === 'specialist' ? h('a', { class: 'btn small', href: `#/reports/packet/${rot.id}/${session.elective}` }, '🖨 My Friday packet') : null));
  main.append(h('div', { class: 'row noprint', role: 'tablist', 'aria-label': 'Grade', style: { margin: '0.75rem 0' } },
    GRADES.map((g) => h('button', { class: `btn${g === grade ? ' primary' : ''}`, role: 'tab', 'aria-selected': g === grade ? 'true' : 'false', onclick: () => goTo(rot.id, g) }, gradeName(g)))));

  main.append(h('p', {}, `${gradeName(grade)} · ${fridaysText(rot)} · ${periodText(grade)} · Tracks ${rot.tracks.join(' + ')} · ${people.length} students · `,
    h('strong', {}, STAGE_LABEL[st]), ` · Publish by ${when(t.publishBy)}`));

  if (!people.length) return main.append(emptyState('No students of this grade are in school for these Fridays.'));

  // No groups yet
  if (!gs.runId) {
    const lastRun = [...db.runs].reverse().find((r) => r.rotationId === rot.id && r.grade === grade);
    main.append(h('div', { class: 'card' },
      h('h2', {}, 'Groups not made yet'),
      h('p', {}, `The app makes them automatically when choices close (${when(t.choicesClose)}) — nobody needs to press anything. You can make a preview now; the app still makes the final groups at the deadline with the latest choices.`),
      h('button', { class: 'btn primary', onclick: () => {
        const run = makeGroupsFor(rot, grade, { by: `${session.role === 'specialist' ? ELECTIVE_INFO[session.elective].label + ' specialist' : 'Owner'}` });
        announce(run.result.ok ? 'Groups made.' : 'No balanced split found — see the reasons.');
        rerender();
      } }, 'Make groups now'),
      lastRun && !lastRun.result.ok ? problemBox(rot, grade, lastRun, session, rerender) : null));
    return;
  }

  const groups = groupsOf(rot, grade);
  const sz = sizes(rot, grade);
  const sp = spreadOf(sz);
  const late = lateStudents(rot, grade);
  const assigned = db.assignments[rot.id] || {};
  const my = session.role === 'specialist' ? session.elective : null;

  const head = h('div', { class: 'boardhead', role: 'status' },
    ELECTIVES.map((e) => h('span', {}, electiveBadge(e, ` ${sz[e]}`), gs.approvals[e] ? h('span', { class: 'status done', title: `Approved by ${gs.approvals[e].by}` }, ' ✓') : h('span', { class: 'status none' }, ' ○'))),
    spreadView(sp), info('spread', 'Spread = biggest group minus smallest group in this grade. 2 or less is the goal; 3 is allowed; more needs all four specialists.'),
    h('span', { class: 'spacer' }),
    !gs.publishedAt ? h('button', { class: 'btn small', onclick: async () => {
      const pins = Object.values(assigned).filter((a) => a.pinned).length;
      const ok = await dialog({ title: 'Make groups again?', body: h('p', {}, `This uses the latest choices. ${pins} moved student(s) stay where they are (pinned). All approvals for this grade start again.`), buttons: [{ label: 'Cancel', value: false }, { label: 'Make groups again', primary: true, value: true }] });
      if (!ok) return;
      const run = makeGroupsFor(rot, grade, { by: my ? `${ELECTIVE_INFO[my].label} specialist` : 'Owner' });
      announce(run.result.ok ? `Groups made again. Spread ${run.result.spread}.` : 'No balanced split found.');
      rerender();
    } }, 'Make groups again') : null,
    my && !gs.publishedAt ? (gs.approvals[my]
      ? h('span', { class: 'status done' }, `✓ ${ELECTIVE_INFO[my].label} approved`)
      : h('button', { class: 'btn primary small', onclick: async () => {
        if (sp > 3) {
          const ok = await dialog({ title: 'Big spread', body: h('p', {}, `The spread is ${sp}. Approve only if all four specialists accept it.`), buttons: [{ label: 'Cancel', value: false }, { label: 'We all accept', danger: true, value: true }] });
          if (!ok) return;
        }
        approve(rot, grade, my, `${ELECTIVE_INFO[my].label} specialist`);
        announce(rot.grades[grade].publishedAt ? `${gradeName(grade)} is published.` : `${ELECTIVE_INFO[my].label} approved for ${gradeName(grade)}.`);
        rerender();
      } }, `Approve ${ELECTIVE_INFO[my].label}`)) : null,
    my && !gs.publishedAt ? h('button', { class: 'btn small', onclick: () => {
      let n = 0;
      for (const g of GRADES) {
        const s2 = stage(rot, g);
        if (s2 === 'review' && !rot.grades[g].approvals[my] && spreadOf(sizes(rot, g)) <= 3) { approve(rot, g, my, `${ELECTIVE_INFO[my].label} specialist`); n++; }
      }
      announce(`${ELECTIVE_INFO[my].label} approved for ${n} grade(s) in ${rot.id}.`);
      rerender();
    } }, 'Approve all my grades') : null,
    session.role === 'owner' && !gs.publishedAt ? h('button', { class: 'btn small', onclick: async () => {
      const ok = await dialog({ title: 'Approve for everyone?', body: h('p', {}, 'Approve every elective that is not approved yet, on behalf of the specialists. This is logged.'), buttons: [{ label: 'Cancel', value: false }, { label: 'Approve and publish', primary: true, value: true }] });
      if (!ok) return;
      for (const e of ELECTIVES) if (!gs.approvals[e]) approve(rot, grade, e, 'Owner (on behalf)');
      rerender();
    } }, 'Approve all (owner)') : null,
    gs.publishedAt ? h('span', { class: 'status done' }, `✓ Published ${new Date(gs.publishedAt).toLocaleDateString()}`) : null,
    h('a', { class: 'btn small', href: `#/reports/grade/${rot.id}/${grade}` }, `🖨 Print ${gradeName(grade)}`),
    my ? null : h('a', { class: 'btn small', href: `#/reports/index/${rot.id}` }, '🖨 All printouts'));
  main.append(head);

  if (late.length) {
    main.append(h('div', { class: 'banner warn' }, h('strong', {}, `Late changes — ${late.length} student(s) without a group: `),
      h('ul', {}, late.map((s) => {
        const sug = suggestFor(rot, s.id);
        return h('li', {}, `${s.name} (${classById(s.classId).code}) → suggested ${ELECTIVE_INFO[sug].label} `,
          h('button', { class: 'btn small primary', onclick: () => { moveStudent(rot, s.id, sug, 'Late arrival', 'smallest eligible group'); announce(`${s.first} added to ${ELECTIVE_INFO[sug].label}.`); rerender(); } }, 'Confirm'),
          ' ', h('button', { class: 'btn small', onclick: () => moveDialog(rot, s, my, rerender) }, 'Choose…'));
      }))));
  }

  // filters
  let filter = 'all';
  const columns = h('div', { class: 'columns' });
  const tabs = h('div', { class: 'eltabs', role: 'tablist', 'aria-label': 'Elective' });
  let shown = my || 'MUSIC';
  const drawColumns = () => {
    clear(columns);
    clear(tabs);
    for (const e of ELECTIVES) {
      tabs.append(h('button', { class: 'btn', role: 'tab', 'aria-selected': e === shown ? 'true' : 'false', onclick: () => { shown = e; drawColumns(); } }, `${ELECTIVE_INFO[e].label} ${sz[e]}`));
      const list = groups[e]
        .filter((s) => filter === 'all' || needsAttention(rot, s, assigned[s.id]))
        .sort((a, b) => (a.lastSort || a.last).localeCompare(b.lastSort || b.last));
      const col = h('section', { class: `col${e === shown ? ' show' : ''}`, 'aria-label': `${ELECTIVE_INFO[e].label}, ${groups[e].length} students` },
        h('h2', {}, electiveBadge(e), h('span', {}, `${groups[e].length}`)),
        h('ul', {}, list.map((s) => {
          const a = assigned[s.id];
          const flags = [a.pinned ? '📌' : '', a.placedByApp ? '🤖' : '', a.rank >= 3 && a.hadChoices ? '⚠' : ''].join('');
          const btn = h('button', { draggable: 'true', 'aria-label': `${s.name}, ${classById(s.classId).code}, got ${RANK[a.rank] || '—'} choice${a.pinned ? ', moved by a specialist' : ''}${a.placedByApp ? ', placed by app' : ''}. Activate to move.`,
            onclick: () => moveDialog(rot, s, my, rerender) },
            photo(s, 36, store.photoBase),
            h('span', {}, h('div', {}, s.name), h('div', { class: 'meta' }, `${classById(s.classId).code} · ${RANK[a.rank] || '—'}`)),
            h('span', { class: 'flag', 'aria-hidden': 'true' }, flags));
          btn.addEventListener('dragstart', (ev) => ev.dataTransfer.setData('text/plain', s.id));
          return h('li', {}, btn);
        })));
      col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', async (ev) => {
        ev.preventDefault();
        col.classList.remove('drop');
        const id = ev.dataTransfer.getData('text/plain');
        const s = studentById(id);
        if (!s || assigned[id]?.elective === e) return;
        const reason = select(REASONS.map((r) => ({ value: r, label: r })), 'Balance');
        const ok = await dialog({ title: `Move ${s.first} to ${ELECTIVE_INFO[e].label}?`, body: field('Reason', reason), buttons: [{ label: 'Cancel', value: false }, { label: 'Move', primary: true, value: true }] });
        if (!ok) return;
        let r = moveStudent(rot, id, e, reason.value);
        if (!r.ok) {
          announce(`${s.first} already did ${ELECTIVE_INFO[e].label} this cycle. Use “Move to…” to make an agreed exception.`, { kind: 'bad' });
          return;
        }
        rerender();
      });
      columns.append(col);
    }
  };
  main.append(h('div', { class: 'row noprint', style: { marginBottom: '0.5rem' } },
    h('label', {}, h('input', { type: 'checkbox', onchange: (e) => { filter = e.target.checked ? 'attention' : 'all'; drawColumns(); } }), ' Show only students needing attention'),
    info('needing attention', 'Students who got their last choice, need a teacher’s help, were placed by the app, or were moved by hand.')));
  drawColumns();
  main.append(tabs, columns);
  const lastRun = db.runs.find((r) => r.id === gs.runId);
  if (lastRun?.result?.warnings?.length) main.append(h('details', { class: 'card' }, h('summary', {}, 'Notes from making groups'), h('ul', {}, lastRun.result.warnings.map((w) => h('li', {}, w)))));
}

function needsAttention(rot, s, a) {
  return a && ((a.rank >= 3 && a.hadChoices) || a.placedByApp || a.pinned);
}

function problemBox(rot, grade, run, session, rerender) {
  return h('div', { class: 'banner bad', role: 'alert' },
    h('strong', {}, 'No balanced split was possible with spread 3 or less:'),
    h('ul', {}, run.result.problems.map((p) => h('li', {}, p))),
    h('p', {}, 'Options (all four specialists should agree):'),
    h('button', { class: 'btn', onclick: () => {
      const r = makeGroupsFor(rot, grade, { by: 'Specialists (bigger spread agreed)', spreads: [4, 5, 6, 8, 10] });
      announce(r.result.ok ? `Groups made with spread ${r.result.spread}.` : 'Still not possible — use moves with an agreed repeat.');
      rerender();
    } }, 'Make groups with a bigger spread'));
}
