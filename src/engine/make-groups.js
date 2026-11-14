// §7 Make the four elective groups for ONE grade in ONE rotation.
// Pure function: no database, no clock. Same input + same seed => same result.
import { ELECTIVES, RANK_COST, MAX_MISSES_COUNTED, LOOKAHEAD_PENALTY, RECENT_REPEAT_PENALTY, MIX_PENALTY } from './constants.js';
import { lotteryNumber, seededShuffle } from './rng.js';
import { solveWithSpread } from './solver.js';
import { explainInfeasible } from './feasibility.js';

/**
 * @typedef {Object} StudentInput
 * @property {string} id
 * @property {string[]} available     electives still allowed this cycle (from cycleState)
 * @property {string[]} [ranking]     teacher's order of preference (subset of available); empty/missing = no choices
 * @property {boolean} [anyFine]      "Absent / any is fine"
 * @property {number} [misses]        times this student missed first choice this school year
 * @property {string} [pinned]        manual move that must be kept
 * @property {string|null} [lastDone] elective finished most recently (for the new-cycle penalty)
 * @property {boolean} [newCycleJustStarted]
 * @property {string|number} [group]  mix group (the student's track) for the even-mix rule
 */

/** Full ranking for a student: teacher's order, then remaining options in a seeded random order. */
export function fullRanking(student, seed) {
  const given = (student.ranking || []).filter((e) => student.available.includes(e));
  const rest = student.available.filter((e) => !given.includes(e));
  const restOrder = seededShuffle(rest, `${seed}|order|${student.id}`);
  return [...given, ...restOrder];
}

function costsFor(student, seed, lookahead) {
  if (student.pinned) return { [student.pinned]: 0 };
  const order = fullRanking(student, seed);
  const m = Math.min(student.misses || 0, MAX_MISSES_COUNTED);
  const lottery = lotteryNumber(seed, student.id);
  const costs = {};
  order.forEach((el, idx) => {
    let base = RANK_COST[Math.min(idx, RANK_COST.length - 1)] * (2 + m);
    if (student.newCycleJustStarted && el === student.lastDone) base += RECENT_REPEAT_PENALTY;
    if (lookahead) {
      const after = student.available.filter((e) => e !== el);
      if (after.length === 1 && lookahead.crowded.has(after[0])) base += LOOKAHEAD_PENALTY;
    }
    costs[el] = base * 1000 + (idx === 0 ? 0 : lottery);
  });
  return costs;
}

/** Which electives would be "crowded" next time if everyone got this assignment (§7.4 look-ahead). */
function crowdedNextTime(students, assignment, nextCohortSize) {
  const forced = Object.fromEntries(ELECTIVES.map((e) => [e, 0]));
  for (const s of students) {
    const after = s.available.filter((e) => e !== assignment[s.id]);
    if (after.length === 1) forced[after[0]] += 1;
  }
  const fairShare = Math.ceil((nextCohortSize ?? students.length) / ELECTIVES.length);
  return new Set(ELECTIVES.filter((e) => forced[e] > fairShare));
}

/**
 * Even-mix targets (§7.6). For each track, choose how many of its students go to each elective so that,
 * afterwards, the number of students who still NEED each elective is as even as possible.
 * That keeps every later rotation solvable, whichever tracks are mixed together.
 */
export function mixShares(students) {
  const byGroup = {};
  for (const s of students) (byGroup[s.group] ||= []).push(s);
  const shares = {};
  for (const [group, list] of Object.entries(byGroup)) {
    const need = Object.fromEntries(ELECTIVES.map((e) => [e, list.filter((s) => s.available.includes(e)).length]));
    const totalNeed = ELECTIVES.reduce((a, e) => a + need[e], 0);
    const leftEach = (totalNeed - list.length) / ELECTIVES.length; // what each elective should have left afterwards
    shares[group] = Object.fromEntries(
      ELECTIVES.map((e) => [e, Math.max(0, Math.min(need[e], Math.ceil(need[e] - leftEach)))]),
    );
  }
  return shares;
}

/**
 * @param {StudentInput[]} students
 * @param {{seed:string, spreads?:number[], lookahead?:boolean, nextCohortSize?:number}} options
 */
export function makeGroups(students, options) {
  const { seed, spreads = [2, 3], lookahead = true, nextCohortSize, mixPenalty = MIX_PENALTY } = options;
  // Even mix by track (§7.6): keeps every track's remaining electives balanced, so later rotations stay solvable.
  const mix = mixPenalty > 0 && students.some((s) => s.group !== undefined) ? { penalty: mixPenalty } : null;
  const result = {
    ok: false,
    seed,
    assignment: {},
    sizes: Object.fromEntries(ELECTIVES.map((e) => [e, 0])),
    spread: null,
    spreadUsed: null,
    rankReceived: {},
    needsHelp: [],
    placedByApp: [],
    warnings: [],
    problems: [],
  };
  if (!students.length) {
    result.ok = true;
    result.spread = 0;
    return result;
  }
  // Students whose cycle somehow has nothing left (should not happen) get all four, flagged.
  const prepared = students.map((s) => {
    const available = s.available && s.available.length ? s.available : [...ELECTIVES];
    if (!s.available || !s.available.length) result.warnings.push(`${s.id}: no elective left — all four allowed`);
    return { ...s, available };
  });
  if (mix) mix.shares = mixShares(prepared);

  let best = null;
  for (const spread of spreads) {
    const input = prepared.map((s) => ({ id: s.id, group: s.group, costs: costsFor(s, seed, null) }));
    let solved = solveWithSpread(input, ELECTIVES, spread, mix);
    if (!solved) continue;
    if (lookahead) {
      const crowded = crowdedNextTime(prepared, solved.assignment, nextCohortSize);
      if (crowded.size) {
        const input2 = prepared.map((s) => ({ id: s.id, group: s.group, costs: costsFor(s, seed, { crowded }) }));
        const second = solveWithSpread(input2, ELECTIVES, spread, mix);
        if (second) solved = second;
        result.warnings.push(`Look-ahead: ${[...crowded].join(', ')} may be crowded next rotation; adjusted where possible.`);
      }
    } else {
      result.warnings.push('Look-ahead skipped (next rotation not in the calendar yet).');
    }
    best = { ...solved, spread };
    break;
  }

  if (!best) {
    const maxSpread = spreads[spreads.length - 1];
    result.problems = explainInfeasible(prepared.map((s) => ({ id: s.id, allowed: s.pinned ? [s.pinned] : s.available })), maxSpread);
    if (!result.problems.length) result.problems.push('No balanced split was found with the current rules.');
    return result;
  }

  result.ok = true;
  result.assignment = best.assignment;
  result.sizes = best.sizes;
  const counts = Object.values(best.sizes);
  result.spread = Math.max(...counts) - Math.min(...counts);
  result.spreadUsed = best.spread;
  for (const s of prepared) {
    const el = best.assignment[s.id];
    const order = fullRanking(s, seed);
    const rank = order.indexOf(el) + 1;
    result.rankReceived[s.id] = rank;
    const hadChoices = (s.ranking && s.ranking.length) || s.anyFine;
    if (!hadChoices && !s.pinned) result.placedByApp.push(s.id);
    // §7.7: help when the student got neither of their two choices (and had 3+ options, so another pick could help)
    if (hadChoices && !s.anyFine && !s.pinned && s.available.length >= 3 && rank > (s.ranking || []).length) {
      result.needsHelp.push(s.id);
    }
  }
  return result;
}

/** Did this student miss their first choice (for the fairness counter)? Single-option students never count. */
export function missedFirstChoice(student, rankReceived) {
  if (!student.available || student.available.length <= 1) return false;
  return rankReceived > 1;
}
