import { NextResponse } from "next/server";

import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/firebase/http";
import { deleteAccountData, getAccountData } from "@/lib/firebase/store";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const user = await requireAuthenticatedUser(request);
    const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? 25);
    const limit = Number.isSafeInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 25;
    return NextResponse.json(await getAccountData(user.uid, limit));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Deletes Bit Flow game, quiz, profile and leaderboard data; never the Google account. */
export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const user = await requireAuthenticatedUser(request);
    const deleted = await deleteAccountData(user.uid);
    return NextResponse.json({ deleted });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
