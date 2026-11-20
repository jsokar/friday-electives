// School rules that work on a plain database object — no browser, no clock, no storage.
// Used by the app (domain.js) AND by the server scheduler (supabase/functions/scheduler), so both
// apply exactly the same rules. `ctx` = { date: 'YYYY-MM-DD', time: 'HH:MM', nowIso, who } in school time.
import { ELECTIVES, ELECTIVE_INFO, GRADES } from './constants.js';
import { cycleState, findRuleBreaks } from './eligibility.js';
import { makeGroups } from './make-groups.js';
import { rotationTimetable, isPast, completedFromAttendance, isNoSchool } from './calendar.js';

// ---------- small helpers ----------
export const ruleIsPast = (ctx, point) => isPast(point, ctx.date, ctx.time);
export const ruleTimetable = (db, rot) => rotationTimetable(db.settings, rot);

export function ruleLog(db, ctx, action, details = {}) {
  (db.audit ||= []).push({ at: ctx.nowIso, who: ctx.who, action, ...details });
  if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
}

export function ruleNotify(db, ctx, to, text) {
  (db.inbox ||= []).push({ id: Math.random().toString(36).slice(2), to, text, at: ctx.nowIso, read: false });
}

const classOf = (db, s) => db.classes.find((c) => c.id === s.classId);
export const ruleStudentTrack = (db, s) => s.track ?? classOf(db, s)?.track;
export const ruleInRotation = (db, s, rot) => rot.tracks.includes(ruleStudentTrack(db, s));
export const ruleCohort = (db, rot, grade) => db.students.filter((s) => s.active && s.grade === grade && ruleInRotation(db, s, rot));
export const ruleNextRotation = (db, rot) => db.rotations.filter((r) => r.number > rot.number).sort((a, b) => a.number - b.number)[0] || null;

// ---------- history and eligibility (§7.1) ----------
export function ruleHistoryFor(db, studentId, beforeRot, { includeCurrent = false } = {}) {
  const out = [];
  for (const r of db.rotations) {
    if (r.number > beforeRot.number || (!includeCurrent && r.number === beforeRot.number)) continue;
    const a = db.assignments[r.id]?.[studentId];
    if (!a) continue;
    out.push({ order: r.number, elective: a.elective, status: a.completion === 'completed' ? 'completed' : a.completion === 'not_completed' ? 'not_completed' : 'pending', rotation: r.id });
  }
  const s = db.students.find((x) => x.id === studentId);
  for (const p of s?.pastElectives || []) out.push({ order: -1, elective: p, status: 'completed' });
  return out;
}

export const ruleEligibility = (db, studentId, rot) => cycleState(ruleHistoryFor(db, studentId, rot));

/** Times this student missed their 1st choice earlier this school year (fairness priority). */
export function ruleMisses(db, studentId, beforeRot) {
  let m = 0;
  for (const r of db.rotations) {
    if (r.number >= beforeRot.number) continue;
    const a = db.assignments[r.id]?.[studentId];
    if (a && a.hadChoices && a.availableCount > 1 && a.rank > 1) m++;
  }
  return m;
}

// ---------- making groups (§7) ----------
export function ruleBuildInputs(db, rot, grade) {
  const assigned = db.assignments[rot.id] || {};
  return ruleCohort(db, rot, grade).map((s) => {
    const elig = ruleEligibility(db, s.id, rot);
    const reg = db.registrations?.[rot.id]?.[s.id] || null;
    return {
      id: s.id,
      group: ruleStudentTrack(db, s),
      available: elig.available,
      ranking: reg?.ranking || [],
      anyFine: !!reg?.anyFine,
      misses: ruleMisses(db, s.id, rot),
      pinned: assigned[s.id]?.pinned ? assigned[s.id].elective : undefined,
      lastDone: elig.lastDone,
      newCycleJustStarted: elig.newCycleJustStarted,
    };
  });
}

export function ruleAcceptRun(db, ctx, rot, grade, run, inputs) {
  const a = (db.assignments[rot.id] ||= {});
  const ids = new Set(inputs.map((i) => i.id));
  for (const id of Object.keys(a)) {
    const s = db.students.find((x) => x.id === id);
    if (s?.grade === grade && !ids.has(id)) delete a[id];
  }
  for (const inp of inputs) {
    const prev = a[inp.id];
    a[inp.id] = {
      elective: run.result.assignment[inp.id],
      rank: run.result.rankReceived[inp.id],
      source: inp.pinned ? prev?.source || 'specialist' : 'auto',
      pinned: !!inp.pinned,
      placedByApp: run.result.placedByApp.includes(inp.id),
      needsHelp: false, // the app decides; teachers are not asked again
      hadChoices: !!(inp.ranking.length || inp.anyFine),
      availableCount: inp.available.length,
      completion: prev?.completion || 'pending',
    };
  }
  const gs = rot.grades[grade];
  gs.runId = run.id;
  gs.groupsAt = gs.groupsAt || ctx.nowIso;
  gs.approvals = {}; // new groups need fresh approvals
}

/** Run the engine for one grade and (by default) accept the result. Returns the run. */
export function ruleRunGroups(db, ctx, rot, grade, { by = 'System', accept = true, spreads } = {}) {
  const gs = rot.grades[grade];
  if (gs.publishedAt) throw new Error('This grade is already published. Use “Move to…” for changes.');
  const inputs = ruleBuildInputs(db, rot, grade);
  const next = ruleNextRotation(db, rot);
  const result = makeGroups(inputs, {
    seed: `${rot.seed}|${grade}`,
    lookahead: !!next,
    nextCohortSize: next ? ruleCohort(db, next, grade).length : undefined,
    ...(spreads ? { spreads } : {}),
  });
  const run = { id: `run_${Math.random().toString(36).slice(2, 9)}`, rotationId: rot.id, grade, at: ctx.nowIso, by, result, inputs: inputs.length };
  (db.runs ||= []).push(run);
  if (db.runs.length > 300) db.runs.splice(0, db.runs.length - 300);
  ruleLog(db, ctx, 'make groups', { rotation: rot.id, grade, ok: result.ok, spread: result.spread, by });
  if (accept && result.ok) ruleAcceptRun(db, ctx, rot, grade, run, inputs);
  if (!result.ok) ruleNotify(db, ctx, 'owner', `${rot.id} ${grade === 'K' ? 'Kindergarten' : 'Grade ' + grade}: no balanced split was possible — open the Specials Board.`);
  return run;
}

// ---------- publishing ----------
export function ruleMaybePublish(db, ctx, rot, grade) {
  const gs = rot.grades[grade];
  if (!gs.publishedAt && ELECTIVES.every((e) => gs.approvals[e])) {
    gs.publishedAt = ctx.nowIso;
    ruleLog(db, ctx, 'publish', { rotation: rot.id, grade });
    ruleNotify(db, ctx, 'owner', `${rot.id} ${grade === 'K' ? 'Kindergarten' : 'Grade ' + grade} published.`);
  }
}

// ---------- attendance / completion ----------
export const ruleCancelledFor = (db, date, grade, elective) =>
  (db.cancelled || []).some((c) => c.date === date && (!c.grade || c.grade === grade) && (!c.elective || c.elective === elective));

export const ruleHeldFor = (db, rot, grade, elective) =>
  rot.fridays.filter((d) => !ruleCancelledFor(db, d, grade, elective) && !isNoSchool(db.settings, d));

export const ruleAttendanceOf = (db, rot, date, studentId) => db.attendance?.[rot.id]?.[date]?.[studentId] || 'present';

export function ruleComputeCompletion(db, rot, studentId, todayIso) {
  const a = db.assignments[rot.id]?.[studentId];
  if (!a) return null;
  if (a.completionOverride) return a.completionOverride;
  const s = db.students.find((x) => x.id === studentId);
  const held = ruleHeldFor(db, rot, s.grade, a.elective).filter((d) => d <= todayIso);
  let attended = 0;
  let excused = 0;
  for (const d of held) {
    const v = ruleAttendanceOf(db, rot, d, studentId);
    if (v === 'present') attended++;
    else if (v === 'excused') excused++;
  }
  return completedFromAttendance(held.length, attended, excused) ? 'completed' : 'not_completed';
}

export function ruleLockCompletion(db, ctx, rot, grade) {
  const gs = rot.grades[grade];
  const breaks = [];
  for (const s of ruleCohort(db, rot, grade)) {
    const a = db.assignments[rot.id]?.[s.id];
    if (!a) continue;
    a.completion = ruleComputeCompletion(db, rot, s.id, ctx.date);
    if (a.completion === 'not_completed') {
      for (const b of findRuleBreaks(ruleHistoryFor(db, s.id, { number: 999 }, { includeCurrent: true }))) breaks.push({ student: s.name, rotation: b.rotation, elective: b.elective });
    }
  }
  gs.completionLockedAt = ctx.nowIso;
  ruleLog(db, ctx, 'completion locked', { rotation: rot.id, grade });
  for (const b of breaks) ruleNotify(db, ctx, ELECTIVES.includes(b.elective) ? b.elective : 'owner', `Check ${b.student}: ${ELECTIVE_INFO[b.elective]?.label} in ${b.rotation} would now repeat (earlier rotation not completed).`);
  return breaks;
}

// ---------- automatic deadline steps (§4) ----------
/**
 * Everything that must happen by itself at the deadlines. Safe to run as often as you like:
 * each step happens once.
 *  1. Choices close  → the app makes the final groups (again, if a specialist made a preview earlier;
 *                      students a specialist moved by hand stay where they were put).
 *  2. Publish Friday → anything not yet approved is approved for the owner, and the grade is published.
 *  3. Completion lock (Monday after the last Friday) → completion is recorded.
 * Returns { changed, steps: [text] }.
 */
export function ruleScheduledSteps(db, ctx) {
  const steps = [];
  for (const rot of db.rotations) {
    const t = ruleTimetable(db, rot);
    for (const grade of GRADES) {
      const gs = rot.grades[grade];
      if (!ruleCohort(db, rot, grade).length) continue;
      if (!gs.finalAt && !gs.publishedAt && ruleIsPast(ctx, t.choicesClose)) {
        const run = ruleRunGroups(db, ctx, rot, grade, { by: 'App decision (deadline)' });
        gs.finalAt = ctx.nowIso;
        steps.push(`${rot.id} ${grade}: groups made at the deadline (${run.result.ok ? `spread ${run.result.spread}` : 'needs specialists'})`);
      }
      if (gs.runId && !gs.publishedAt && ruleIsPast(ctx, t.publishBy)) {
        for (const e of ELECTIVES) if (!gs.approvals[e]) gs.approvals[e] = { by: 'Owner (deadline)', at: ctx.nowIso };
        ruleMaybePublish(db, ctx, rot, grade);
        steps.push(`${rot.id} ${grade}: published at the deadline`);
      }
      if (gs.publishedAt && !gs.completionLockedAt && ruleIsPast(ctx, t.completionLock)) {
        ruleLockCompletion(db, ctx, rot, grade);
        steps.push(`${rot.id} ${grade}: completion recorded`);
      }
    }
  }
  return { changed: steps.length > 0, steps };
}
