import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createRoundConfig } from "@/lib/game";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/firebase/http";
import { issueRound } from "@/lib/firebase/store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await requireAuthenticatedUser(request);
    const seed = randomUUID();
    const config = createRoundConfig(seed);
    const issued = await issueRound(randomUUID(), user, config);
    return NextResponse.json({ ...issued, startedAt: issued.issuedAt, seed, config });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
