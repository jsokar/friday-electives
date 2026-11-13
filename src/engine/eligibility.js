// §7.1 Which electives a student can still have in this cycle.
// This is the ONLY place cycle logic lives.
import { ELECTIVES } from './constants.js';

/**
 * @param {Array<{order:number, elective:string, status:'completed'|'provisional'|'not_completed'|'pending'}>} history
 *   One entry per past/current rotation the student was assigned in. `order` sorts rotations in time.
 *   'pending' (current rotation, not yet marked) is treated as provisionally done (§4.3).
 * @returns {{cycleNo:number, done:string[], available:string[], lastDone:string|null, newCycleJustStarted:boolean}}
 */
export function cycleState(history = []) {
  const counted = [...history]
    .filter((h) => h.status === 'completed' || h.status === 'provisional' || h.status === 'pending')
    .sort((a, b) => a.order - b.order);
  let cycleNo = 1;
  let done = new Set();
  let lastDone = null;
  for (const h of counted) {
    if (!ELECTIVES.includes(h.elective)) continue;
    done.add(h.elective);
    lastDone = h.elective;
    if (done.size === ELECTIVES.length) {
      cycleNo += 1;
      done = new Set();
    }
  }
  const newCycleJustStarted = done.size === 0 && counted.length > 0;
  return {
    cycleNo,
    done: [...done],
    available: ELECTIVES.filter((e) => !done.has(e)),
    lastDone,
    newCycleJustStarted,
  };
}

/**
 * After a provisional elective is marked 'not_completed', check whether any LATER assignment now repeats
 * an elective inside the same cycle. Returns the later entries that break the rule.
 */
export function findRuleBreaks(history = []) {
  const sorted = [...history].sort((a, b) => a.order - b.order);
  const breaks = [];
  for (let i = 0; i < sorted.length; i++) {
    const before = sorted.slice(0, i);
    const state = cycleState(before);
    const h = sorted[i];
    if (h.status === 'not_completed') continue;
    if (!state.available.includes(h.elective)) breaks.push(h);
  }
  return breaks;
}
