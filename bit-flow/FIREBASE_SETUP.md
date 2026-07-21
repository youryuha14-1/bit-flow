# Firebase setup

The app deliberately remains buildable without credentials: it shows a setup state and server APIs return `503 FIREBASE_NOT_CONFIGURED` until configuration is supplied.

1. Create a Firebase project and register a **Web app**.
2. Enable **Google** under Authentication ? Sign-in method, and add local/deployed domains under Authorized domains.
3. Copy `.env.example` to `.env.local` and add the six public Web app values from Project settings.
4. Create a service account for the Next.js server. Add its project ID, client email, and private key as the `FIREBASE_*` variables. Keep the key server-only; when stored on one line, replace line breaks with `\\n`.
5. Create Firestore in production mode, then deploy `firestore.rules` with `firebase deploy --only firestore:rules` (or paste it into the Firebase console).

## Data and API access

The browser signs in with Google, gets a Firebase ID token, and calls protected endpoints with `Authorization: Bearer <token>`. The server verifies the token and replays submitted game events before it writes any round, quiz, or leaderboard value. Firestore client writes are denied by `firestore.rules`; Firebase Admin is the only writer.

- `POST /api/rounds/start` issues a server seed/configuration.
- `POST /api/rounds/submit` accepts `{ roundId, events }` and returns a verified result.
- `POST /api/quiz` accepts `{ roundId, answers }` after a completed submission.
- `GET /api/leaderboard?scope=today|all` is public.
- `GET` / `DELETE /api/account/data` returns or removes the authenticated player's Bit Flow records only. Deleting data never deletes the Google account.

The `firebase.json` emulator ports are provided for local rules testing; install the Firebase CLI separately if emulator support is needed.
