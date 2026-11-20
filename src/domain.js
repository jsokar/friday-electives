// School rules on top of the database: eligibility, sign-ups, making groups, moves, approvals,
// attendance, completion and the automatic deadline steps (§4, §7, §8).
import { db, log, notify, now, todayISO, nowTime, studentById, changed, who, store } from './data.js';
import { getSession } from './auth.js';
import { fullRanking } from './engine/make-groups.js';
import { rotationTimetable, isPast } from './engine/calendar.js';
import * as R from './engine/rules.js';
import { ELECTIVES, ELECTIVE_INFO, GRADES, MAX_CHOICES } from './engine/constants.js';
import { newSeed } from './engine/rng.js';

export const timetable = (rot) => rotationTimetable(db.settings, rot);
export const past = (point) => isPast(point, todayISO(), nowTime());
/** Context for the shared rules (school-local date/time, who is acting). */
const ctx = () => ({ date: todayISO(), time: nowTime(), nowIso: now().toISOString(), who: who() });

/** The rotation whose sign-up / review is current: the first one not yet finished for this grade. */
export function currentRotation(grade = null) {
  const list = [...db.rotations].sort((a, b) => a.number - b.number);
  return (
    list.find((r) => {
      const t = timetable(r);
      const gs = grade ? [grade] : GRADES;
      return gs.some((g) => !r.grades[g].publishedAt) && !past({ date: r.fridays[r.fridays.length - 1], time: '23:59' });
    }) ||
    list.find((r) => !past({ date: r.fridays[r.fridays.length - 1], time: '23:59' })) ||
    list[list.length - 1]
  );
}

/** Rotation whose Fridays are happening now / most recently (for attendance). */
export function teachingRotation() {
  const today = todayISO();
  const list = [...db.rotations].sort((a, b) => a.number - b.number);
  return list.filter((r) => r.fridays[0] <= today).pop() || list[0];
}

export function stage(rot, grade) {
  const gs = rot.grades[grade];
  const t = timetable(rot);
  if (gs.completionLockedAt) return 'done';
  if (gs.publishedAt) return past({ date: rot.fridays[0], time: '00:00' }) ? 'running' : 'published';
  if (gs.runId) return 'review';
  if (past(t.choicesClose)) return 'closed';
  if (past({ date: t.signupOpens, time: '00:00' })) return 'signup';
  return 'upcoming';
}

export const STAGE_LABEL = {
  upcoming: 'Not open yet',
  signup: 'Sign-up open',
  closed: 'Making groups',
  review: 'Specialists checking',
  published: 'Published',
  running: 'Fridays in progress',
  done: 'Finished',
};

/** Is this student's class in school for the rotation? */
export const inRotation = (s, rot) => R.ruleInRotation(db, s, rot);

/** History for one student before (and including the provisional current) rotation `rot`. */
export const historyFor = (studentId, beforeRot, opts = {}) => R.ruleHistoryFor(db, studentId, beforeRot, opts);
export const eligibility = (studentId, rot) => R.ruleEligibility(db, studentId, rot);
export const missesThisYear = (studentId, beforeRot) => R.ruleMisses(db, studentId, beforeRot);

// ---------- sign-ups ----------
export function registration(rot, studentId) {
  return db.registrations[rot.id]?.[studentId] || null;
}

export function regStatus(rot, studentId) {
  const r = registration(rot, studentId);
  const elig = eligibility(studentId, rot);
  if (elig.available.length === 1) return 'done'; // only one option: filled in automatically
  if (!r) return 'not_started';
  if (r.anyFine) return 'done';
  if (r.ranking.length >= Math.min(MAX_CHOICES, elig.available.length)) return 'done';
  return r.ranking.length ? 'in_progress' : 'not_started';
}

export function signupOpen(rot) {
  return !past(timetable(rot).choicesClose);
}

export function saveRanking(rot, studentId, ranking, { anyFine = false } = {}) {
  if (!signupOpen(rot)) throw new Error('Choices are closed for this rotation.');
  const elig = eligibility(studentId, rot);
  const clean = ranking.filter((e) => elig.available.includes(e)).slice(0, MAX_CHOICES);
  // With only two electives left, the second fills in by itself.
  if (elig.available.length === 2 && clean.length === 1) clean.push(elig.available.find((e) => !clean.includes(e)));
  (db.registrations[rot.id] ||= {})[studentId] = { ranking: clean, anyFine, at: now().toISOString(), by: who() };
  log('choices', { rotation: rot.id, student: studentId, ranking: clean.join('>'), anyFine });
  changed();
}


// ---------- making groups ----------
export const cohort = (rot, grade) => R.ruleCohort(db, rot, grade);
export const buildInputs = (rot, grade) => R.ruleBuildInputs(db, rot, grade);

/** Run the engine for one grade and (by default) accept the result as the current groups. */
export function makeGroupsFor(rot, grade, { by = 'System', accept = true, spreads } = {}) {
  const run = R.ruleRunGroups(db, ctx(), rot, grade, { by, accept, spreads });
  changed();
  return run;
}

export const acceptRun = (rot, grade, run, inputs = buildInputs(rot, grade)) => R.ruleAcceptRun(db, ctx(), rot, grade, run, inputs);

export function groupsOf(rot, grade) {
  const a = db.assignments[rot.id] || {};
  const out = Object.fromEntries(ELECTIVES.map((e) => [e, []]));
  for (const s of cohort(rot, grade)) {
    const x = a[s.id];
    if (x && out[x.elective]) out[x.elective].push(s);
  }
  return out;
}

export function lateStudents(rot, grade) {
  const a = db.assignments[rot.id] || {};
  if (!rot.grades[grade].runId) return [];
  return cohort(rot, grade).filter((s) => !a[s.id]);
}

export function sizes(rot, grade) {
  const g = groupsOf(rot, grade);
  return Object.fromEntries(ELECTIVES.map((e) => [e, g[e].length]));
}

export function spreadOf(sz) {
  const v = Object.values(sz);
  return v.length ? Math.max(...v) - Math.min(...v) : 0;
}

/** Specialist move (§9.4). Returns {ok, repeat} — a repeat needs explicit confirmation. */
export function moveStudent(rot, studentId, to, reason, note = '', { allowRepeat = false } = {}) {
  const s = studentById(studentId);
  const a = (db.assignments[rot.id] ||= {});
  const elig = eligibility(studentId, rot);
  if (!elig.available.includes(to) && !allowRepeat) return { ok: false, repeat: true };
  const from = a[studentId]?.elective || null;
  a[studentId] = {
    ...(a[studentId] || { completion: 'pending', hadChoices: false, availableCount: elig.available.length }),
    elective: to,
    pinned: true,
    source: 'specialist',
    needsHelp: false,
    rank: fullRanking({ id: studentId, available: elig.available, ranking: registration(rot, studentId)?.ranking || [] }, rot.seed).indexOf(to) + 1 || null,
  };
  const entry = { at: now().toISOString(), who: who(), rotation: rot.id, student: studentId, name: s.name, from, to, reason, note, repeat: !elig.available.includes(to) };
  db.exceptions.push(entry);
  log('move', entry);
  const me = getSession()?.elective;
  for (const el of [from, to]) if (el && el !== me) notify(el, `${s.name} (${s.grade === 'K' ? 'K' : s.grade}) moved ${from ? ELECTIVE_INFO[from].label : 'in'} → ${ELECTIVE_INFO[to].label}. Reason: ${reason}${note ? ' — ' + note : ''}`);
  // Approvals for the affected electives must be given again (before publishing).
  const gs = rot.grades[s.grade];
  if (!gs.publishedAt) for (const el of [from, to]) if (el) delete gs.approvals[el];
  changed();
  return { ok: true };
}

export function suggestFor(rot, studentId) {
  const s = studentById(studentId);
  const sz = sizes(rot, s.grade);
  const elig = eligibility(studentId, rot);
  return elig.available.slice().sort((a, b) => sz[a] - sz[b])[0];
}

// ---------- approvals / publishing ----------
export function approve(rot, grade, elective, by) {
  const gs = rot.grades[grade];
  gs.approvals[elective] = { by, at: now().toISOString() };
  log('approve', { rotation: rot.id, grade, elective, by });
  maybePublish(rot, grade);
  changed();
}

export const maybePublish = (rot, grade) => R.ruleMaybePublish(db, ctx(), rot, grade);

// ---------- attendance / completion ----------
export const cancelledFor = (date, grade, elective) => R.ruleCancelledFor(db, date, grade, elective);
export const heldFor = (rot, grade, elective) => R.ruleHeldFor(db, rot, grade, elective);

export function setAttendance(rot, date, studentId, value) {
  const day = ((db.attendance[rot.id] ||= {})[date] ||= {});
  if (value === 'present') delete day[studentId];
  else day[studentId] = value;
  changed();
}

export const attendanceOf = (rot, date, studentId) => R.ruleAttendanceOf(db, rot, date, studentId);
export const computeCompletion = (rot, studentId) => R.ruleComputeCompletion(db, rot, studentId, todayISO());

export function lockCompletion(rot, grade) {
  const breaks = R.ruleLockCompletion(db, ctx(), rot, grade);
  changed();
  return breaks;
}

// ---------- automatic deadline steps ----------
// In cloud mode the SERVER does these on schedule (supabase/functions/scheduler), so browsers never do.
// In local test mode there is no server, so the browser runs the same shared rules.
export function tick() {
  if (store.mode !== 'local') return false;
  const r = R.ruleScheduledSteps(db, ctx());
  if (r.changed) changed();
  return r.changed;
}

export function requestChange(classId, studentId, text) {
  db.requests.push({ id: Math.random().toString(36).slice(2), classId, studentId, text, status: 'open', at: now().toISOString(), from: who() });
  notify('owner', `Request from ${classId}: ${text}`);
  for (const e of ELECTIVES) notify(e, `Request from ${classId}: ${text}`);
  changed();
}

export function reseed(rot) {
  rot.seed = newSeed();
}
