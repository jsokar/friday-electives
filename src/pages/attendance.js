// §9.5 Attendance: everyone present by default; tap to mark absent / excused. Cancel a session.
import { h, photo, electiveBadge, dialog, field, announce, emptyState, select } from '../ui.js';
import { db, store, classById, rotationById, changed, log, todayISO, sortByName, now } from '../data.js';
import { groupsOf, setAttendance, attendanceOf, cancelledFor, computeCompletion, teachingRotation, timetable, lockCompletion } from '../domain.js';
import { ELECTIVES, ELECTIVE_INFO, GRADES } from '../engine/constants.js';
import { niceDate } from '../engine/calendar.js';
import { rotationPicker, gradeName, periodText, when } from './common.js';

const NEXT = { present: 'absent', absent: 'excused', excused: 'present' };
const LABEL = { present: 'Present', absent: 'Absent', excused: 'Excused' };

export function renderAttendance(main, { session, params, rerender }) {
  const rot = rotationById(params[0]) || teachingRotation();
  const today = todayISO();
  const date = params[1] && rot.fridays.includes(params[1]) ? params[1] : rot.fridays.find((d) => d >= today) && rot.fridays.includes(today) ? today : rot.fridays.filter((d) => d <= today).pop() || rot.fridays[0];
  const grade = GRADES.includes(params[2]) ? params[2] : '5';
  const elective = ELECTIVES.includes(params[3]) ? params[3] : session.elective || 'MUSIC';
  const goTo = (r, d, g, e) => (location.hash = `#/attendance/${r}/${d}/${g}/${e}`);
  const gs = rot.grades[grade];

  main.append(h('div', { class: 'row' }, h('h1', { style: { margin: 0 } }, 'Attendance'), h('span', { class: 'spacer' }), rotationPicker(rot, (id) => goTo(id, rotationById(id).fridays[0], grade, elective))));
  main.append(h('div', { class: 'row', style: { margin: '0.75rem 0' } },
    h('label', {}, 'Friday ', select(rot.fridays.map((d) => ({ value: d, label: niceDate(d) })), date, { onchange: (e) => goTo(rot.id, e.target.value, grade, elective) })),
    h('label', {}, 'Period ', select(GRADES.map((g) => ({ value: g, label: `${gradeName(g)} · ${periodText(g)}` })), grade, { onchange: (e) => goTo(rot.id, date, e.target.value, elective) })),
    session.role === 'owner' || true ? h('label', {}, 'Elective ', select(ELECTIVES.map((e) => ({ value: e, label: ELECTIVE_INFO[e].label })), elective, { onchange: (e) => goTo(rot.id, date, grade, e.target.value) })) : null));

  if (!gs.publishedAt) return main.append(emptyState(`${gradeName(grade)} groups for ${rot.id} are not published yet.`));
  if (cancelledFor(date, grade, elective)) {
    const c = db.cancelled.find((x) => x.date === date && (!x.grade || x.grade === grade) && (!x.elective || x.elective === elective));
    main.append(h('div', { class: 'banner warn' }, `This session was cancelled: ${c.reason}. It doesn’t count against anyone.`,
      h('button', { class: 'btn small', onclick: () => { db.cancelled.splice(db.cancelled.indexOf(c), 1); log('uncancel', { date }); changed(); rerender(); } }, 'Undo cancel')));
    return;
  }
  const list = sortByName(groupsOf(rot, grade)[elective]);
  const locked = !!gs.completionLockedAt;
  const t = timetable(rot);
  main.append(h('p', {}, electiveBadge(elective), ` ${gradeName(grade)} · ${niceDate(date)} · ${periodText(grade)} · ${list.length} students. `,
    locked ? h('strong', {}, 'Completion is locked.') : `You can correct this until ${when(t.completionLock)}.`));
  const counts = { present: 0, absent: 0, excused: 0 };
  for (const s of list) counts[attendanceOf(rot, date, s.id)]++;
  main.append(h('p', { role: 'status' }, `Present ${counts.present} · Absent ${counts.absent} · Excused ${counts.excused}`));
  main.append(h('div', { class: 'att' }, list.map((s) => {
    const v = attendanceOf(rot, date, s.id);
    return h('button', { 'data-v': v, disabled: locked, 'aria-label': `${s.name}, ${LABEL[v]}. Activate to change.`, onclick: () => {
      setAttendance(rot, date, s.id, NEXT[v]);
      log('attendance', { rotation: rot.id, date, student: s.id, value: NEXT[v] });
      rerender();
    } }, photo(s, 40, store.photoBase), h('span', {}, s.name, h('div', { class: 'hint' }, classById(s.classId).code)), h('span', { class: 'v' }, LABEL[v]));
  })));
  main.append(h('div', { class: 'row', style: { marginTop: '1rem' } },
    h('a', { class: 'btn', href: `#/reports/attendance/${rot.id}/${grade}/${elective}` }, '🖨 Paper attendance sheet'),
    h('button', { class: 'btn', onclick: async () => {
      const scope = select([{ value: 'elective', label: `Only ${ELECTIVE_INFO[elective].label}, ${gradeName(grade)}` }, { value: 'grade', label: `All electives, ${gradeName(grade)}` }, { value: 'all', label: 'Friday Electives for everyone' }], 'elective');
      const reason = h('input', { placeholder: 'e.g. Snow day, assembly, specialist absent', maxlength: 80 });
      const ok = await dialog({ title: `Cancel ${niceDate(date)}?`, body: [field('What is cancelled', scope), field('Reason', reason)], buttons: [{ label: 'Keep it', value: false }, { label: 'Cancel this session', danger: true, value: true }] });
      if (!ok) return;
      db.cancelled.push({ date, grade: scope.value === 'all' ? null : grade, elective: scope.value === 'elective' ? elective : null, reason: reason.value.trim() || 'Cancelled', at: now().toISOString() });
      log('cancel session', { date, scope: scope.value });
      changed();
      announce('Session cancelled. Teachers see a notice; it doesn’t count against students.');
      rerender();
    } }, 'Cancel this session'),
    !locked && session.role === 'owner' ? h('button', { class: 'btn', onclick: () => { const b = lockCompletion(rot, grade, 'Owner'); announce(`Completion locked. ${b.length} rule warning(s).`); rerender(); } }, 'Lock completion now') : null));

  // Completion preview
  main.append(h('details', { class: 'card', style: { marginTop: '1rem' } }, h('summary', {}, 'Completion so far (this elective)'),
    h('table', {}, h('tbody', {}, list.map((s) => h('tr', {}, h('td', {}, s.name), h('td', {}, computeCompletion(rot, s.id) === 'completed' ? '✓ Completes' : '✖ Not complete yet')))))));
}
