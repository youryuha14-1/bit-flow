# Firebase setup

The app deliberately remains buildable without credentials: it shows a setup state until the public Firebase configuration is supplied.

1. Create a Firebase project and register a **Web app**.
2. Enable **Google** under Authentication → Sign-in method, and add local/deployed domains under Authorized domains.
3. Fill in the seven public Web app values in `.env` from Project settings, including the database URL (found under Realtime Database once created, formatted like `https://<project-id>-default-rtdb.<region>.firebasedatabase.app`).
4. Create a Realtime Database instance (choose a region), then deploy `database.rules.json` with `firebase deploy --only database` (or paste it into the Firebase console).
5. Deploy to **Firebase Hosting**: `.firebaserc` already points at the `bit-flow-886ab` project. Run `next build` to produce a static export in `out/`, then `firebase deploy --only hosting` uploads that folder as-is (`firebase.json`'s `hosting.public` points at `out`). This is plain static file hosting — the **Spark** (free) plan is enough, no Blaze upgrade is needed.
6. To enable the optional phone-number multi-factor authentication (offered after Google sign-in), turn on **multi-factor authentication for SMS** under Authentication → Sign-in method → Advanced (the exact console label may vary as Firebase updates its UI, but it lives in that Advanced/second-factor section). Real SMS delivery to end users requires the project to already be on the **Blaze** (pay-as-you-go) plan. To avoid SMS costs and rate limits while developing locally, configure test phone numbers under Authentication → Sign-in method → Phone numbers for testing — these accept a fixed verification code without sending a real SMS. No separate domain configuration is needed for phone MFA's reCAPTCHA step: it relies on the same Authorized domains list already set up for Google sign-in (localhost + your deployed domain).

## Data and API access

There is no server. The browser signs in with Google and, once authenticated, writes and reads Realtime Database data directly with the Firebase client SDK — profile, round, quiz, and leaderboard records all go straight from the browser to the database, guarded only by `database.rules.json`.

Those rules are a shape/ownership check, not a game-logic referee: a signed-in user can only touch records under their own `uid`, a round has to go through an `issued → submitted` transition instead of being written in one shot, and a leaderboard write is rejected unless it beats that user's previous best score. What the rules **cannot** do is confirm a submitted score was actually earned by playing the game — there is no server left to replay the recorded events and check them. Someone editing requests by hand can still write a fabricated (but rules-shaped) score straight into the database. The leaderboard is therefore honor-system: this was a deliberate trade-off to keep the project on Firebase's free Spark plan instead of paying for Blaze just to run a verification API.

Deleting a player's data ("delete my records" in the app) also runs client-side now: it reads back that user's own round/quiz/leaderboard entries and profile, then clears them with one multi-path update. It never deletes the underlying Google account.

The `firebase.json` emulator ports (Realtime Database on 9000, Auth on 9099) are provided for local rules testing; install the Firebase CLI separately if emulator support is needed. To preview the static export locally, run `next build` and serve the resulting `out/` folder (for example `firebase emulators:start` with a hosting emulator entry added back, or any static file server).
