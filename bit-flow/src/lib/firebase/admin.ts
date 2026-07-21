import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { getFirebaseAdminConfig, getFirebaseAdminSetupStatus } from "./env";

const ADMIN_APP_NAME = "bit-flow-admin";

export class FirebaseConfigurationError extends Error {
  readonly missing: string[];

  constructor() {
    const status = getFirebaseAdminSetupStatus();
    super(`Firebase Admin is not configured. Missing: ${status.missing.join(", ")}`);
    this.name = "FirebaseConfigurationError";
    this.missing = status.missing;
  }
}

export interface FirebaseAdminServices {
  app: App;
  auth: Auth;
  db: Firestore;
}

let services: FirebaseAdminServices | undefined;

/** Lazily initializes Admin only after an authenticated server request arrives. */
export function getFirebaseAdmin(): FirebaseAdminServices {
  if (services) return services;
  const config = getFirebaseAdminConfig();
  if (!config) throw new FirebaseConfigurationError();

  const app =
    getApps().find((candidate) => candidate.name === ADMIN_APP_NAME) ??
    initializeApp(
      {
        credential: cert({
          projectId: config.projectId,
          clientEmail: config.clientEmail,
          privateKey: config.privateKey,
        }),
      },
      ADMIN_APP_NAME,
    );

  services = { app, auth: getAuth(app), db: getFirestore(app) };
  return services;
}
