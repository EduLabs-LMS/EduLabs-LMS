# What changed in the teacher panel (plain version)

This is everything that is different for users since your checkpoint. No back-end code was touched. Anything the back end still has to do is in
[codex-backend-request-teacher-academic-programs.md](./codex-backend-request-teacher-academic-programs.md).

## The big picture
- Every page now has the same look: a big title, clear search and filters, our own dropdowns, clean cards, and friendly empty and loading screens.
- The site now moves: pages fade in, lists appear one after another, numbers count up, buttons press down, dropdowns open smoothly. It is light on phones and calmer for people who turn motion off.
- The sidebar shows your real role as a coloured badge: Admin, Teacher, Assistant or Student. The "Admin & Teacher" divider is gone and the EduLabs name uses the proper font.

## For teachers and assistants
- **Dashboard:** just a welcome and your numbers. The waitlist card only appears while someone is waiting. The old action cards, attendance card and assessment list are gone.
- **Self-learning:** this is now where teachers manage their lessons (the old "Teacher courses" page is gone). Search, filter by published or draft, sort.
- **View as student:** a button that shows you the site the way a student sees it. You can look but nothing is saved, and drafts stay hidden.
- **Users:** only people. Approve or reject requests, suspend, invite students with links. It asks before anything risky. Groups moved to their own page.
- **Sessions & Groups:** opening a group now opens its own page, with tabs for Overview, Members, Sessions and Settings. The top shows the group, the next class with a live countdown, and Join buttons. The list shows how long until each group's next session, can be sorted, and filters Online / In person / Both (Online first). Several students can be added at once. Each group can get a Jitsi link (a "Create a Jitsi room" button makes one). Anything risky asks first.
- **Homework Queue and Exams:** search, filters and cleaner cards.
- **Support:** easier to scan, shows who the ticket is waiting on, and keeps half-written replies if you leave.
- **Academic programs:** a button that adds 1st, 2nd and 3rd Secondary in one click.

## For students
- Home and Self-learning are cleaner, with search, progress bars and progress filters. The placeholder photo slideshow on Home is gone.

## What still needs the back end (details in the other file)
- Teachers and assistants editing academic programs and stages.
- A proper Jitsi host link (right now the host has to sign in to Jitsi) and member counts and next session in the group list.
- Email, role and sign-up date columns on the Users page, and a real on/off setting for the waitlist.
- A real "platform Admin" signal so the Admin badge can show for the owners.
- Support extras: attachments, other people's photos, who wrote each reply.

## Please know
- It was checked on a fake-data preview, not on the real Firebase and Supabase setup, so please test real sign-in and real data.
- The lesson player, course editor and a few other screens got the new colours but not a new layout.
- Do not merge the local-only preview branch `local/preview-bypass`; it only exists on one computer.
