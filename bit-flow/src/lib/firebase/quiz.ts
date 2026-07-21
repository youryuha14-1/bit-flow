import type { QuizAnswer } from "./types";

export interface PublicQuizQuestion {
  id: string;
  prompt: string;
  choices: readonly string[];
}

interface QuizQuestion extends PublicQuizQuestion {
  correctIndex: number;
}

const QUIZ_QUESTIONS: readonly QuizQuestion[] = [
  {
    id: "byte",
    prompt: "RAM? ?? ???? ??? ?? ??????",
    choices: ["??? ??? ???? ????", "??? ??? ?? ??? ????", "??? ???? ????", "????? ????"],
    correctIndex: 1,
  },
  {
    id: "volatile",
    prompt: "ASCII ?? A? 10?? ? 65? 8?? ???? ??? ?? ??????",
    choices: ["01000001", "01000010", "00100001", "10000001"],
    correctIndex: 0,
  },
  {
    id: "binary",
    prompt: "?? ??? ??? ?? ??? ?? ??? ??????",
    choices: ["??", "???", "??", "Flush"],
    correctIndex: 0,
  },
] as const;

/** Safe to import from UI code: answer keys are intentionally omitted. */
export const PUBLIC_QUIZ_QUESTIONS: readonly PublicQuizQuestion[] = QUIZ_QUESTIONS.map(
  ({ id, prompt, choices }) => ({ id, prompt, choices }),
);

export function gradeQuizAnswers(answers: readonly { questionId: string; answerIndex: number }[]): QuizAnswer[] | null {
  if (answers.length !== QUIZ_QUESTIONS.length) return null;
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  if (byQuestion.size !== QUIZ_QUESTIONS.length) return null;

  const graded: QuizAnswer[] = [];
  for (const question of QUIZ_QUESTIONS) {
    const answer = byQuestion.get(question.id);
    if (!answer || !Number.isSafeInteger(answer.answerIndex) || answer.answerIndex < 0 || answer.answerIndex >= question.choices.length) {
      return null;
    }
    graded.push({
      questionId: question.id,
      answerIndex: answer.answerIndex,
      isCorrect: answer.answerIndex === question.correctIndex,
    });
  }
  return graded;
}
