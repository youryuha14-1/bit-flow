"use client";

import firebase from "firebase/compat/app";
import "firebase/compat/auth";

import { getApp, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";

import { getFirebaseClientConfig } from "./env";

export interface FirebaseClient {
  app: firebase.app.App;
  auth: firebase.auth.Auth;
  db: Database;
}

export type { FirebaseApp };
export type CompatUser = firebase.User;
export type CompatUserCredential = firebase.auth.UserCredential;
export type CompatMultiFactorInfo = firebase.auth.MultiFactorInfo;
export type CompatPhoneMultiFactorInfo = firebase.auth.PhoneMultiFactorInfo;
export type CompatMultiFactorResolver = firebase.auth.MultiFactorResolver;
export type CompatAuthError = firebase.auth.Error;

let client: FirebaseClient | null | undefined;

/** Returns null instead of throwing while Firebase is intentionally unconfigured. */
export function getFirebaseClient(): FirebaseClient | null {
  if (client !== undefined) return client;
  const config = getFirebaseClientConfig();
  if (!config) {
    client = null;
    return client;
  }

  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
  client = { app, auth: app.auth(), db: getDatabase(getApp()) };
  return client;
}

export function isFirebaseClientConfigured(): boolean {
  return getFirebaseClient() !== null;
}

export async function signInWithGoogle(): Promise<firebase.auth.UserCredential> {
  const firebaseClient = getFirebaseClient();
  if (!firebaseClient) {
    throw new Error("Firebase is not configured. Add the public Firebase environment variables first.");
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return firebaseClient.auth.signInWithPopup(provider);
}

export async function signOut(): Promise<void> {
  const firebaseClient = getFirebaseClient();
  if (firebaseClient) await firebaseClient.auth.signOut();
}

export async function getCurrentUserIdToken(forceRefresh = false): Promise<string | null> {
  const user = getFirebaseClient()?.auth.currentUser;
  return user ? user.getIdToken(forceRefresh) : null;
}

export function observeAuthState(onChange: (user: firebase.User | null) => void): () => void {
  const firebaseClient = getFirebaseClient();
  if (!firebaseClient) {
    onChange(null);
    return () => undefined;
  }
  return firebaseClient.auth.onAuthStateChanged(onChange);
}

function requireSignedIn(): { client: FirebaseClient; user: firebase.User } {
  const client = getFirebaseClient();
  const user = client?.auth.currentUser;
  if (!client || !user) throw new Error("로그인이 필요합니다.");
  return { client, user };
}

function createRecaptchaVerifier(recaptchaContainerId: string, app: firebase.app.App): firebase.auth.RecaptchaVerifier {
  return new firebase.auth.RecaptchaVerifier(recaptchaContainerId, { size: "invisible" }, app);
}

export function getEnrolledPhoneFactors(): firebase.auth.MultiFactorInfo[] {
  return getFirebaseClient()?.auth.currentUser?.multiFactor.enrolledFactors ?? [];
}

export async function startPhoneMfaEnrollment(phoneNumber: string, recaptchaContainerId: string): Promise<{ verificationId: string }> {
  const { client, user } = requireSignedIn();

  async function attempt(): Promise<{ verificationId: string }> {
    const recaptchaVerifier = createRecaptchaVerifier(recaptchaContainerId, client.app);
    try {
      const session = await user.multiFactor.getSession();
      const verificationId = await new firebase.auth.PhoneAuthProvider(client.auth).verifyPhoneNumber({ phoneNumber, session }, recaptchaVerifier);
      return { verificationId };
    } finally {
      recaptchaVerifier.clear();
    }
  }

  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof Object && (error as { code?: string }).code === "auth/requires-recent-login")) throw error;
    await user.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
    return attempt();
  }
}

export async function confirmPhoneMfaEnrollment(verificationId: string, code: string, displayName?: string | null): Promise<void> {
  const { user } = requireSignedIn();
  const credential = firebase.auth.PhoneAuthProvider.credential(verificationId, code);
  const assertion = firebase.auth.PhoneMultiFactorGenerator.assertion(credential);
  await user.multiFactor.enroll(assertion, displayName ?? null);
}

export async function unenrollPhoneMfa(factorUid: string): Promise<void> {
  const { user } = requireSignedIn();
  await user.multiFactor.unenroll(factorUid);
}

export function isMultiFactorError(error: unknown): error is firebase.auth.Error & { resolver: firebase.auth.MultiFactorResolver } {
  return error instanceof Object && (error as { code?: string }).code === "auth/multi-factor-auth-required" && "resolver" in (error as object);
}

export async function startPhoneMfaChallenge(resolver: firebase.auth.MultiFactorResolver, recaptchaContainerId: string): Promise<{ verificationId: string }> {
  const hint = resolver.hints.find((item) => item.factorId === firebase.auth.PhoneMultiFactorGenerator.FACTOR_ID);
  if (!hint) throw new Error("등록된 전화번호 2단계 인증 정보를 찾을 수 없습니다.");
  const client = getFirebaseClient();
  if (!client) throw new Error("Firebase is not configured. Add the public Firebase environment variables first.");
  const recaptchaVerifier = createRecaptchaVerifier(recaptchaContainerId, client.app);
  try {
    const verificationId = await new firebase.auth.PhoneAuthProvider(resolver.auth).verifyPhoneNumber({ multiFactorHint: hint, session: resolver.session }, recaptchaVerifier);
    return { verificationId };
  } finally {
    recaptchaVerifier.clear();
  }
}

export async function confirmPhoneMfaChallenge(resolver: firebase.auth.MultiFactorResolver, verificationId: string, code: string): Promise<firebase.auth.UserCredential> {
  const credential = firebase.auth.PhoneAuthProvider.credential(verificationId, code);
  const assertion = firebase.auth.PhoneMultiFactorGenerator.assertion(credential);
  return resolver.resolveSignIn(assertion);
}
