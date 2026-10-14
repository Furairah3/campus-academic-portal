# T1–T8 evidence checklist

Record date, browser/version, operating system/device, account ID, actual result and any failure for every manual run. Use fictional demo data only. Redact codes, cookies, assertions, credential material and session IDs.

| Test | Evidence to collect | Expected result |
|---|---|---|
| T1 Registration + login | Passkey browser prompt and signed-in account view; no secret values | S1 registration and server-verified login succeed |
| T2 Own grades | S1 dashboard and `/api/records/me` response | S1's own grades only |
| T3 Other student's grades | Direct S1 request for S2 and status/body | 404, no S2 data |
| T4 Student edit | Direct S1 grade PUT and status; database value before/after | 403, unchanged |
| T5 Lecturer edit | L1 update response; refreshed roster; persisted SQLite value | Allowed and retained |
| T6 Unauthenticated/logout | `/api/records/me` before login and after logout | Both 401 |
| T7 Unregistered credential | Browser assertion attempt and response | Rejected, no authenticated session |
| T8 AES-GCM | Demo output for original/recovered note, IV/tag/ciphertext and tamper result | Valid decrypt, tampered decrypt rejected |

Also record S2 attempting S1's grades, role-change request denial, wrong-course edit, invalid grade rejection, invalid/expired/reused enrollment code rejection, old-session denial after logout, and grade persistence after restarting the server. Browser passkey outcomes remain untested until performed on an actual supported browser/device; do not label this checklist as completed evidence.
