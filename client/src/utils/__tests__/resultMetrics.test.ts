import { describe, it, expect } from 'vitest';
import { tallyFillBlank, shouldCombineFillBlank, toMetadataObject } from '../resultMetrics';

describe('resultMetrics helpers', () => {
  describe('toMetadataObject', () => {
    it('parses valid JSON strings into objects', () => {
      const meta = toMetadataObject('{"combineBlanks":true,"extra":1}');
      expect(meta.combineBlanks).toBe(true);
      expect(meta.extra).toBe(1);
    });

    it('returns empty object for invalid JSON', () => {
      const meta = toMetadataObject('{not valid json');
      expect(meta).toEqual({});
    });
  });

  describe('shouldCombineFillBlank', () => {
    it('detects combine flag on objects', () => {
      expect(shouldCombineFillBlank({ combineBlanks: true })).toBe(true);
      expect(shouldCombineFillBlank({ singleNumber: true })).toBe(true);
      expect(shouldCombineFillBlank({ conversation: true })).toBe(true);
    });

    it('detects combine flag within JSON strings', () => {
      expect(shouldCombineFillBlank('{"combineBlanks":true}')).toBe(true);
      expect(shouldCombineFillBlank('{"singleNumber":true}')).toBe(true);
    });

    it('returns false when no flag present', () => {
      expect(shouldCombineFillBlank({})).toBe(false);
    });
  });

  describe('tallyFillBlank', () => {
    it('treats multiple blanks as one when combine flag present', () => {
      const result = tallyFillBlank({
        studentAnswer: ['30 minutes', 'weekly'],
        correctAnswer: '30 minutes;weekly',
        questionMetadata: { combineBlanks: true },
        isCorrect: true,
      });
      expect(result).toEqual({ total: 1, correct: 1 });
    });

    it('counts each blank separately when combine flag absent', () => {
      const result = tallyFillBlank({
        studentAnswer: ['blue', 'green'],
        correctAnswer: 'blue;yellow',
        questionMetadata: {},
        isCorrect: false,
      });
      expect(result).toEqual({ total: 2, correct: 1 });
    });

    it('supports JSON array correct answers', () => {
      const result = tallyFillBlank({
        studentAnswer: ['north', 'south'],
        correctAnswer: JSON.stringify([['north', 'n'], ['south']]),
        questionMetadata: {},
        isCorrect: true,
      });
      expect(result).toEqual({ total: 2, correct: 2 });
    });

    it('falls back to isCorrect when no accepted answers provided', () => {
      const result = tallyFillBlank({
        studentAnswer: ['alpha', 'beta'],
        correctAnswer: '',
        questionMetadata: {},
        isCorrect: true,
      });
      expect(result).toEqual({ total: 2, correct: 2 });
    });
  });
});
