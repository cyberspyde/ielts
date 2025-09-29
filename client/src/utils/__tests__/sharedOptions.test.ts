/// <reference types="vitest" />

import { describe, expect, it } from 'vitest';
import { computeSharedMcqBlocks, makeBlockKey, questionNumberOf, type SharedMcqBlock } from '../sharedOptions';

describe('sharedOptions helpers', () => {
  const buildQuestion = (overrides: Partial<any>): any => ({
    id: overrides.id ?? `q-${Math.random()}`,
    questionType: overrides.questionType ?? 'multiple_choice',
    questionNumber: overrides.questionNumber,
    order: overrides.order,
    metadata: overrides.metadata ?? {},
    options: overrides.options ?? [],
  });

  it('groups contiguous multiple-choice questions into a single block', () => {
    const section = {
      questions: [
        buildQuestion({ id: 'q1', questionNumber: 13 }),
        buildQuestion({ id: 'q2', questionNumber: 14 }),
        buildQuestion({ id: 'q3', questionNumber: 15 }),
      ],
    };

    const blocks = computeSharedMcqBlocks(section);
    expect(blocks).toHaveLength(1);
    const [block] = blocks;
    expect(block.start).toBe(13);
    expect(block.end).toBe(15);
    expect(block.questions.map((q: any) => q.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('starts a new block when numbering skips or a non-MCQ appears', () => {
    const section = {
      questions: [
        buildQuestion({ id: 'q1', questionNumber: 13 }),
        buildQuestion({ id: 'q2', questionNumber: 14 }),
        buildQuestion({ id: 'q3', questionType: 'fill_blank', questionNumber: 15 }),
        buildQuestion({ id: 'q4', questionNumber: 24 }),
        buildQuestion({ id: 'q5', questionNumber: 25 }),
      ],
    };

    const blocks = computeSharedMcqBlocks(section);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].questions.map((q: any) => q.id)).toEqual(['q1', 'q2']);
    expect(blocks[1].questions.map((q: any) => q.id)).toEqual(['q4', 'q5']);
  });

  it('ignores questions using custom options when grouping', () => {
    const section = {
      questions: [
        buildQuestion({ id: 'q1', questionNumber: 1 }),
        buildQuestion({ id: 'q2', questionNumber: 2, metadata: { customOptionsGroup: true } }),
        buildQuestion({ id: 'q3', questionNumber: 3 }),
      ],
    };

    const blocks = computeSharedMcqBlocks(section);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].questions.map((q: any) => q.id)).toEqual(['q1']);
    expect(blocks[1].questions.map((q: any) => q.id)).toEqual(['q3']);
  });

  it('derives stable block keys from section id and anchor', () => {
    const sectionId = 'section-123';
    const block: SharedMcqBlock = {
      anchorId: 'anchor-1',
      start: 1,
      end: 3,
      questions: [buildQuestion({ id: 'anchor-1', questionNumber: 1 })],
    };

    expect(makeBlockKey(sectionId, block)).toBe(`${sectionId}:anchor-1`);
  });

  it('falls back to zero for undefined question numbers', () => {
    expect(questionNumberOf(undefined)).toBe(0);
    expect(questionNumberOf({ questionNumber: 'not-a-number' })).toBe(0);
  });
});
