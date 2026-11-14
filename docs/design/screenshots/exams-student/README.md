# Student Exams and Home "Live now" screenshots

Synthetic data only (no customer records). The student pictures come from `scripts/exams-student-browser.cjs`
(`LMS_COPY_SHOTS=1`): the real student screens, the real middleware, the real stylesheet and fonts, and a fictional server that checks every
request against the real contract and words every refusal with the real reply mapper. The Home card pictures come from the
`Home "Live now"` step of `scripts/teacher-home-browser.cjs`. Not provider acceptance.

Ways: phone 390 first (English Classic, Arabic New), then desktop 1360 (English New, Arabic Classic). Light theme.

- `01-list-*` the student's Exams: open now, coming up (their own window), handed in, results, closed
- `02-overview-*` one exam before starting: window, time limit, the rule for a second try, Start
- `03` to `05` taking: a choice (one answer), a number (Arabic digits), an essay with text and one photo (phone, English); `08` to `10` the same in Arabic (RTL)
- `06-hand-in-confirm` the confirm, naming the question left unanswered; `07-handed-in` after hand-in (no score until released)
- `11-taking-choice-desktop-*` the taking screen on a desktop
- `12`, `13` a lost connection: the answer stays on screen, plain words, saved again when the connection is back
- `14`, `15` time is up: the server handed the try in
- `16` to `18` the second try offer, and a second try with the right answer kept
- `19-results-*` the score once released; `20-review-*` the answer review (right answers, model answer, the marker's note); `21-paper-*` a paper exam's mark
- `home-live-now-*` the teacher Home "Live now" card: one row per open Group with started / total and time left, one tap to the Exams page
