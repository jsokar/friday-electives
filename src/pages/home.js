// §9.1 Home — "What do I need to do?"
import { h, card } from '../ui.js';
import { db, classById, studentsInClass, todayISO } from '../data.js';
import { timetable, stage, STAGE_LABEL, regStatus, inRotation, cohort } from '../domain.js';
import { ELECTIVES, ELECTIVE_INFO, GRADES } from '../engine/constants.js';
import { when, rotTitle, teacherRotation, gradeName, fridaysText, isFridayToday, periodText } from './common.js';

function nextStep(text, href, label, calm = false) {
  return h('section', { class: `nextstep${calm ? ' calm' : ''}`, 'aria-label': 'Your next step' },
    h('div', { class: 'big' }, text),
    h('span', { class: 'spacer' }),
    href ? h('a', { class: 'btn primary', href }, `${label} →`) : null);
}

function teacherHome(session) {
  const c = classById(session.classId);
  const rot = teacherRotation(c.id);
  if (!rot) return nextStep('Nothing to do now. There are no more rotations for your class this year.', null, null, true);
  const st = stage(rot, c.grade);
  const t = timetable(rot);
  const kids = studentsInClass(c.id).filter((s) => inRotation(s, rot));
  if (st === 'upcoming') return nextStep(`Nothing to do yet. Sign-up for ${rotTitle(rot)} opens ${when({ date: t.signupOpens, time: '07:00' })}.`, '#/class', 'See my class', true);
  if (st === 'signup') {
    const left = kids.filter((s) => regStatus(rot, s.id) !== 'done').length;
    if (left) return nextStep(`Enter choices for ${left} student${left === 1 ? '' : 's'} in ${c.code} — closes ${when(t.choicesClose)}. After that, the app will choose for them.`, '#/class', 'Enter choices');
    return nextStep(`✓ All choices entered — waiting for approval. The app makes the groups after ${when(t.choicesClose)}, then the specialists approve them by ${when(t.publishBy)}. You can still change choices until the first date.`, '#/class', 'Review choices', true);
  }
  if (st === 'closed') return nextStep(`Waiting for approval — choices are closed and the groups are being made for ${rotTitle(rot)}.`, null, null, true);
  if (st === 'review') {
    const help = kids.filter((s) => db.assignments[rot.id]?.[s.id]?.needsHelp).length;
    if (help) return nextStep(`Choose a new elective for ${help} student${help === 1 ? '' : 's'} — due ${when(t.helpDue)}.`, '#/class', 'Help now');
    return nextStep(`Waiting for approval — the specialists are checking the groups. They will be published by ${when(t.publishBy)}.`, '#/class', 'See my class', true);
  }
  return nextStep(`Groups are ready for ${rotTitle(rot)}. Your grade goes Fridays ${periodText(c.grade)}.`, '#/class/where', 'Where does everyone go?');
}

function specialistSteps(session) {
  const out = [];
  const toApprove = [];
  for (const r of db.rotations) for (const g of GRADES) {
    if (stage(r, g) !== 'review') continue;
    const missing = session.role === 'specialist' ? (r.grades[g].approvals[session.elective] ? [] : [session.elective]) : ELECTIVES.filter((e) => !r.grades[g].approvals[e]);
    if (missing.length) toApprove.push({ r, g, missing });
  }
  if (toApprove.length) {
    const first = toApprove[0];
    out.push(nextStep(`${toApprove.length} grade${toApprove.length === 1 ? '' : 's'} waiting for approval${session.role === 'specialist' ? ' of ' + ELECTIVE_INFO[session.elective].label : ''}. Deadline ${when(timetable(first.r).publishBy)}.`, `#/board/${first.r.id}/${first.g}`, 'Check & approve'));
  }
  const unread = db.inbox.filter((m) => !m.read && (m.to === session.elective || (session.role === 'owner' && m.to === 'owner')));
  if (unread.length) out.push(nextStep(`${unread.length} new notice${unread.length === 1 ? '' : 's'} in your inbox.`, '#/board/inbox', 'Open inbox', true));
  if (!out.length) out.push(nextStep('Nothing to do right now.', '#/schedule', 'See the schedule', true));
  return out;
}

export function renderHome(main, { session }) {
  main.append(h('h1', {}, 'What do I need to do?'));
  if (session.role === 'teacher') main.append(teacherHome(session));
  else main.append(...specialistSteps(session));

  // Rotation overview
  const today = todayISO();
  const rows = [...db.rotations].sort((a, b) => a.number - b.number).map((r) => {
    const t = timetable(r);
    const grades = session.role === 'teacher' ? [classById(session.classId).grade] : GRADES;
    return h('tr', { class: r.fridays[r.fridays.length - 1] < today ? 'muted' : '' },
      h('th', { scope: 'row' }, r.id),
      h('td', {}, fridaysText(r)),
      h('td', {}, r.tracks.join(' + ')),
      h('td', {}, when(t.choicesClose)),
      h('td', {}, when(t.publishBy)),
      h('td', {}, grades.map((g) => cohort(r, g).length ? h('div', {}, `${gradeName(g)}: ${STAGE_LABEL[stage(r, g)]}`) : null)));
  });
  main.append(card('Rotations this semester',
    h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Rotation', 'Fridays', 'Tracks in school', 'Choices close', 'Published by', 'Status'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, rows)))));
}
