# Campus Academic Portal — IS451 prototype

A student records demo with a React interface, Express API, SQLite-compatible storage, genuine WebAuthn passkeys, server-side role checks, and an AES-256-GCM integrity demonstration. Local development uses a SQLite file; Vercel production uses Turso. All people and grades are fictional. This is classroom software, not a production records system.

## Run locally

Requirements: Node.js 20 or newer and npm. Node v24.11.1 was present when this project was prepared.

```powershell
npm install
Copy-Item .env.example .env
npm run seed
npm run dev
```

Open **http://localhost:3000**. `npm run seed` provisions S1 (student), S2 (student), and L1 (lecturer), then prints a one-time enrollment code for each account without a passkey. Give each code only to its intended demo user. Codes expire after 48 hours and are stored as hashes. Do not capture them in screenshots. Run `npm run seed` again if a code expires before use; ask the project owner to issue a fresh code through a safe local procedure.

On localhost, modern browsers allow WebAuthn without HTTPS. The relying-party ID is `localhost`; the development origin is `http://localhost:3000`. Register a passkey using your browser/device, then sign in using the same account ID. Never use real university accounts or another person's passkeys.

## Commands and accounts

- `npm run dev` starts the API at port 3000 and watches/rebuilds the React client with Vite.
- `npm start` starts the local API and serves the React build from `dist`.
- `npm run build` creates the React production bundle.
- `npm test` runs the automated security and cryptography unit checks.
- Fictional users: S1 Ama Mensah; S2 Kojo Owusu; L1 Dr. Abena Boateng. L1 teaches IS451; S1 and S2 are enrolled.

## Security checks

Automated tests cover the ownership/role policy helpers, grade input validation, API denial paths, and AES-GCM encryption/decryption/tampering. `docs/test-record.md` distinguishes those results from browser tests that still need a person and authenticator. For manual T1, register and sign in as S1. T2: open S1's dashboard. T3: while signed in as S1, use DevTools or an HTTP client to request `/api/records/students/S2` (expect 404). T4: send a grade `PUT` as S1 (expect 403). T5: sign in as L1, update a grade, refresh, and confirm it persists. T6: request `/api/records/me` before login and after logout (expect 401). T7: try an unregistered credential/account (expect rejection). T8: open Protected academic note, encrypt the note, decrypt it, then test integrity protection. Additional cases are in `docs/evidence-checklist.md`.

## Architecture and limits

See `docs/technical-notes.md` for the architecture, permission matrix, WebAuthn flow, encryption model, limitations, and deployment notes. Production uses Turso for persistent records, passkeys, challenges, and sessions. Vercel requires production secrets and passkey origin settings before the app can start.

## Vercel deployment

The repository is connected to Vercel as `Furairah3/campus-academic-portal`. Production uses Turso; local development keeps using `DATABASE_PATH`. Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SESSION_SECRET`, `AES_DEMO_KEY`, `RP_ID`, `RP_NAME`, and `ORIGIN` in the Vercel project's Production environment. Do not commit real values or send them in chat. The app refuses to start in production when required secrets or passkey origin settings are missing.

Vercel's Express integration serves static files from `public`; the Vercel build therefore writes the Vite bundle there. Local development continues to serve `dist`. Use the HTTPS hostname assigned to the Vercel project for `RP_ID` (hostname only) and `ORIGIN` (full `https://` origin). Create the Turso database through the Vercel Marketplace integration, which supplies the Turso URL and authentication token to the project.
