import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/firebase/http";
import { getLeaderboard } from "@/lib/firebase/store";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "today" ? "today" : "all";
    const rawLimit = Number(url.searchParams.get("limit") ?? 20);
    const limit = Number.isSafeInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;
    const entries = await getLeaderboard(scope, limit);
    return NextResponse.json({
      scope,
      entries: entries.map((entry, index) => ({
        rank: index + 1,
        displayName: entry.displayName,
        photoURL: entry.photoURL,
        score: entry.score,
        processedPackets: entry.processedPackets,
        achievedAt: entry.achievedAt,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
