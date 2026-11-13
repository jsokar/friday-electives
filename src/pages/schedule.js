// §9.6 Schedule & Tracks: Fridays, tracks in school, rotations with deadlines, expected sizes, cancel/change.
import { h, card, dialog, field, announce, select } from '../ui.js';
import { db, changed, log, todayISO, now } from '../data.js';
import { timetable, cohort, stage } from '../domain.js';
import { fridays, tracksInSchool, niceDate, isNoSchool } from '../engine/calendar.js';
import { ELECTIVES, GRADES } from '../engine/constants.js';
import { deadlinesList, gradeName, periodText, fridaysText } from './common.js';

export function renderSchedule(main, { session, rerender }) {
  const canEdit = session.role !== 'teacher';
  main.append(h('h1', {}, 'Schedule & Tracks'));

  main.append(card('Friday periods (same every Friday)',
    h('table', {}, h('tbody', {}, ['5', '4', '3', '1', 'K', '2'].map((g) => h('tr', {}, h('th', { scope: 'row' }, gradeName(g)), h('td', {}, periodText(g))))))));

  const today = todayISO();
  const rows = fridays(db.settings.firstFriday, db.settings.lastFriday).map((d) => {
    const tracks = tracksInSchool(db.settings, d);
    const rot = db.rotations.find((r) => r.fridays.includes(d));
    const cancels = db.cancelled.filter((c) => c.date === d);
    return h('tr', { class: d < today ? 'muted' : '' },
      h('th', { scope: 'row' }, niceDate(d)),
      h('td', {}, isNoSchool(db.settings, d) ? 'No school' : tracks.length ? `Tracks ${tracks.join(' + ')}` : 'No tracks in'),
      h('td', {}, rot ? rot.id : tracks.length === 1 ? 'Not used (only one track in)' : '—'),
      h('td', {}, cancels.map((c) => h('div', {}, `Cancelled${c.grade ? ' ' + gradeName(c.grade) : ''}${c.elective ? ' ' + c.elective : ''}: ${c.reason}`))));
  });
  main.append(card('Fridays and tracks', h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Friday', 'In school', 'Rotation', 'Notes'].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {}, rows)))));

  for (const r of [...db.rotations].sort((a, b) => a.number - b.number)) {
    const expected = GRADES.map((g) => {
      const n = cohort(r, g).length;
      return h('li', {}, `${gradeName(g)}: ${n} students → about ${Math.floor(n / 4)}–${Math.ceil(n / 4)} per elective`);
    });
    main.append(card(`${r.id} · ${fridaysText(r)} · Tracks ${r.tracks.join(' + ')}`,
      h('div', { class: 'grid2' }, h('div', {}, h('h3', {}, 'Deadlines'), deadlinesList(r)), h('div', {}, h('h3', {}, 'Expected group sizes'), h('ul', {}, expected))),
      canEdit ? h('button', { class: 'btn small', onclick: async () => {
        const date = select(r.fridays.map((d) => ({ value: d, label: niceDate(d) })), r.fridays[0]);
        const reason = h('input', { maxlength: 80, placeholder: 'Reason' });
        const ok = await dialog({ title: `Cancel a Friday in ${r.id}`, body: [field('Friday', date), field('Reason', reason, 'Cancels Friday Electives for everyone that day. For one grade or elective, use the Attendance page.')], buttons: [{ label: 'Keep', value: false }, { label: 'Cancel this Friday', danger: true, value: true }] });
        if (!ok) return;
        db.cancelled.push({ date: date.value, grade: null, elective: null, reason: reason.value.trim() || 'Cancelled', at: now().toISOString() });
        log('cancel friday', { date: date.value });
        changed();
        announce(`${niceDate(date.value)} cancelled.`);
        rerender();
      } }, 'Cancel a Friday…') : null));
  }
}
