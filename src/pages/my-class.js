// §9.2 My Class (homeroom teacher): choices, "needs your help", results, line-up.
import { h, clear, photo, electiveBadge, info, dialog, field, announce, emptyState, select } from '../ui.js';
import { db, store, classById, studentsInClass, rotationById, log, studentById } from '../data.js';
import { timetable, stage, eligibility, registration, regStatus, saveRanking, signupOpen, inRotation, answerHelp, requestChange, past } from '../domain.js';
import { ELECTIVES, ELECTIVE_INFO, MAX_CHOICES } from '../engine/constants.js';
import { niceDate } from '../engine/calendar.js';
import { when, rotTitle, teacherRotation, rotationPicker, periodText, gradeName, rotationsForClass } from './common.js';

const STATUS = {
  done: ['✓ Done', 'done'],
  in_progress: ['… In progress', 'progress'],
  not_started: ['○ Not started', 'none'],
};

function lockedReason(studentId, rot, el) {
  // find the rotation in this cycle where the elective was done
  for (const r of [...db.rotations].sort((a, b) => b.number - a.number)) {
    if (r.number >= rot.number) continue;
    const a = db.assignments[r.id]?.[studentId];
    if (a && a.elective === el && a.completion !== 'not_completed') return `${ELECTIVE_INFO[el].label}: already done this cycle (${niceDate(r.fridays[0], false)} – ${niceDate(r.fridays[r.fridays.length - 1], false)})`;
  }
  return `${ELECTIVE_INFO[el].label}: already done this cycle`;
}

function choiceCard(s, rot, refresh) {
  const elig = eligibility(s.id, rot);
  const reg = registration(rot, s.id);
  const ranking = reg?.ranking || [];
  const st = regStatus(rot, s.id);
  const open = signupOpen(rot);
  const [label, cls] = STATUS[st];
  const card = h('article', { class: `scard ${st === 'done' ? 'done' : ''}`, 'aria-label': `${s.name}, ${label}`, id: `card-${s.id}` });
  const tap = (el) => {
    let next = [...ranking];
    if (reg?.anyFine) next = [];
    if (next.includes(el)) next = next.filter((x) => x !== el);
    else if (next.length >= MAX_CHOICES) {
      announce(`${s.first} already has a 1st and a 2nd choice. Tap one of them to change it.`);
      return;
    } else next.push(el);
    saveRanking(rot, s.id, next);
    refresh(s.id, `choice-${s.id}-${el}`);
  };
  const choiceButtons = elig.available.length === 1
    ? [h('div', { class: 'locked' }, '🔒 Only one elective left: ', electiveBadge(elig.available[0]), ' — filled in automatically.')]
    : elig.available.map((el) => {
      const idx = ranking.indexOf(el);
      const rankText = idx === 0 ? '1st' : idx === 1 ? '2nd' : '';
      return h('button', {
        type: 'button', class: 'choice', id: `choice-${s.id}-${el}`, 'aria-pressed': idx >= 0 ? 'true' : 'false', disabled: !open,
        'aria-label': `${s.name}, ${ELECTIVE_INFO[el].label}${idx === 0 ? ', 1st choice' : idx === 1 ? ', 2nd choice' : ', not chosen'}`,
        onclick: () => tap(el),
      }, h('span', { class: 'rank', 'aria-hidden': 'true' }, rankText || '·'), h('span', { 'aria-hidden': 'true' }, ELECTIVE_INFO[el].icon), ELECTIVE_INFO[el].label);
    });
  const lockedList = ELECTIVES.filter((e) => !elig.available.includes(e));
  card.append(
    photo(s, 56, store.photoBase),
    h('div', {},
      h('div', { class: 'row' }, h('span', { class: 'name' }, s.name), h('span', { class: `status ${cls}` }, reg?.anyFine ? '✓ Any is fine' : label)),
      h('div', { class: 'choices', role: 'group', 'aria-label': `Choices for ${s.name}` }, choiceButtons),
      lockedList.length ? h('div', { class: 'locked' }, lockedList.map((e) => h('div', {}, '🔒 ', lockedReason(s.id, rot, e)))) : null,
      open && elig.available.length > 1 ? h('div', { class: 'row', style: { marginTop: '0.5rem' } },
        h('button', { type: 'button', class: 'btn small', 'aria-pressed': reg?.anyFine ? 'true' : 'false', id: `any-${s.id}`, onclick: () => {
          saveRanking(rot, s.id, [], { anyFine: !reg?.anyFine });
          refresh(s.id, `any-${s.id}`);
        } }, reg?.anyFine ? '✓ Absent / any is fine' : 'Absent / any is fine'),
        info('Absent / any is fine', 'Marks the child as done. The app then picks fairly for them, just like a child left blank — they are not used to fill unpopular groups.'),
        ranking.length ? h('button', { type: 'button', class: 'btn small', onclick: () => { saveRanking(rot, s.id, []); refresh(s.id, `choice-${s.id}-${elig.available[0]}`); } }, 'Clear') : null) : null));
  return card;
}

function resultCard(s, rot, refresh) {
  const a = db.assignments[rot.id]?.[s.id];
  const elig = eligibility(s.id, rot);
  const t = timetable(rot);
  const card = h('article', { class: `scard ${a?.needsHelp ? 'help' : 'done'}`, 'aria-label': s.name });
  const flags = [];
  if (a?.placedByApp) flags.push(h('span', { class: 'status none' }, '🤖 Placed by app'));
  if (a?.pinned) flags.push(h('span', { class: 'status none' }, '📌 Moved by a specialist'));
  let help = null;
  if (a?.needsHelp && !past(t.helpDue)) {
    help = h('div', { class: 'banner bad' },
      h('strong', {}, '! Needs your help: '), `${s.first} could only get their last choice. Pick another option by ${when(t.helpDue)}, or leave it as is.`,
      h('div', { class: 'choices' }, elig.available.filter((e) => e !== a.elective).map((e) =>
        h('button', { class: 'choice', onclick: () => { answerHelp(rot, s.id, e); announce(`Saved: ${s.first} would rather do ${ELECTIVE_INFO[e].label}. Groups update at the deadline.`); refresh(); } },
          h('span', { 'aria-hidden': 'true' }, ELECTIVE_INFO[e].icon), ELECTIVE_INFO[e].label))));
  }
  const reg = registration(rot, s.id);
  card.append(photo(s, 56, store.photoBase), h('div', {},
    h('div', { class: 'row' }, h('span', { class: 'name' }, s.name), a ? electiveBadge(a.elective) : h('span', { class: 'status none' }, 'Not placed yet'), ...flags),
    reg?.helpAnswer ? h('div', { class: 'hint' }, `Help answer saved: ${ELECTIVE_INFO[reg.helpAnswer].label} (applied when groups are made again).`) : null,
    help,
    h('div', { class: 'row', style: { marginTop: '0.35rem' } },
      h('button', { class: 'btn small', onclick: async () => {
        const input = h('textarea', { rows: 3, maxlength: 300 });
        const text = await dialog({ title: `Request a change for ${s.first}`, body: [h('p', { class: 'hint' }, 'This goes to the specialists. Don’t include health, behaviour or disability details.'), field('What should change?', input)],
          buttons: [{ label: 'Cancel', value: null }, { label: 'Send', primary: true, value: () => input.value.trim() }], onOpen: () => input.focus() });
        if (text) { requestChange(s.classId, s.id, `${s.name}: ${text}`); announce('Request sent to the specialists.'); }
      } }, 'Request a change'))));
  return card;
}

function whereView(main, c, rot) {
  const kids = studentsInClass(c.id).filter((s) => inRotation(s, rot));
  const a = db.assignments[rot.id] || {};
  main.append(h('h1', {}, `Where does everyone go on Friday? — ${c.code}`),
    h('p', { class: 'classbanner' }, `${gradeName(c.grade)} · ${rotTitle(rot)} · ${periodText(c.grade)}`),
    h('div', { class: 'row noprint' }, h('button', { class: 'btn primary', onclick: () => window.print() }, '🖨 Print line-up sheet'), h('a', { class: 'btn', href: '#/class' }, '← Back to my class')),
    rot.grades[c.grade].publishedAt ? null : h('div', { class: 'banner warn' }, 'Not published yet — these groups may still change.'));
  const grid = h('div', { class: 'grid2' });
  for (const e of ELECTIVES) {
    const list = kids.filter((s) => a[s.id]?.elective === e);
    grid.append(h('section', { class: 'card' },
      h('h2', {}, electiveBadge(e), ` ${list.length} students`),
      h('p', { class: 'hint' }, `Room: ${db.settings.rooms[e]} · ${periodText(c.grade)}`),
      h('ul', {}, list.map((s) => h('li', {}, `${s.first} ${s.last[0] || ''}.`)))));
  }
  main.append(grid, h('p', { class: 'footer-note' }, 'Student information — do not post publicly; shred when done.'));
}

export function renderMyClass(main, { session, params, rerender }) {
  let classId = session.role === 'teacher' ? session.classId : params[1] && classById(params[1]) ? params[1] : null;
  if (session.role !== 'teacher' && !classId) {
    classId = (() => { try { return localStorage.getItem('fe-staff-class'); } catch { return null; } })() || db.classes[0].id;
  }
  const c = classById(classId);
  if (!c) return main.append(emptyState('Class not found.'));
  const rotList = rotationsForClass(c.id);
  let rot = (params[0] && params[0] !== 'where' && rotationById(params[0])) || teacherRotation(c.id);
  if (params[0] === 'where') return rot ? whereView(main, c, rot) : main.append(emptyState('No rotation found.'));

  if (session.role !== 'teacher') {
    main.append(h('div', { class: 'row noprint' }, h('label', { for: 'pick-class' }, 'Class: '),
      select(db.classes.map((x) => ({ value: x.id, label: `${x.code} · ${x.teacher || 'Teacher TBD'}` })), c.id, { id: 'pick-class', onchange: (e) => {
        try { localStorage.setItem('fe-staff-class', e.target.value); } catch {}
        location.hash = `#/class/${rot?.id || ''}/${e.target.value}`;
      } })));
  }
  const kids = studentsInClass(c.id);
  main.append(h('p', { class: 'classbanner' }, `Entering choices for ${(c.teacher || 'Teacher TBD').toUpperCase()} · ${c.code} · ${kids.length} students`));
  if (!rot) return main.append(emptyState('There are no more rotations for this class this year.'));
  const t = timetable(rot);
  const st = stage(rot, c.grade);
  main.append(h('div', { class: 'row' }, h('h1', { style: { margin: 0 } }, rotTitle(rot)), h('span', { class: 'spacer' }),
    rotList.length > 1 ? rotationPicker(rot, (id) => (location.hash = `#/class/${id}${session.role !== 'teacher' ? '/' + c.id : ''}`), rotList) : null));
  main.append(h('p', {}, `Your grade: Fri ${periodText(c.grade)}. Rooms: ${ELECTIVES.map((e) => `${ELECTIVE_INFO[e].label} – ${db.settings.rooms[e]}`).join(' · ')}.`));
  const cancelled = db.cancelled.filter((x) => rot.fridays.includes(x.date) && (!x.grade || x.grade === c.grade));
  for (const x of cancelled) main.append(h('div', { class: 'banner warn' }, `⚠ ${niceDate(x.date)}: ${x.elective ? ELECTIVE_INFO[x.elective].label : 'Friday Electives'} cancelled — ${x.reason}`));

  const steps = h('nav', { class: 'steps', 'aria-label': 'Steps' },
    h('a', { href: `#/ballots/${rot.id}/${c.id}`, class: '' }, 'Step 1 of 3: Print ballots'),
    h('span', { class: st === 'signup' ? 'on' : '' }, 'Step 2 of 3: Enter choices'),
    h('a', { href: '#/class/where', class: ['published', 'running'].includes(st) ? 'on' : '' }, 'Step 3 of 3: Check results'));
  main.append(steps);

  const inRot = kids.filter((s) => inRotation(s, rot));
  if (!inRot.length) return main.append(emptyState(`${c.code} is not in school for these Fridays (track ${c.track} is out). Nothing to do.`));

  const list = h('div', { class: 'students' });
  if (st === 'upcoming' || st === 'signup') {
    const done = () => inRot.filter((s) => regStatus(rot, s.id) === 'done').length;
    const bar = h('div', { class: 'progressbar', role: 'status' });
    const drawBar = () => {
      clear(bar);
      const d = done();
      const nextMissing = inRot.find((s) => regStatus(rot, s.id) !== 'done');
      bar.append(h('strong', {}, `${d} of ${inRot.length} done`), h('span', { class: 'meter', 'aria-hidden': 'true' }, h('span', { style: { width: `${(100 * d) / inRot.length}%` } })),
        nextMissing ? h('button', { class: 'btn small', onclick: () => document.getElementById(`card-${nextMissing.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, 'Next missing ▸') : h('span', { class: 'status done' }, '✓ Everyone done — waiting for approval'),
        h('span', { class: 'hint' }, `Choices close ${when(t.choicesClose)}`));
    };
    const warn = h('div', { class: 'banner warn', role: 'status' });
    const drawWarn = () => {
      const left = inRot.length - done();
      warn.hidden = !(st === 'signup' && left);
      warn.textContent = `${left} student${left === 1 ? '' : 's'} still ${left === 1 ? 'has' : 'have'} no choices. On ${when(t.choicesClose)} the app will choose for them.`;
    };
    drawBar();
    drawWarn();
    main.append(warn);
    if (st === 'upcoming') main.append(h('div', { class: 'banner' }, `Sign-up opens ${when({ date: t.signupOpens, time: '07:00' })}. You can already enter choices.`));
    main.append(bar);
    const refresh = (studentId, focusId) => {
      if (studentId) {
        const old = document.getElementById(`card-${studentId}`);
        const fresh = choiceCard(studentById(studentId), rot, refresh);
        old.replaceWith(fresh);
        if (focusId) document.getElementById(focusId)?.focus();
        const s = studentById(studentId);
        if (regStatus(rot, studentId) === 'done') announce(`${s.first}: done.`, { toast: false });
      }
      drawBar();
      drawWarn();
    };
    for (const s of inRot) list.append(choiceCard(s, rot, refresh));
  } else if (st === 'closed') {
    main.append(h('div', { class: 'banner' }, 'Waiting for approval. Choices are closed and the groups are being made — check back after ', when(t.groupsMade), '.'));
  } else {
    const help = inRot.filter((s) => db.assignments[rot.id]?.[s.id]?.needsHelp).length;
    if (help && !past(t.helpDue)) main.append(h('div', { class: 'banner bad' }, `${help} student${help === 1 ? '' : 's'} need${help === 1 ? 's' : ''} your help — due ${when(t.helpDue)}.`));
    if (!rot.grades[c.grade].publishedAt) main.append(h('div', { class: 'banner' }, `Waiting for approval — the specialists are checking the groups. Published by ${when(t.publishBy)}. Until then, the groups below may still change.`));
    const refresh = () => rerender();
    for (const s of inRot) list.append(resultCard(s, rot, refresh));
  }
  main.append(list);

  main.append(h('div', { class: 'row', style: { marginTop: '1rem' } },
    h('button', { class: 'btn', onclick: async () => {
      const input = h('input', { maxlength: 80 });
      const name = await dialog({ title: 'Someone missing or in the wrong class?', body: [h('p', {}, 'Type the child’s name. The owner and specialists will be told.'), field('Child’s name and what is wrong', input)],
        buttons: [{ label: 'Cancel', value: null }, { label: 'Send', primary: true, value: () => input.value.trim() }], onOpen: () => input.focus() });
      if (name) { requestChange(c.id, null, `Missing / wrong class in ${c.code}: ${name}`); announce('Sent. Thank you!'); }
    } }, 'Someone missing or in the wrong class?')));

  // Changes to my class
  const ids = new Set(kids.map((s) => s.id));
  const changes = db.audit.filter((x) => x.student && ids.has(x.student)).slice(-15).reverse();
  if (changes.length) main.append(h('details', { class: 'card' }, h('summary', {}, `Changes to my class (${changes.length} most recent)`),
    h('ul', {}, changes.map((x) => h('li', {}, `${new Date(x.at).toLocaleString()} — ${x.action} — ${studentById(x.student)?.name} — ${x.who}`)))));
}
