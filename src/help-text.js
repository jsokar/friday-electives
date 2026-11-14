// All help wording in one place (§10). Change the words here; no other code needs to change.
export const HELP = {
  home: {
    title: 'Home',
    steps: [
      'The big button at the top always shows the next thing you need to do.',
      'Deadlines show the day, date and time.',
      'Use Help (?) on any page for steps for that page.',
    ],
  },
  myclass: {
    title: 'My Class — entering choices',
    steps: [
      'Step 1: Print picture ballots and let each child mark a 1 (favorite) and a 2 (next favorite).',
      'Step 2: For each child, tap their 1st choice, then their 2nd choice. Tap a choice again to undo it.',
      'Everything saves on every tap — there is no Submit button.',
      'Child absent or doesn’t mind? Tap “Absent / any is fine”. The app will choose fairly for them.',
      'Step 3: After the groups are published, see “Where does everyone go on Friday?” and print the line-up sheet.',
    ],
    kids: [
      'You might not get your first choice. If you don’t, you’ll get a better chance next time.',
      'You will try all four electives before you do one again.',
    ],
  },
  ballots: {
    title: 'Picture ballots',
    steps: [
      'Each slip shows only the electives that child can still choose.',
      'Children write 1 under their favorite and 2 under their next favorite.',
      'Print in black and white. Cut along the dashed lines.',
    ],
  },
  board: {
    title: 'Specials Board',
    steps: [
      'Choose a grade and a rotation. You see all four electives side by side (one at a time on small screens).',
      'To move a student: tap the student, choose “Move to…”, pick the elective and a reason.',
      'The numbers at the top update right away. “Spread” is the difference between the biggest and smallest group.',
      'When your elective looks right, press “Approve my elective”. A grade is published when all four electives are approved.',
      'Everything must be published by the Friday one week before the rotation. Anything not approved by then is approved automatically for the owner.',
    ],
  },
  attendance: {
    title: 'Attendance',
    steps: [
      'Everyone is present unless you tap them.',
      'Tap once for Absent, twice for Excused, three times to go back to Present.',
      'You can fix attendance until the Monday after the rotation’s last Friday.',
      'A student completes the elective if they came to all Fridays held, or all but one (minimum one). Excused absences don’t count against them.',
    ],
  },
  schedule: {
    title: 'Schedule & Tracks',
    steps: [
      'The calendar shows which tracks are in school on each Friday.',
      'Rotations are worked out from the calendar. Each one shows its deadlines.',
      'Specialists and the owner can cancel a Friday (for everyone, one grade or one elective).',
    ],
  },
  owner: {
    title: 'Owner',
    steps: [
      'Only the Owner code opens this page.',
      'Change passcodes here. Changing a code signs out everyone using it — don’t change codes on a Friday or during sign-up.',
      'Students: add, edit, move class, switch photos off, deactivate.',
      'Test clock (local test mode only): pretend today is a different date to try every step.',
    ],
  },
};

export const GLOSSARY = [
  ['Rotation', 'A block of 2–3 Fridays. Each student stays in the same elective for the whole rotation.'],
  ['Cycle', 'Doing all four electives. A student never repeats an elective until they have done all four.'],
  ['Track-out', 'A track that is not in school. Its students are not in the groups for those Fridays.'],
  ['Spread', 'The difference between the biggest and the smallest group in a grade. 2 or less is the goal.'],
  ['Needs your help', 'The app could only give this child their last choice. Pick another option if it is better.'],
  ['Placed by app', 'No choices were entered by the deadline, so the app chose fairly.'],
  ['Pinned', 'A specialist moved this student by hand. Making groups again keeps it.'],
];

export const LEGEND = [
  ['✓ Done', 'Choices entered (or “any is fine”).'],
  ['… In progress', 'Some choices entered.'],
  ['○ Not started', 'No choices yet.'],
  ['! Needs your help', 'Please pick another option.'],
  ['📌 Pinned', 'Moved by a specialist.'],
  ['🤖 Placed by app', 'No choices were entered in time.'],
];
