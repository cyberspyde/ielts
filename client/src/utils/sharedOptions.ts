export type SharedMcqBlock = {
  anchorId: string;
  questions: any[];
  start: number;
  end: number;
};

export const questionNumberOf = (question: any): number => {
  if (!question) return 0;
  const raw = question.questionNumber ?? question.order ?? question.metadata?.questionNumber;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
};

export const computeSharedMcqBlocks = (section: any): SharedMcqBlock[] => {
  const blocks: SharedMcqBlock[] = [];
  if (!section) return blocks;
  const sorted = [...(section.questions || [])]
    .sort((a, b) => questionNumberOf(a) - questionNumberOf(b));

  let current: SharedMcqBlock | null = null;
  for (const question of sorted) {
    if (question.questionType !== 'multiple_choice' || question.metadata?.customOptionsGroup) {
      current = null;
      continue;
    }
    const qNum = questionNumberOf(question);
    const isAnchorBreak = Boolean(
      question.metadata?.sharedOptionsAnchor || question.metadata?.shared_options_anchor
    );
    if (!current || isAnchorBreak) {
      current = { anchorId: question.id, questions: [question], start: qNum, end: qNum };
      blocks.push(current);
      continue;
    }
    if (qNum === current.end + 1) {
      current.end = qNum;
      current.questions.push(question);
    } else {
      current = { anchorId: question.id, questions: [question], start: qNum, end: qNum };
      blocks.push(current);
    }
  }
  return blocks;
};

export const makeBlockKey = (sectionId: string, block: SharedMcqBlock): string => `${sectionId}:${block.anchorId}`;

export const findBlockForQuestion = (section: any, questionId: string): SharedMcqBlock | undefined =>
  computeSharedMcqBlocks(section).find((block) => block.questions.some((q: any) => q.id === questionId));
