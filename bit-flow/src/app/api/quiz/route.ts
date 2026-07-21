import { NextResponse } from "next/server";

import {
  ApiError,
  apiErrorResponse,
  isRecord,
  readJsonObject,
  requireAuthenticatedUser,
  requireString,
} from "@/lib/firebase/http";
import { gradeQuizAnswers } from "@/lib/firebase/quiz";
import { saveQuizAttempt, SubmissionConflictError } from "@/lib/firebase/store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await readJsonObject(request);
    const roundId = requireString(body.roundId, "roundId");
    if (!Array.isArray(body.answers) || !body.answers.every(isRecord)) {
      throw new ApiError(400, "INVALID_QUIZ", "answers ??? ?????.");
    }

    const graded = gradeQuizAnswers(
      body.answers.map((answer) => ({
        questionId: typeof answer.questionId === "string" ? answer.questionId : "",
        answerIndex: typeof answer.answerIndex === "number" ? answer.answerIndex : Number.NaN,
      })),
    );
    if (!graded) throw new ApiError(400, "INVALID_QUIZ", "?? ??? ??? ? ????.");

    const attempt = await saveQuizAttempt({
      id: roundId,
      uid: user.uid,
      roundId,
      score: graded.filter((answer) => answer.isCorrect).length,
      answers: graded,
      completedAt: new Date().toISOString(),
    });
    return NextResponse.json({ attempt });
  } catch (error) {
    if (error instanceof SubmissionConflictError) {
      return apiErrorResponse(new ApiError(404, error.code, "?? ?? ??? ?? ? ????."));
    }
    return apiErrorResponse(error);
  }
}
