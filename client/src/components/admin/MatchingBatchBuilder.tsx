import React, { useEffect, useMemo, useState } from 'react';

export type MatchingOption = { letter: string; text: string };

export type MatchingBatch = {
  start: number;
  end: number;
  points?: number;
  questionText?: string;
  options: MatchingOption[];
  correctAnswers: string[]; // length = end-start+1
};

type Props = {
  value: MatchingBatch;
  onChange: (next: MatchingBatch) => void;
  title?: string;
};

const lettersAG = ['A','B','C','D','E','F','G'];
const romans = ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi'];

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const MatchingBatchBuilder: React.FC<Props> = ({ value, onChange, title = 'Paragraph/Heading Matching (Simple Builder)' }) => {
  const { start, end, points = 1, questionText = '', options, correctAnswers } = value;
  const total = useMemo(() => Math.max(0, end - start + 1), [start, end]);

  // Ensure correctAnswers length stays in sync with range
  useEffect(() => {
    if (total <= 0) return;
    if (correctAnswers.length !== total) {
      const next = [...correctAnswers];
      if (next.length < total) {
        while (next.length < total) next.push('');
      } else {
        next.length = total;
      }
      onChange({ ...value, correctAnswers: next });
    }
  }, [total]);

  const setRange = (k: 'start' | 'end', v: number) => {
    const next = { ...value, [k]: v } as MatchingBatch;
    onChange(next);
  };

  const setPoints = (v: number) => onChange({ ...value, points: v });
  const setQuestionText = (v: string) => onChange({ ...value, questionText: v });

  const setOptionLetter = (idx: number, letter: string) => {
    const next = options.map((o, i) => i === idx ? { ...o, letter } : o);
    onChange({ ...value, options: next });
  };
  const setOptionText = (idx: number, text: string) => {
    const next = options.map((o, i) => i === idx ? { ...o, text } : o);
    onChange({ ...value, options: next });
  };
  const addOption = () => onChange({ ...value, options: [...options, { letter: '', text: '' }] });
  const removeOption = (idx: number) => onChange({ ...value, options: options.filter((_, i) => i !== idx) });

  const seedAG = () => onChange({ ...value, options: lettersAG.map(l => ({ letter: l, text: '' })) });
  const seedRomans = () => onChange({ ...value, options: romans.map(l => ({ letter: l, text: '' })) });

  const setAnswerAt = (index: number, letter: string) => {
    const i = clamp(index, 0, total - 1);
    const next = [...correctAnswers];
    next[i] = letter;
    onChange({ ...value, correctAnswers: next });
  };
  const clearAnswers = () => onChange({ ...value, correctAnswers: Array(total).fill('') });
  const autofillSequential = () => {
    const letters = options.map(o => o.letter).filter(Boolean);
    const next = Array(total).fill('');
    for (let i = 0; i < total && i < letters.length; i++) next[i] = letters[i];
    onChange({ ...value, correctAnswers: next });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
        <div>
          <label className="block text-sm text-gray-700 mb-1">Start</label>
          <input type="number" className="w-full rounded-md border-gray-300" value={start} onChange={(e) => setRange('start', Number(e.target.value))} />
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1">End</label>
          <input type="number" className="w-full rounded-md border-gray-300" value={end} onChange={(e) => setRange('end', Number(e.target.value))} />
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1">Points per question</label>
          <input type="number" step={0.5} className="w-full rounded-md border-gray-300" value={points} onChange={(e) => setPoints(Number(e.target.value))} />
        </div>
        <div className="md:col-span-3">
          <label className="block text-sm text-gray-700 mb-1">Default question text (optional)</label>
          <input className="w-full rounded-md border-gray-300" value={questionText} onChange={(e) => setQuestionText(e.target.value)} placeholder="e.g., Match the headings to the paragraphs" />
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-gray-700">Headings</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={seedAG} className="px-3 py-1.5 text-xs border rounded">Seed A–G</button>
            <button type="button" onClick={seedRomans} className="px-3 py-1.5 text-xs border rounded">Seed i–xi</button>
            <button type="button" onClick={addOption} className="px-3 py-1.5 text-xs border rounded">Add</button>
          </div>
        </div>
        <div className="space-y-2">
          {options.map((opt, idx) => (
            <div key={`opt-${idx}`} className="grid grid-cols-12 gap-2 items-center">
              <input
                className="col-span-2 rounded-md border-gray-300 px-2 py-1 text-sm"
                placeholder="Letter"
                value={opt.letter}
                onChange={(e) => setOptionLetter(idx, e.target.value)}
              />
              <input
                className="col-span-9 rounded-md border-gray-300 px-2 py-1 text-sm"
                placeholder={`Heading ${idx + 1}`}
                value={opt.text}
                onChange={(e) => setOptionText(idx, e.target.value)}
              />
              <button type="button" onClick={() => removeOption(idx)} className="col-span-1 px-2 py-1 text-sm text-red-600 border border-red-200 rounded">Delete</button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-gray-700">Assign headings to questions</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={autofillSequential} className="px-3 py-1.5 text-xs border rounded">Auto-fill sequential</button>
            <button type="button" onClick={clearAnswers} className="px-3 py-1.5 text-xs border rounded">Clear all</button>
          </div>
        </div>

        {/* Bank */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {options.map((opt, idx) => (
            <span
              key={`bank-${idx}`}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/letter', opt.letter); }}
              className="px-2.5 py-1 rounded border text-sm border-gray-300 text-gray-700 cursor-grab select-none"
              title={opt.text}
            >
              {opt.letter}
            </span>
          ))}
          <span className="text-xs text-gray-500">Drag a letter onto a question slot below, or click a slot to cycle choices.</span>
        </div>

        {/* Questions mapping grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Array.from({ length: total }).map((_, i) => {
            const qNum = start + i;
            const assigned = correctAnswers[i] || '';
            return (
              <div
                key={`q-${qNum}`}
                className="border rounded p-2 flex items-center justify-between"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const letter = e.dataTransfer.getData('text/letter');
                  if (!letter) return;
                  setAnswerAt(i, letter);
                }}
              >
                <div className="text-sm text-gray-800">Q{qNum}</div>
                <button
                  type="button"
                  onClick={() => {
                    // cycle through available letters
                    const letters = options.map(o => o.letter).filter(Boolean);
                    if (letters.length === 0) return;
                    const currentIdx = letters.indexOf(assigned);
                    const nextLetter = letters[(currentIdx + 1) % letters.length];
                    setAnswerAt(i, nextLetter);
                  }}
                  className={`px-2 py-1 rounded border text-sm ${assigned ? 'border-blue-600 text-blue-700' : 'border-gray-300 text-gray-600'}`}
                >
                  {assigned || 'Assign'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        Make sure you filled letters and texts for headings. Each question will be created with the selected letter as the correct answer and the heading bank saved for the section.
      </div>
    </div>
  );
};

export default MatchingBatchBuilder;

