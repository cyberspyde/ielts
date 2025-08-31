import React, { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';

type ParsedHeading = { letter?: string; text: string };
type ParsedQuestion = { number: number; type: string; text?: string; correct?: string };

export type BulkImporterResult = {
  headingOptions?: ParsedHeading[];
  groups?: Array<{
    questionType: string;
    start: number;
    end: number;
    points?: number;
    questionText?: string;
    options?: Array<{ letter?: string; text?: string } | string>;
    correctAnswers?: string[];
  }>;
};

type Props = {
  onParsed: (result: BulkImporterResult) => void;
  mode?: 'headings' | 'questions';
};

const BulkImporter: React.FC<Props> = ({ onParsed, mode = 'headings' }) => {
  const [dragOver, setDragOver] = useState(false);
  const [rawText, setRawText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const parseCSV = (text: string) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const rows = lines.map((l) => l.split(',').map((s) => s.trim()));
    return rows;
  };

  const parseHeadings = useCallback((text: string): ParsedHeading[] => {
    // Supports: "A, Heading A" or "A: Heading A" or just "Heading A" lines
    const rows = parseCSV(text);
    if (rows.length === 1 && rows[0].length === 1) {
      // maybe multi-line non-CSV pasted
      const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      return lines.map((t) => ({ text: t }));
    }
    return rows.map((cols) => {
      if (cols.length === 1) return { text: cols[0] };
      const letter = cols[0].replace(/[:\-]$/, '').trim();
      const textCol = cols.slice(1).join(', ').trim();
      return { letter, text: textCol };
    });
  }, []);

  const parseQuestions = useCallback((text: string): ParsedQuestion[] => {
    // CSV columns: number, type, text, correct
    const rows = parseCSV(text);
    const out: ParsedQuestion[] = [];
    for (const r of rows) {
      if (r.length === 0) continue;
      const number = parseInt(r[0], 10);
      if (Number.isNaN(number)) continue;
      const type = (r[1] || '').toLowerCase();
      const qtext = r[2] || '';
      const correct = r[3] || '';
      out.push({ number, type, text: qtext, correct });
    }
    return out.sort((a,b) => a.number - b.number);
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setRawText(text);
      try {
        if (mode === 'headings') {
          const headingOptions = parseHeadings(text);
          onParsed({ headingOptions });
          toast.success(`Parsed ${headingOptions.length} heading(s)`);
        } else {
          const parsed = parseQuestions(text);
          // Convert contiguous same-type numbers into groups
          const groups: BulkImporterResult['groups'] = [];
          let i = 0;
          while (i < parsed.length) {
            const start = parsed[i].number;
            const type = parsed[i].type === 'short_answer' ? 'essay' : (parsed[i].type || 'multiple_choice');
            let j = i;
            const correctAnswers: string[] = [];
            const questionText = parsed[i].text || '';
            while (j + 1 < parsed.length && parsed[j + 1].type === parsed[i].type && parsed[j + 1].number === parsed[j].number + 1) {
              j++;
            }
            for (let k = i; k <= j; k++) correctAnswers.push(parsed[k].correct || '');
            groups!.push({ questionType: type as any, start, end: parsed[j].number, points: 1, questionText, correctAnswers });
            i = j + 1;
          }
          onParsed({ groups });
          toast.success(`Parsed ${parsed.length} question row(s)`);
        }
      } catch (err: any) {
        toast.error(err?.message || 'Failed to parse');
      }
    };
    reader.readAsText(file);
  }, [mode, onParsed, parseHeadings, parseQuestions]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    setRawText(text);
    try {
      if (mode === 'headings') {
        const headingOptions = parseHeadings(text);
        onParsed({ headingOptions });
        toast.success(`Parsed ${headingOptions.length} heading(s)`);
      } else {
        const parsed = parseQuestions(text);
        const groups: BulkImporterResult['groups'] = [];
        let i = 0;
        while (i < parsed.length) {
          const start = parsed[i].number;
          const type = parsed[i].type === 'short_answer' ? 'essay' : (parsed[i].type || 'multiple_choice');
          let j = i;
          const correctAnswers: string[] = [];
          const questionText = parsed[i].text || '';
          while (j + 1 < parsed.length && parsed[j + 1].type === parsed[i].type && parsed[j + 1].number === parsed[j].number + 1) {
            j++;
          }
          for (let k = i; k <= j; k++) correctAnswers.push(parsed[k].correct || '');
          groups!.push({ questionType: type as any, start, end: parsed[j].number, points: 1, questionText, correctAnswers });
          i = j + 1;
        }
        onParsed({ groups });
        toast.success(`Parsed ${parsed.length} question row(s)`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to parse');
    }
  }, [mode, onParsed, parseHeadings, parseQuestions]);

  const dropClasses = useMemo(() =>
    `border-2 border-dashed rounded-md p-4 text-sm ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`
  , [dragOver]);

  return (
    <div>
      <div
        className={dropClasses}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        role="button"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium text-gray-800">{mode === 'headings' ? 'Import Headings' : 'Import Questions'}</div>
            <div className="text-xs text-gray-500">Drag and drop a CSV or paste below.</div>
          </div>
          <div>
            <button className="px-2 py-1 text-xs border rounded" onClick={() => fileInputRef.current?.click()}>Browse</button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const text = String(reader.result || '');
                setRawText(text);
                try {
                  if (mode === 'headings') {
                    const headingOptions = parseHeadings(text);
                    onParsed({ headingOptions });
                    toast.success(`Parsed ${headingOptions.length} heading(s)`);
                  } else {
                    const parsed = parseQuestions(text);
                    const groups: BulkImporterResult['groups'] = [];
                    let i = 0;
                    while (i < parsed.length) {
                      const start = parsed[i].number;
                      const type = parsed[i].type === 'short_answer' ? 'essay' : (parsed[i].type || 'multiple_choice');
                      let j = i;
                      const correctAnswers: string[] = [];
                      const questionText = parsed[i].text || '';
                      while (j + 1 < parsed.length && parsed[j + 1].type === parsed[i].type && parsed[j + 1].number === parsed[j].number + 1) {
                        j++;
                      }
                      for (let k = i; k <= j; k++) correctAnswers.push(parsed[k].correct || '');
                      groups!.push({ questionType: type as any, start, end: parsed[j].number, points: 1, questionText, correctAnswers });
                      i = j + 1;
                    }
                    onParsed({ groups });
                    toast.success(`Parsed ${parsed.length} question row(s)`);
                  }
                } catch (err: any) {
                  toast.error(err?.message || 'Failed to parse');
                }
              };
              reader.readAsText(file);
            }} />
          </div>
        </div>
      </div>
      <textarea
        className="mt-2 w-full border rounded-md p-2 text-sm h-28"
        placeholder={mode === 'headings' ? 'A, Heading A\nB, Heading B\n...' : '1, multiple_choice, Question text, A\n2, matching, Paragraph text, C\n...'}
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        onPaste={handlePaste}
      />
      <div className="mt-2 text-xs text-gray-500">
        {mode === 'headings' ? 'Format: letter, heading text — letter optional. You can also paste one heading per line.' : 'Format: number, type, text, correct. Contiguous blocks of same type become groups.'}
      </div>
    </div>
  );
};

export default BulkImporter;

