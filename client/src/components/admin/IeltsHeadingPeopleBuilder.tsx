import React, { useState } from 'react';

interface ParagraphMatchItem {
  number: number; // e.g., 14
  paragraphLetter: string; // A-F
  prompt: string; // description text (optional for context)
}

interface PersonMatchItem {
  number: number; // 18-22
  personLetter: string; // A-E
  statement: string;
}

export interface IeltsBulkPayload {
  headingGroup: {
    start: number; // 14
    end: number;   // 17
    questionType: 'matching';
    questionTexts: string[]; // per question prompt (optional)
    correctAnswers: string[]; // paragraph letter answers A-F
    points?: number;
  } | null;
  peopleGroup: {
    start: number; // 18
    end: number;   // 22
    questionType: 'matching'; // treat as matching to letters A-E
    questionTexts: string[];
    correctAnswers: string[]; // letters A-E
    points?: number;
  } | null;
}

interface Props {
  onBuild: (payload: IeltsBulkPayload) => void;
}

const defaultHeadingNumbers = [14,15,16,17];
const defaultPeopleNumbers = [18,19,20,21,22];

const letterOptions = ['A','B','C','D','E','F'];
const personLetters = ['A','B','C','D','E'];

const IeltsHeadingPeopleBuilder: React.FC<Props> = ({ onBuild }) => {
  const [headingData, setHeadingData] = useState<ParagraphMatchItem[]>(
    defaultHeadingNumbers.map(n => ({ number: n, paragraphLetter: '', prompt: '' }))
  );
  const [peopleData, setPeopleData] = useState<PersonMatchItem[]>(
    defaultPeopleNumbers.map(n => ({ number: n, personLetter: '', statement: '' }))
  );
  const [points, setPoints] = useState(1);

  const build = () => {
    onBuild({
      headingGroup: {
        start: 14,
        end: 17,
        questionType: 'matching',
        questionTexts: headingData.map(h => h.prompt || ''),
        correctAnswers: headingData.map(h => h.paragraphLetter.trim().toUpperCase()),
        points
      },
      peopleGroup: {
        start: 18,
        end: 22,
        questionType: 'matching',
        questionTexts: peopleData.map(p => p.statement || ''),
        correctAnswers: peopleData.map(p => p.personLetter.trim().toUpperCase()),
        points
      }
    });
  };

  return (
    <div className="border rounded-lg p-4 bg-white space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 mb-2">Paragraph / Heading Matching (Questions 14-17)</h3>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 text-xs font-medium text-gray-600 mb-1">
          <div className="md:col-span-2">Q#</div>
          <div className="md:col-span-2">Paragraph (A-F)</div>
          <div className="md:col-span-8">Prompt / Note (optional)</div>
        </div>
        <div className="space-y-2">
          {headingData.map((row, idx) => (
            <div key={row.number} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              <div className="md:col-span-2 text-sm">{row.number}</div>
              <div className="md:col-span-2">
                <select
                  className="w-full rounded border-gray-300 text-sm"
                  value={row.paragraphLetter}
                  onChange={(e) => {
                    const next = [...headingData];
                    next[idx] = { ...row, paragraphLetter: e.target.value };
                    setHeadingData(next);
                  }}
                >
                  <option value="">--</option>
                  {letterOptions.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="md:col-span-8">
                <input
                  className="w-full rounded border-gray-300 text-sm"
                  placeholder="(optional) short prompt or descriptor"
                  value={row.prompt}
                  onChange={(e) => {
                    const next = [...headingData];
                    next[idx] = { ...row, prompt: e.target.value };
                    setHeadingData(next);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-gray-900 mb-2">People / Statement Matching (Questions 18-22)</h3>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 text-xs font-medium text-gray-600 mb-1">
          <div className="md:col-span-1">Q#</div>
          <div className="md:col-span-2">Person (A-E)</div>
          <div className="md:col-span-9">Statement</div>
        </div>
        <div className="space-y-2">
          {peopleData.map((row, idx) => (
            <div key={row.number} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              <div className="md:col-span-1 text-sm">{row.number}</div>
              <div className="md:col-span-2">
                <select
                  className="w-full rounded border-gray-300 text-sm"
                  value={row.personLetter}
                  onChange={(e) => {
                    const next = [...peopleData];
                    next[idx] = { ...row, personLetter: e.target.value };
                    setPeopleData(next);
                  }}
                >
                  <option value="">--</option>
                  {personLetters.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="md:col-span-9">
                <input
                  className="w-full rounded border-gray-300 text-sm"
                  placeholder="Statement text"
                  value={row.statement}
                  onChange={(e) => {
                    const next = [...peopleData];
                    next[idx] = { ...row, statement: e.target.value };
                    setPeopleData(next);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Points per question</label>
          <input
            type="number"
            className="w-24 rounded border-gray-300 text-sm"
            value={points}
            onChange={(e) => setPoints(Number(e.target.value) || 0)}
          />
        </div>
        <button
          type="button"
          onClick={build}
          className="px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
        >
          Build Payload
        </button>
      </div>

      <p className="text-xs text-gray-500">After building, send these groups to the bulk API (add heading bank separately if needed).</p>
    </div>
  );
};

export default IeltsHeadingPeopleBuilder;
