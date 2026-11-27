# UI quick fixes: before and after

`before/` is commit 1193891 (the base of `claude/ui-quick-fixes`); `after/` is this branch. The same harness took both
(`scripts/ui-quick-fixes-browser.cjs`), with synthetic data only. Names: `<item>-<screen>-<phone|wide>-<light|dark>-<en|ar>.png`. Phone is
390x844 and wide desktop is 1920x1080. Teacher screens use the New look.

- `1-student-home-*`: Home lesson cards ("Locked" before, "Open lesson" after).
- `2-student-course-*`: the student course page (rating, placeholder line, Feedbacks and the developer text before; Your Groups, Continue and one centred column after). It also shows the item 1 cards.
- `3-teacher-home-*`, `3-teacher-groups-*`, `3-teacher-group-*`: the content hugging the left (before) and centred (after) on wide screens.
- `4-add-refused-*`: Add a student refused. Before: the message is below the list, out of sight. After: it is on the row, with the reason. `4-add-refused-full-*` and `4-add-refused-no_access-*` show the other two reasons (after only).
- `5-course-*`: the course page without settings (before) and with them (after). After only: `5-course-empty-name`, `5-course-changed` (PT409), `5-course-archive-confirm` (English, and Arabic dark), `5-course-archived-admin` (Restore) and `5-course-editor` (text only).

Student pages are rendered on the server without browser scripts, so the sections that load in the browser (attendance, schedule) show "Loading".
