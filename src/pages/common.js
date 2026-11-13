import { h } from '../ui.js';
import { db, classById, todayISO } from '../data.js';
import { timetable, stage, past } from '../domain.js';
import { niceDate, niceTime } from '../engine/calendar.js';
import { GRADE_LABEL } from '../engine/constants.js';

export const when = (p) => `${niceDate(p.date)}, ${niceTime(p.time)}`;
export const fridaysText = (rot) => rot.fridays.map((d) => niceDate(d, false)).join(' & ');
export const rotTitle = (rot) => `Electives on ${fridaysText(rot)}`;
export const gradeName = (g) => GRADE_LABEL[g];
export const periodText = (g) => {
  const p = db.settings.periods[g];
  return p ? `${niceTime(p.start)}–${niceTime(p.end)}` : '';
};

/** Rotations that include this class, oldest first, not yet finished. */
export function rotationsForClass(classId) {
  const c = classById(classId);
  return [...db.rotations]
    .sort((a, b) => a.number - b.number)
    .filter((r) => r.tracks.includes(c.track) && stage(r, c.grade) !== 'done');
}

/** The rotation a homeroom teacher should be working on now. */
export function teacherRotation(classId) {
  const list = rotationsForClass(classId);
  const c = classById(classId);
  const active = list.find((r) => ['signup', 'closed', 'review'].includes(stage(r, c.grade)));
  if (active) return active;
  const published = list.find((r) => ['published', 'running'].includes(stage(r, c.grade)));
  return published || list[0] || null;
}

export function rotationPicker(selected, onPick, list = db.rotations) {
  return h('select', { 'aria-label': 'Rotation', onchange: (e) => onPick(e.target.value) },
    [...list].sort((a, b) => a.number - b.number).map((r) =>
      h('option', { value: r.id, selected: r.id === selected?.id }, `${r.id} · ${fridaysText(r)} · Tracks ${r.tracks.join('+')}`)));
}

export function deadlinesList(rot) {
  const t = timetable(rot);
  const item = (label, p) => h('li', { class: past(p) ? 'muted' : '' }, h('strong', {}, `${label}: `), when(p), past(p) ? ' (done)' : '');
  return h('ul', {},
    item('Sign-up opens', { date: t.signupOpens, time: '07:00' }),
    item('Choices close', t.choicesClose),
    item('Groups made', t.groupsMade),
    item('Help answers due', t.helpDue),
    item('Published by', t.publishBy),
    item('Completion locked', t.completionLock));
}

export function isFridayToday() {
  return db.rotations.some((r) => r.fridays.includes(todayISO()));
}
