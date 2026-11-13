// §7.5 Explain WHY no balanced split exists, in plain words, by checking every set of electives.
import { ELECTIVES, ELECTIVE_INFO } from './constants.js';

function subsets(list) {
  const out = [];
  for (let mask = 1; mask < 1 << list.length; mask++) out.push(list.filter((_, i) => mask & (1 << i)));
  return out;
}

const names = (set) => set.map((e) => ELECTIVE_INFO[e].label).join(' + ');

/**
 * @param {Array<{id:string, allowed:string[]}>} students
 * @param {number} spread
 * @returns {string[]} plain-language problems (empty if none found)
 */
export function explainInfeasible(students, spread, electives = ELECTIVES) {
  const N = students.length;
  const k = electives.length;
  const hi = Math.floor(N / k) + spread; // most a single elective can hold within this spread
  const lo = Math.max(0, Math.ceil(N / k) - spread);
  const problems = [];
  for (const set of subsets(electives)) {
    if (set.length === k) continue;
    const onlyThese = students.filter((s) => s.allowed.length && s.allowed.every((e) => set.includes(e))).length;
    if (onlyThese > hi * set.length) {
      problems.push(
        `${onlyThese} of ${N} students can only take ${names(set)}. With a spread of ${spread} each elective holds at most ${hi}, so ${names(set)} can hold at most ${hi * set.length}.`,
      );
    }
    const canTake = students.filter((s) => s.allowed.some((e) => set.includes(e))).length;
    if (canTake < lo * set.length) {
      problems.push(
        `Only ${canTake} students can still take ${names(set)}, but ${names(set)} needs at least ${lo * set.length} to stay balanced.`,
      );
    }
  }
  const stuck = students.filter((s) => !s.allowed.length).length;
  if (stuck) problems.push(`${stuck} students have no elective left that they are allowed to take.`);
  return problems;
}
