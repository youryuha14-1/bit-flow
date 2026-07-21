export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface FirebaseAdminConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface FirebaseSetupStatus {
  configured: boolean;
  missing: string[];
}

function value(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

/** Public Firebase values, safe to use in a client component. */
export function getFirebaseClientConfig(): FirebaseClientConfig | null {
  const config = {
    apiKey: value(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: value(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: value(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    storageBucket: value(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: value(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
    appId: value(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  };
  return Object.values(config).some((entry) => !entry) ? null : (config as FirebaseClientConfig);
}

/** Private Admin credentials. Never return this object to a caller. */
export function getFirebaseAdminConfig(): FirebaseAdminConfig | null {
  const config = {
    projectId: value(process.env.FIREBASE_PROJECT_ID) ?? value(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    clientEmail: value(process.env.FIREBASE_CLIENT_EMAIL),
    privateKey: value(process.env.FIREBASE_PRIVATE_KEY)?.replace(/\\n/g, "\n"),
  };
  return Object.values(config).some((entry) => !entry) ? null : (config as FirebaseAdminConfig);
}

export function getFirebaseClientSetupStatus(): FirebaseSetupStatus {
  if (getFirebaseClientConfig()) return { configured: true, missing: [] };
  return {
    configured: false,
    missing: [
      "NEXT_PUBLIC_FIREBASE_API_KEY",
      "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
      "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
      "NEXT_PUBLIC_FIREBASE_APP_ID",
    ],
  };
}

export function getFirebaseAdminSetupStatus(): FirebaseSetupStatus {
  if (getFirebaseAdminConfig()) return { configured: true, missing: [] };
  return {
    configured: false,
    missing: [
      "FIREBASE_PROJECT_ID (or NEXT_PUBLIC_FIREBASE_PROJECT_ID)",
      "FIREBASE_CLIENT_EMAIL",
      "FIREBASE_PRIVATE_KEY",
    ],
  };
}
