// School rules on top of the database: eligibility, sign-ups, making groups, moves, approvals,
// attendance, completion and the automatic deadline steps (§4, §7, §8).
import { db, log, notify, now, todayISO, nowTime, studentById, activeStudents, studentTrack, changed, who } from './data.js';
import { getSession } from './auth.js';
import { cycleState, findRuleBreaks } from './engine/eligibility.js';
import { makeGroups, fullRanking } from './engine/make-groups.js';
import { rotationTimetable, isPast, heldFridays, completedFromAttendance, isNoSchool } from './engine/calendar.js';
import { ELECTIVES, ELECTIVE_INFO, GRADES, MAX_CHOICES } from './engine/constants.js';
import { newSeed } from './engine/rng.js';

export const timetable = (rot) => rotationTimetable(db.settings, rot);
export const past = (point) => isPast(point, todayISO(), nowTime());

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
export const inRotation = (s, rot) => rot.tracks.includes(studentTrack(s));

/** History for one student before (and including the provisional current) rotation `rot`. */
export function historyFor(studentId, beforeRot, { includeCurrent = false } = {}) {
  const out = [];
  for (const r of db.rotations) {
    if (r.number > beforeRot.number || (!includeCurrent && r.number === beforeRot.number)) continue;
    const a = db.assignments[r.id]?.[studentId];
    if (!a) continue;
    out.push({ order: r.number, elective: a.elective, status: a.completion === 'completed' ? 'completed' : a.completion === 'not_completed' ? 'not_completed' : 'pending', rotation: r.id });
  }
  // Optional known past electives entered by specialists before the app (D5)
  const s = studentById(studentId);
  for (const p of s?.pastElectives || []) out.push({ order: -1, elective: p, status: 'completed' });
  return out;
}

export function eligibility(studentId, rot) {
  return cycleState(historyFor(studentId, rot));
}

export function missesThisYear(studentId, beforeRot) {
  let m = 0;
  for (const r of db.rotations) {
    if (r.number >= beforeRot.number) continue;
    const a = db.assignments[r.id]?.[studentId];
    if (a && a.hadChoices && a.availableCount > 1 && a.rank > 1) m++;
  }
  return m;
}

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
export function cohort(rot, grade) {
  return activeStudents().filter((s) => s.grade === grade && inRotation(s, rot));
}

function nextRotation(rot) {
  return db.rotations.filter((r) => r.number > rot.number).sort((a, b) => a.number - b.number)[0] || null;
}

export function buildInputs(rot, grade) {
  const assigned = db.assignments[rot.id] || {};
  return cohort(rot, grade).map((s) => {
    const elig = eligibility(s.id, rot);
    const reg = registration(rot, s.id);
    let ranking = reg?.ranking || [];
    if (reg?.helpAnswer) ranking = [reg.helpAnswer, ...ranking.filter((e) => e !== reg.helpAnswer)];
    return {
      id: s.id,
      group: studentTrack(s),
      available: elig.available,
      ranking,
      anyFine: !!reg?.anyFine,
      misses: missesThisYear(s.id, rot),
      pinned: assigned[s.id]?.pinned ? assigned[s.id].elective : undefined,
      lastDone: elig.lastDone,
      newCycleJustStarted: elig.newCycleJustStarted,
    };
  });
}

/** Run the engine for one grade and (by default) accept the result as the current groups. */
export function makeGroupsFor(rot, grade, { by = 'System', accept = true, spreads } = {}) {
  const gs = rot.grades[grade];
  if (gs.publishedAt) throw new Error('This grade is already published. Use “Move to…” for changes.');
  const inputs = buildInputs(rot, grade);
  const next = nextRotation(rot);
  const result = makeGroups(inputs, {
    seed: `${rot.seed}|${grade}`,
    lookahead: !!next,
    nextCohortSize: next ? cohort(next, grade).length : undefined,
    ...(spreads ? { spreads } : {}),
  });
  const run = { id: `run_${Math.random().toString(36).slice(2, 9)}`, rotationId: rot.id, grade, at: now().toISOString(), by, result, inputs: inputs.length };
  db.runs.push(run);
  log('make groups', { rotation: rot.id, grade, ok: result.ok, spread: result.spread, by });
  if (accept && result.ok) acceptRun(rot, grade, run, inputs);
  changed();
  return run;
}

export function acceptRun(rot, grade, run, inputs = buildInputs(rot, grade)) {
  const a = (db.assignments[rot.id] ||= {});
  for (const id of Object.keys(a)) if (studentById(id)?.grade === grade && !inputs.some((i) => i.id === id)) delete a[id];
  for (const inp of inputs) {
    const prev = a[inp.id];
    a[inp.id] = {
      elective: run.result.assignment[inp.id],
      rank: run.result.rankReceived[inp.id],
      source: inp.pinned ? prev?.source || 'specialist' : 'auto',
      pinned: !!inp.pinned,
      placedByApp: run.result.placedByApp.includes(inp.id),
      needsHelp: run.result.needsHelp.includes(inp.id) && !registration(rot, inp.id)?.helpAnswer,
      hadChoices: !!(inp.ranking.length || inp.anyFine),
      availableCount: inp.available.length,
      completion: prev?.completion || 'pending',
    };
  }
  const gs = rot.grades[grade];
  gs.runId = run.id;
  gs.groupsAt = gs.groupsAt || now().toISOString();
  gs.approvals = {}; // new groups need fresh approvals
}

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

export function maybePublish(rot, grade) {
  const gs = rot.grades[grade];
  if (!gs.publishedAt && ELECTIVES.every((e) => gs.approvals[e])) {
    gs.publishedAt = now().toISOString();
    log('publish', { rotation: rot.id, grade });
    notify('owner', `${rot.id} ${grade === 'K' ? 'Kindergarten' : 'Grade ' + grade} published.`);
  }
}

// ---------- attendance / completion ----------
export function cancelledFor(date, grade, elective) {
  return db.cancelled.some((c) => c.date === date && (!c.grade || c.grade === grade) && (!c.elective || c.elective === elective));
}

export function heldFor(rot, grade, elective) {
  return rot.fridays.filter((d) => !cancelledFor(d, grade, elective) && !isNoSchool(db.settings, d));
}

export function setAttendance(rot, date, studentId, value) {
  const day = ((db.attendance[rot.id] ||= {})[date] ||= {});
  if (value === 'present') delete day[studentId];
  else day[studentId] = value;
  changed();
}

export function attendanceOf(rot, date, studentId) {
  return db.attendance[rot.id]?.[date]?.[studentId] || 'present';
}

export function computeCompletion(rot, studentId) {
  const a = db.assignments[rot.id]?.[studentId];
  if (!a) return null;
  if (a.completionOverride) return a.completionOverride;
  const s = studentById(studentId);
  const held = heldFor(rot, s.grade, a.elective).filter((d) => d <= todayISO());
  let attended = 0;
  let excused = 0;
  for (const d of held) {
    const v = attendanceOf(rot, d, studentId);
    if (v === 'present') attended++;
    else if (v === 'excused') excused++;
  }
  return completedFromAttendance(held.length, attended, excused) ? 'completed' : 'not_completed';
}

export function lockCompletion(rot, grade, by = 'System') {
  const gs = rot.grades[grade];
  const breaks = [];
  for (const s of cohort(rot, grade)) {
    const a = db.assignments[rot.id]?.[s.id];
    if (!a) continue;
    a.completion = computeCompletion(rot, s.id);
    if (a.completion === 'not_completed') {
      const later = findRuleBreaks(historyFor(s.id, { number: 999 }, { includeCurrent: true }));
      for (const b of later) breaks.push({ student: s.name, rotation: b.rotation, elective: b.elective });
    }
  }
  gs.completionLockedAt = now().toISOString();
  log('completion locked', { rotation: rot.id, grade, by });
  for (const b of breaks) notify(ELECTIVES.includes(b.elective) ? b.elective : 'owner', `Check ${b.student}: ${ELECTIVE_INFO[b.elective]?.label} in ${b.rotation} would now repeat (earlier rotation not completed).`);
  changed();
  return breaks;
}

// ---------- automatic deadline steps (run on every load / minute) ----------
export function tick() {
  let did = false;
  for (const rot of db.rotations) {
    const t = timetable(rot);
    for (const grade of GRADES) {
      const gs = rot.grades[grade];
      if (!cohort(rot, grade).length) continue;
      if (!gs.runId && past(t.groupsMade)) {
        makeGroupsFor(rot, grade, { by: 'System (Tuesday)' });
        did = true;
      }
      if (gs.runId && !gs.helpRerunAt && !gs.publishedAt && past(t.helpDue)) {
        const anyAnswers = Object.values(db.registrations[rot.id] || {}).some((r) => r.helpAnswer);
        if (anyAnswers) makeGroupsFor(rot, grade, { by: 'System (help answers)' });
        for (const a of Object.values(db.assignments[rot.id] || {})) a.needsHelp = false;
        gs.helpRerunAt = now().toISOString();
        did = true;
      }
      if (gs.runId && !gs.publishedAt && past(t.publishBy)) {
        for (const e of ELECTIVES) if (!gs.approvals[e]) gs.approvals[e] = { by: 'Owner (deadline)', at: now().toISOString() };
        maybePublish(rot, grade);
        did = true;
      }
      if (gs.publishedAt && !gs.completionLockedAt && past(t.completionLock)) {
        lockCompletion(rot, grade);
        did = true;
      }
    }
  }
  if (did) changed();
  return did;
}

export function answerHelp(rot, studentId, elective) {
  const r = ((db.registrations[rot.id] ||= {})[studentId] ||= { ranking: [], anyFine: false });
  r.helpAnswer = elective;
  const a = db.assignments[rot.id]?.[studentId];
  if (a) a.needsHelp = false;
  log('help answer', { rotation: rot.id, student: studentId, elective });
  changed();
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
