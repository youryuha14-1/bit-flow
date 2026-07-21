"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
  type User,
  type UserCredential,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

import { getFirebaseClientConfig } from "./env";

export interface FirebaseClient {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let client: FirebaseClient | null | undefined;

/** Returns null instead of throwing while Firebase is intentionally unconfigured. */
export function getFirebaseClient(): FirebaseClient | null {
  if (client !== undefined) return client;
  const config = getFirebaseClientConfig();
  if (!config) {
    client = null;
    return client;
  }

  const app = getApps().length ? getApp() : initializeApp(config);
  client = { app, auth: getAuth(app), db: getFirestore(app) };
  return client;
}

export function isFirebaseClientConfigured(): boolean {
  return getFirebaseClient() !== null;
}

export async function signInWithGoogle(): Promise<UserCredential> {
  const firebase = getFirebaseClient();
  if (!firebase) {
    throw new Error("Firebase is not configured. Add the public Firebase environment variables first.");
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(firebase.auth, provider);
}

export async function signOut(): Promise<void> {
  const firebase = getFirebaseClient();
  if (firebase) await firebaseSignOut(firebase.auth);
}

export async function getCurrentUserIdToken(forceRefresh = false): Promise<string | null> {
  const user = getFirebaseClient()?.auth.currentUser;
  return user ? user.getIdToken(forceRefresh) : null;
}

export function observeAuthState(onChange: (user: User | null) => void): () => void {
  const firebase = getFirebaseClient();
  if (!firebase) {
    onChange(null);
    return () => undefined;
  }
  return onAuthStateChanged(firebase.auth, onChange);
}
