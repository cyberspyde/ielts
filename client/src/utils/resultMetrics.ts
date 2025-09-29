export type AnyRecord = Record<string, any>;

const toLowerTrim = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
};

export const toMetadataObject = (raw: unknown): AnyRecord => {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as AnyRecord;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as AnyRecord;
      }
    } catch {
      return {};
    }
  }
  return {};
};

export const shouldCombineFillBlank = (metadata: unknown): boolean => {
  const meta = toMetadataObject(metadata);
  return Boolean(meta.combineBlanks || meta.singleNumber || meta.conversation);
};

const buildAnswerGroups = (rawCorrect: unknown, blanksCount: number): string[][] => {
  const groups: string[][] = [];
  const appendEmptyGroups = (target: string[][]) => {
    if (target.length < blanksCount) {
      const shortage = blanksCount - target.length;
      for (let i = 0; i < shortage; i += 1) {
        target.push([]);
      }
    }
    return target;
  };

  if (typeof rawCorrect === 'string') {
    const trimmed = rawCorrect.trim();
    if (!trimmed.length) {
      return appendEmptyGroups(groups);
    }
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          parsed.forEach((entry) => {
            if (Array.isArray(entry)) {
              groups.push(entry.map(toLowerTrim).filter(Boolean));
            } else if (entry !== null && entry !== undefined) {
              groups.push([toLowerTrim(entry)]);
            } else {
              groups.push([]);
            }
          });
          return appendEmptyGroups(groups);
        }
      } catch {
        // fall through to other parsing paths
      }
    }
    if (trimmed.includes(';')) {
      trimmed.split(';').forEach((segment) => {
        groups.push(
          segment
            .split('|')
            .map(toLowerTrim)
            .filter(Boolean)
        );
      });
      return appendEmptyGroups(groups);
    }
    const singleGroup = trimmed
      .split('|')
      .map(toLowerTrim)
      .filter(Boolean);
    for (let i = 0; i < blanksCount; i += 1) {
      groups.push(singleGroup);
    }
    return appendEmptyGroups(groups);
  }

  if (Array.isArray(rawCorrect)) {
    rawCorrect.forEach((entry) => {
      if (Array.isArray(entry)) {
        groups.push(entry.map(toLowerTrim).filter(Boolean));
      } else if (entry !== null && entry !== undefined) {
        groups.push([toLowerTrim(entry)]);
      } else {
        groups.push([]);
      }
    });
    return appendEmptyGroups(groups);
  }

  return appendEmptyGroups(groups);
};

export interface FillBlankTallyInput {
  studentAnswer: unknown;
  correctAnswer?: unknown;
  questionMetadata?: unknown;
  isCorrect?: boolean | null;
}

export const tallyFillBlank = (question: FillBlankTallyInput): { total: number; correct: number } => {
  const { studentAnswer, correctAnswer, questionMetadata, isCorrect } = question;
  if (!Array.isArray(studentAnswer)) {
    return { total: 1, correct: isCorrect ? 1 : 0 };
  }

  if (shouldCombineFillBlank(questionMetadata)) {
    return { total: 1, correct: isCorrect ? 1 : 0 };
  }

  const blanksCount = studentAnswer.length;
  const groups = buildAnswerGroups(correctAnswer, blanksCount);
  const hasAnyAccepted = groups.some((group) => group.length > 0);

  if (!hasAnyAccepted) {
    return { total: blanksCount, correct: isCorrect ? blanksCount : 0 };
  }

  let correct = 0;
  studentAnswer.forEach((answer, idx) => {
    const expected = groups[idx] || [];
    if (!expected.length) return;
    const received = toLowerTrim(answer);
    if (expected.includes(received)) {
      correct += 1;
    }
  });

  return { total: blanksCount, correct };
};
