// Shared constants. Pure data — safe to use in the browser, Node tests and the Edge Function.
export const ELECTIVES = ['MUSIC', 'ART', 'PE', 'MEDIA'];

export const ELECTIVE_INFO = {
  MUSIC: { label: 'Music', icon: '🎵', color: '#6d4bc4' },
  ART: { label: 'Art', icon: '🎨', color: '#c4502b' },
  PE: { label: 'PE', icon: '⚽', color: '#1f7a4d' },
  MEDIA: { label: 'Media', icon: '📚', color: '#1d5fa8' },
};

export const GRADES = ['K', '1', '2', '3', '4', '5'];
export const GRADE_LABEL = { K: 'Kindergarten', 1: '1st grade', 2: '2nd grade', 3: '3rd grade', 4: '4th grade', 5: '5th grade' };

// §7.4 base cost by rank received (1st..4th)
export const RANK_COST = [0, 10, 25, 60];
export const MAX_CHOICES = 2; // teachers enter only a 1st and a 2nd choice
export const MAX_MISSES_COUNTED = 4;
export const LOOKAHEAD_PENALTY = 15;   // added (before ×1000) when a link would leave the student forced into a crowded elective next time
export const RECENT_REPEAT_PENALTY = 8; // new cycle: discourage the elective just finished
export const MIX_PENALTY = 100000;     // cost per seat above a track's target in one elective — keeps later rotations solvable (see simulation)
