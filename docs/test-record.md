# Test record

Environment inspected: Node.js v24.11.1; npm v11.12.1. These are the checks run in this workspace; no browser passkey ceremony has been claimed.

| Check | Result | Notes |
|---|---|---|
| Dependency install and lockfile | Passed | Packages installed and `package-lock.json` created |
| React production build | Passed | `npm run build` completed with Vite 7.3.7 |
| React development startup | Passed | `npm run dev` started Express and Vite build watch |
| Static UI smoke check | Passed | `GET /` and both compiled asset files returned 200; document title is Campus Academic Portal |
| API health | Passed | `GET /api/health` returned `{"status":"ok"}` |
| Unauthenticated record request | Passed | `GET /api/records/me` returned 401 |
| Invalid enrollment code | Passed | `POST /api/enrol/options` with an invalid code returned 400 |
| `node --check src/server.js` | Passed | Syntax check only |
| `npm test` | Passed, 7/7 | API smoke integration plus ownership/lecturer policy, grade validation, AES-GCM encrypt/decrypt/tamper paths, wrong key length |
| API negative-path integration | Passed | Temporary isolated SQLite DB; unauthenticated records/grade/logout denied, invalid enrollment rejected, wrong Origin rejected, role-change path absent |
| T1 browser passkey registration/login | Not run | Requires browser/device interaction with an issued enrollment code |
| T2–T5 authenticated ownership/grade flows | Not run | Requires actual student and lecturer passkeys; automated helper checks passed |
| T6–T7 full logout/unregistered credential flows | Not run | Requires actual authenticated browser session and passkey |
| T8 through the UI/API | Not run | AES operations are tested at helper level; authenticated UI flow still needs a manual run |
| Desktop/mobile browser layout and console | Not run | Responsive breakpoints are in the stylesheet; no browser viewport/console inspection was available |
