# Teacher Exams screenshots (part 1)

Synthetic harness data (`scripts/exams-ui-browser.cjs`): the real screens, middleware and CSS, a fictional server checked against the
real contract (`shared/contracts/teacher-exams.ts`) and reply mapper (`examReply`). No customer records. Light theme. Every screen is
shot four ways: phone 390 English Classic, phone 390 Arabic New, desktop 1360 English New, desktop 1360 Arabic Classic (right to left).
File names: `<n>-<screen>-<size>-<language>-<look>.png`. Pictures are full page, so a phone's fixed bars (the sticky action bar and the
bottom tabs) appear once, part way down, over the content they float above.

- 01-exams-page: Live now (one Group's window open: started of total, time left), To correct (essays waiting; paper marks entered of total), the course filter, the Open tab with its rows (per-Group windows, handed in, row menu)
- 02-exams-drafts: the Drafts tab
- 03-row-menu: a row's menu on a phone (Correct, Edit, Unpublish, Archive, Duplicate)
- 10 to 14-wizard-*: a complete online draft, step by step: Details, Questions (Choice, Number, Essay), When (each Group's window: its session, another session, its own time, Needs a time; the time limit never past the shortest window), Rules, Review
- 15-window-dialog: changing one Group's window (another coming session of that Group, or a time)
- 16-wizard-new-online, 17-wizard-new-paper: a new exam on Details (online; on paper with Out of and Held on)
- 18-wizard-paper-edit: an existing paper exam (kind and course fixed)
- 19-wizard-issues: Next on an empty Details lists what is missing
- 20-correct-list: correcting, the student lists (To correct, Corrected, Not handed in) and Release N grades
- 21-correct: one student: the automatic lines (Choice and Number), the essay with the photo exactly as sent, the mark stepper in halves, the note
- 22-correct-corrected: a corrected try, ready to release
- 30-marks: the paper mark sheet (Group filter, marks typed in place, Absent, released marks) and Release marks
- 31-marks-typed: a mark typed in Arabic digits (٣٢٫٥), saved as 32.5
