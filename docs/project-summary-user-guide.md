# Campus Academic Portal: Project Summary and User Guide

## Project purpose

The Campus Academic Portal is a classroom demonstration of passwordless authentication, role-based access control, and student-record workflows. It uses fictional people, courses, and grades. It is not intended for real institutional records.

## Project history and decisions

The project began as the IS451 secure student-records assignment: a React portal for passkey authentication, encrypted sample data, and role-based access to grades. The interface was then refined into a campus academic portal, and its React app remained the user interface (there is no separate HTML application). The work added remembered account IDs, sample records, a course catalog with student enrollment, and invitation-gated lecturer onboarding. Lecturer access is restricted because it can expose class rosters and change grades. The production app was connected to GitHub and deployed through Vercel, using Turso for its database. The course catalog currently has four seeded courses. Lecturer course creation is available in the authenticated course workspace.

The project chose passkeys instead of passwords, server-side authorization instead of trusting browser roles, and invitation-gated lecturer signup instead of allowing any public visitor to create a grade-editing account. The sample population and grades are fictional. Course enrollment does not generate fake grades.

## What the application does

- Students register a passkey, view their own profile, course enrollments, and grades, and enroll in available courses.
- Lecturers register with a single-use invitation, receive an assigned course, view its enrolled student roster, record grades, and create additional courses.
- Students can create, view, edit, and delete their own notes for courses they are enrolled in. The server enforces student ownership and course enrollment.
- The separate Protected Academic Note page demonstrates AES-GCM encryption and tamper detection on a fixed sample note. It does not encrypt course notes or academic grades.

## Technology and architecture

- **Frontend:** React 19 JSX, built with Vite; the source UI is in `src/client`.
- **API:** Express 5, hosted as Vercel serverless functions.
- **Authentication:** WebAuthn passkeys through SimpleWebAuthn. Private passkey keys remain in the user's authenticator; the app stores the public credential key and counter.
- **Database:** libSQL. Development uses a local database file; production uses Turso.
- **Hosting:** Vercel serves the built React assets and routes `/api` requests to Express. The GitHub `main` branch is connected to the Vercel project.

### Local development

Install dependencies with `npm install`, then run `npm run dev`. This starts Express and a Vite build watcher. Open the local URL printed by Vite (default origin: `http://localhost:3000`). Local development uses a SQLite-compatible database file. `npm run seed` creates demo data and prints one-time enrollment codes; handle those codes privately. Run `npm test` for automated checks and `npm run build` for the production bundle.

## Authentication and permissions

Registration uses a random one-time enrollment code that expires after 48 hours. Only its SHA-256 hash is stored. A registration challenge is tied to the browser session, origin, RP ID, and account, then consumed after verification. Login uses a fresh challenge and verifies the authenticator response before creating a session.

The session cookie is HttpOnly, SameSite=Lax, and Secure in production. State-changing API requests require a matching Origin and CSRF token. Students can read only their own records. Lecturers can read and update records only for students enrolled in a course assigned to them. The server checks roles and course assignments on every protected action.

Public student registration cannot grant a lecturer role. A lecturer invitation is single-use, expires after 48 hours, and is stored as a hash. The new lecturer chooses one course during registration. The administrator issues invitations by setting a production `LECTURER_INVITE_CODE` secret or running `npm run create-lecturer-invite` with database credentials available.

## Data model

- `users`: account ID, display name, and role.
- `credentials`: verified public passkey credential and authenticator metadata.
- `enrolment_codes`: one-time passkey-registration codes, stored as hashes.
- `lecturer_invites`: one-use lecturer invitation hashes and claim state.
- `courses`: course code, title, and legacy primary lecturer field.
- `course_lecturers`: lecturer-to-course assignments used for authorization.
- `enrolments`: student-to-course membership.
- `grades`: assessments and integer scores constrained to 0–100.
- `course_notes`: student-owned title/body notes attached to an enrollment and course.
- `sessions` and `challenges`: server-side login/session state and short-lived WebAuthn challenges.

Startup seeds the demo lecturer and these courses: IS451 Information and Systems Security, CS230 Operating Systems, CS480 Capstone Project, and FIN101 Finance for Non-Finance Professionals. It also seeds four fictional roster students (`S3`-`S6`) across all four courses, with sample grades, so lecturer accounts assigned to a seeded course can see a populated roster. These sample roster records do not have passkeys and cannot sign in; they are for lecturer workflow demonstrations. New courses and new course enrollments do not receive invented grades.

## Student guide

### Create a student account and passkey

1. Open the portal and choose **Register passkey**.
2. Enter your display name and select one or more courses.
3. Choose **Create my student account**. The portal displays a new account ID and fills the one-time registration code into the registration form.
4. Choose **Register passkey** and approve the browser/device prompt. Use the same browser profile and device that can access the passkey later.
5. Sign in using the account ID in the sign-in list and the passkey saved to your device.

The sign-in list remembers recently created IDs in that browser's local storage. If you switch browsers or clear its data, enter or recover your account ID through the course administrator. Account IDs are not passwords; the matching registered passkey is still required.

### Enroll in another course

Sign in as a student, open the dashboard, choose a course under **Explore more courses**, then choose **Enroll**. The course appears in your profile. Assessments appear after they are recorded by a lecturer.

### Create a course note

Sign in as a student and open **Course notes** in the left navigation. Choose one of your enrolled courses, enter a title and note, and select **Save note**. Your notes appear on the right. Use **Edit** or **Delete** on a note to manage it later. Notes are private to your student account; the server rejects access from other students and blocks notes for courses you have not joined. Notes are stored in the application database. Do not enter passwords or highly sensitive personal information.

## Lecturer guide

### Create a lecturer account

1. Obtain a current, unused lecturer invitation from the portal administrator.
2. Open **Register passkey**, enter your display name, and use the **Lecturer account** section.
3. Enter the invitation and choose the course you will teach.
4. Choose **Create lecturer account**, then use the generated enrollment code lower on the page to **Register passkey**.
5. Sign in using the new `L-...` account ID and the passkey you registered.

The invitation can be used once and expires 48 hours after it is issued. Do not share it publicly.

If account creation reports **Invalid or expired enrolment details**, confirm that the invitation is current, unused, copied exactly, and that a course is selected. The invitation is distinct from the enrollment code generated after the lecturer account is created. After creating the lecturer account, register its passkey using the generated enrollment code before signing in. An invitation cannot replace the passkey step.

### Create a course

Sign in as a lecturer. In the course workspace, use **Create a course**, enter a code such as `CS310` and a title, then submit. Course codes must contain 2–5 letters followed by 2–4 digits. The course becomes available in the student catalog. Students enroll themselves; course creation does not automatically enroll students.

### Record a grade

In the course workspace, select an enrolled student, enter an assessment name and a whole-number grade from 0 to 100, and save it. The server rejects requests if the lecturer is not assigned to that course or the student is not enrolled there.

## Protected Academic Note demonstration

Lecturers see the Protected Academic Note cryptography demonstration. It encrypts a fixed sample note with AES-256-GCM, returns ciphertext/nonce/authentication tag, decrypts it, and demonstrates that tampering is rejected. Student course notes are a separate database feature and are not encrypted by this demonstration.

## Course creation and lecturer signup status

Course creation is available only to signed-in lecturers. Student course enrollment is separate. Student notes are available only in courses the student has joined. Lecturer signup is invite-only so a public visitor cannot self-assign grade-editing permissions. If the lecturer button is unavailable, check that the name is at least two characters, the invitation is entered, and a course is selected. If the API says the invitation is invalid or already used, request a new one.

## Build, deployment, and verification

The React production build is `npm run build`. Automated checks are run with `npm test`. The production app requires Vercel environment variables for Turso URL/token, session secret, AES demo key, RP ID, origin, and RP name. Secret values must not be committed or pasted into reports.

The course catalog API was checked on production and returned all four seeded courses. The latest lecturer/course changes should be verified with a real browser passkey ceremony and a lecturer/student workflow. Automated test results belong in `docs/test-record.md`; do not claim that a browser passkey ceremony was completed unless it was actually performed.

## Security and prototype limitations

- All people, course records, and grades are fictional classroom data.
- Lecturer invitations are a classroom access gate, not identity proofing.
- There is no account recovery or self-service passkey revocation screen.
- Account IDs are saved only in the current browser for convenience.
- This prototype is not an institutional student information system and should not receive real student data.
