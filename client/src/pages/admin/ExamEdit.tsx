import React, { useEffect, useState } from 'react';
import { computeSharedMcqBlocks, findBlockForQuestion, makeBlockKey, questionNumberOf, type SharedMcqBlock } from '../../utils/sharedOptions';

const buildLettersFromQuestions = (questions: any[]): string[] => {
  const letters: string[] = [];
  questions.forEach((q: any) => {
    (q.options || []).forEach((o: any) => {
      const letter = (o.option_letter || o.letter) as string | undefined;
      if (letter && !letters.includes(letter)) {
        letters.push(letter);
      }
    });
  });
  return letters;
};

// --- Simple Table Editor extracted to prevent hook order violations ---
const SimpleTableEditor: React.FC<{ question: any; updateQuestion: any; deleteQuestion: any; }> = ({ question: tq, updateQuestion, deleteQuestion }) => {
  const [localRows, setLocalRows] = React.useState<any[][]>(() => (tq.metadata?.simpleTable?.rows || [[]]).map((r:any)=> r.map((c:any)=> ({ ...c }))));
  const [dirty, setDirty] = React.useState(false);
  const sequenceStart: number | undefined = tq.metadata?.simpleTable?.sequenceStart;
  // Sync in external changes when not dirty
  React.useEffect(()=> {
    if (!dirty) {
      setLocalRows((tq.metadata?.simpleTable?.rows || [[]]).map((r:any)=> r.map((c:any)=> ({ ...c }))));
    }
  }, [tq.metadata?.simpleTable?.rows, dirty]);
  const commit = React.useCallback(() => {
    if (!dirty) return;
    const prevMeta = tq.metadata || {};
    const meta = { ...prevMeta, simpleTable: { ...(prevMeta.simpleTable||{}), rows: localRows, sequenceStart: prevMeta.simpleTable?.sequenceStart } };
    updateQuestion.mutate({ questionId: tq.id, data: { metadata: meta } });
    setDirty(false);
  }, [dirty, localRows, tq.id, tq.metadata, updateQuestion]);
  const addRow = () => setLocalRows(r => { const newRow = new Array(r[0]?.length || 1).fill(null).map(()=> ({ type:'text', content:'' })); setDirty(true); return [...r, newRow]; });
  const addCol = () => setLocalRows(r => { const next = r.map(row => [...row, { type:'text', content:'' }]); setDirty(true); return next; });
  const deleteRow = (ri:number) => setLocalRows(r => { if (r.length===1) return r; setDirty(true); return r.filter((_,i)=> i!==ri); });
  const deleteCol = (ci:number) => setLocalRows(r => { if (r[0]?.length===1) return r; setDirty(true); return r.map(row => row.filter((_,i)=> i!==ci)); });
  const updateCell = (ri:number, ci:number, patch: any) => setLocalRows(r => { const next = r.map(row => [...row]); next[ri][ci] = { ...next[ri][ci], ...patch }; setDirty(true); return next; });
  // Enumerate question cells row-major for display ordering (used for numbering preview)
  const enumerateQuestionCells = (): { ri:number; ci:number; cell:any }[] => {
    const acc: { ri:number; ci:number; cell:any }[] = [];
    localRows.forEach((row, ri) => row.forEach((cell:any, ci:number) => { if (cell?.type === 'question') acc.push({ ri, ci, cell }); }));
    return acc;
  };
  const questionCells = enumerateQuestionCells();
  type NumberingMode = 'cells' | 'blanks' | 'underscores';
  const autoAssignNumbers = (start: number, mode: NumberingMode) => {
    // Strategy:
    // cells: each question cell gets one number
    // blanks: count occurrences of {answer} or ___ patterns inside cell.content; assign multiple numbers to a single cell by cloning logical display numbers stored in metadata
    // underscores: count each underline sequence of 3+ underscores only
    let cur = start;
    const newRows = localRows.map(row => row.map((cell:any) => {
      if (cell.type !== 'question') return cell;
      if (mode === 'cells') {
        const next = { ...cell, questionNumber: cur };
        cur += 1;
        return next;
      }
      const text: string = cell.content || '';
      const tokens: number[] = [];
      if (mode === 'blanks') {
        const pattern = /\{answer\}|_{3,}/gi;
  while (pattern.exec(text) !== null) tokens.push(cur++);
      } else if (mode === 'underscores') {
        const pattern = /_{3,}/g;
  while (pattern.exec(text) !== null) tokens.push(cur++);
      }
      // Store array of numbers when multiple blanks; fallback to single questionNumber for student display mapping
      if (tokens.length === 0) {
        // treat as one blank
        const next = { ...cell, questionNumber: cur };
        cur += 1;
        return next;
      }
      const next = { ...cell, questionNumber: tokens[0], multiNumbers: tokens };
      return next;
    }));
    setLocalRows(newRows);
    setDirty(true);
    const prevMeta = tq.metadata || {};
    const meta = { ...prevMeta, simpleTable: { ...(prevMeta.simpleTable||{}), rows: newRows, sequenceStart: start, numberingMode: mode } };
    updateQuestion.mutate({ questionId: tq.id, data: { metadata: meta } });
  };
  const clearNumbers = () => {
    setLocalRows(rows => rows.map(row => row.map((cell:any) => cell.type==='question' ? ({ ...cell, questionNumber: undefined }) : cell )));
    setDirty(true);
  };
  const renumberSequential = (start: number) => {
    // Renumber all question cells sequentially preserving blank counts (multiNumbers length)
    let cur = start;
    const numberingMode: NumberingMode = (tq.metadata?.simpleTable?.numberingMode as NumberingMode) || 'cells';
    const newRows = localRows.map(row => row.map((cell:any) => {
      if (cell.type !== 'question') return cell;
      if (numberingMode === 'cells') {
        const next = { ...cell, questionNumber: cur, multiNumbers: undefined };
        cur += 1;
        return next;
      }
      // For blanks/underscores modes, preserve number of blanks (multiNumbers length) if present, else treat as single
      let count = Array.isArray(cell.multiNumbers) && cell.multiNumbers.length > 1 ? cell.multiNumbers.length : 1;
      const assigned: number[] = [];
      for (let i=0;i<count;i++) assigned.push(cur++);
      const next = { ...cell, questionNumber: assigned[0], multiNumbers: count>1 ? assigned : undefined };
      return next;
    }));
    setLocalRows(newRows);
    setDirty(true);
    const prevMeta = tq.metadata || {};
    const meta = { ...prevMeta, simpleTable: { ...(prevMeta.simpleTable||{}), rows: newRows, sequenceStart: start } };
    updateQuestion.mutate({ questionId: tq.id, data: { metadata: meta } });
  };
  return (
    <div className="mb-4 border rounded bg-white" key={tq.id}>
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Simple Table (Q{tq.questionNumber}) {dirty && <em className="ml-2 text-[10px] text-orange-600">Unsaved…</em>}</span>
        <div className="flex items-center gap-2">
          {dirty && (
            <button type="button" className="text-[10px] px-2 py-0.5 border rounded border-blue-300 text-blue-600" onClick={commit}>Save</button>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 border rounded border-indigo-300 text-indigo-700"
              title="Assign sequential question numbers (one per question cell)"
              onClick={() => {
                const startStr = window.prompt('Start number (cells mode)', String(sequenceStart || tq.questionNumber || 1));
                if (!startStr) return; const start = Number(startStr); if (isNaN(start) || start<=0) return alert('Invalid start');
                autoAssignNumbers(start, 'cells');
              }}
            >Cells #</button>
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 border rounded border-indigo-300 text-indigo-700"
              title="Assign numbers for each blank token {answer} or underline sequence ___"
              onClick={() => {
                const startStr = window.prompt('Start number (blanks mode)', String(sequenceStart || tq.questionNumber || 1));
                if (!startStr) return; const start = Number(startStr); if (isNaN(start) || start<=0) return alert('Invalid start');
                autoAssignNumbers(start, 'blanks');
              }}
            >Blanks #</button>
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 border rounded border-indigo-300 text-indigo-700"
              title="Assign numbers only for underline sequences (___)"
              onClick={() => {
                const startStr = window.prompt('Start number (underscores mode)', String(sequenceStart || tq.questionNumber || 1));
                if (!startStr) return; const start = Number(startStr); if (isNaN(start) || start<=0) return alert('Invalid start');
                autoAssignNumbers(start, 'underscores');
              }}
            >Underlines #</button>
          </div>
          {questionCells.some(c => c.cell?.questionNumber) && (
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 border rounded border-amber-300 text-amber-600"
              title="Remove assigned numbers from question cells"
              onClick={() => { if (window.confirm('Clear all assigned question numbers?')) clearNumbers(); }}
            >Clear #</button>
          )}
          {questionCells.length > 0 && (
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 border rounded border-indigo-300 text-indigo-700"
              title="Renumber sequentially (preserves number of blanks per cell)"
              onClick={() => { const startStr = window.prompt('Start number for renumbering', String(tq.metadata?.simpleTable?.sequenceStart || 1)); if (!startStr) return; const start = Number(startStr); if (isNaN(start)||start<=0) return alert('Invalid start'); renumberSequential(start); }}
            >Renumber</button>
          )}
          <button 
            type="button" 
            className="text-[10px] px-2 py-0.5 border rounded border-red-300 text-red-600" 
            onClick={() => { if (window.confirm('Delete table?')) deleteQuestion.mutate({ questionId: tq.id }); }}
          >Delete</button>
        </div>
      </div>
      <div className="p-3 space-y-3">
        {(() => {
          // Detect numbering overlaps or gaps vs assigned multiNumbers
          try {
            const nums: number[] = [];
            localRows.forEach(r => r.forEach((c:any) => {
              if (c?.type==='question') {
                if (Array.isArray(c.multiNumbers)) nums.push(...c.multiNumbers);
                else if (typeof c.questionNumber === 'number') nums.push(c.questionNumber);
              }
            }));
            if (nums.length) {
              const counts: Record<number, number> = {} as any;
              nums.forEach(n => { counts[n] = (counts[n]||0)+1; });
              const unique = Array.from(new Set(nums)).sort((a,b)=>a-b);
              const duplicates = unique.filter(n => counts[n] > 1);
              const gaps: number[] = [];
              for (let i=1;i<unique.length;i++) {
                if (unique[i] !== unique[i-1] + 1) {
                  for (let m = unique[i-1] + 1; m < unique[i]; m++) gaps.push(m);
                }
              }
              if (gaps.length || duplicates.length) {
                return (
                  <div className="text-[10px] text-red-600 flex flex-wrap items-center gap-2">
                    <span>Numbering issues:</span>
                    {duplicates.length>0 && <span>Duplicates: {duplicates.join(', ')}</span>}
                    {gaps.length>0 && <span>Missing: {gaps.join(', ')}</span>}
                    <button
                      type="button"
                      className="ml-2 px-1.5 py-0.5 border rounded border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                      onClick={() => { const startStr = window.prompt('Start number for renumbering', String(unique[0] || 1)); if (!startStr) return; const start = Number(startStr); if (isNaN(start)||start<=0) return alert('Invalid start'); renumberSequential(start); }}
                    >Fix</button>
                  </div>
                );
              }
            }
          } catch {}
          return null;
        })()}
        <div>
          <label className="block text-[11px] text-gray-600 mb-1">Table Instructions/Title</label>
          <textarea 
            defaultValue={tq.questionText || ''} 
            rows={2} 
            className="w-full border rounded text-xs p-2" 
            onBlur={(e) => { if (e.target.value !== (tq.questionText||'')) updateQuestion.mutate({ questionId: tq.id, data: { questionText: e.target.value } }); }} 
          />
        </div>
        <div className="overflow-auto">
          <table className="min-w-[400px] text-xs border border-gray-300">
            <tbody>
              {localRows.map((row, ri) => (
                <tr key={ri} className="border-b last:border-b-0">
                  {row.map((cell:any, ci:number) => (
                    <td key={ci} className="border-r last:border-r-0 p-1 align-top min-w-[120px]">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <select 
                            value={cell?.type || 'text'} 
                            onChange={(e) => updateCell(ri, ci, { type: e.target.value })}
                            className="text-[10px] border rounded px-1 py-0.5 flex-1"
                          >
                            <option value="text">Text</option>
                            <option value="question">Question</option>
                          </select>
                          {ri === 0 && row.length > 1 && (
                            <button 
                              type="button" 
                              onClick={() => deleteCol(ci)} 
                              className="text-[9px] px-1 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded"
                              title="Delete column"
                            >-C</button>
                          )}
                          {ci === 0 && localRows.length > 1 && (
                            <button 
                              type="button" 
                              onClick={() => deleteRow(ri)} 
                              className="text-[9px] px-1 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded"
                              title="Delete row"
                            >-R</button>
                          )}
                        </div>
                        {cell?.type === 'text' ? (
                          <textarea
                            value={cell?.content || ''}
                            onChange={(e) => updateCell(ri, ci, { content: e.target.value })}
                            onBlur={commit}
                            placeholder="Cell text..."
                            className="w-full border rounded text-xs p-1 min-h-[60px] resize-none"
                          />
                        ) : (
                          <div className="space-y-1">
                            <div className="flex gap-1">
                              <select 
                                value={cell?.questionType || 'fill_blank'} 
                                onChange={(e) => updateCell(ri, ci, { questionType: e.target.value })}
                                onBlur={commit}
                                className="text-[10px] border rounded px-1 py-0.5 flex-1"
                              >
                                <option value="fill_blank">Fill Blank</option>
                                <option value="multiple_choice">Multiple Choice</option>
                                <option value="true_false">True/False</option>
                              </select>
                              <input
                                type="number"
                                value={cell?.points || 1}
                                onChange={(e) => updateCell(ri, ci, { points: Number(e.target.value) || 1 })}
                                onBlur={commit}
                                className="w-12 text-[10px] border rounded px-1 py-0.5"
                                placeholder="Pts"
                                min="0.5"
                                step="0.5"
                              />
                              {cell?.type==='question' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 min-w-[28px] text-center" title="Assigned question number (student sees this)">
                                  {cell.questionNumber ?? '—'}
                                </span>
                              )}
                            </div>
                            <textarea
                              value={cell?.content || ''}
                              onChange={(e) => updateCell(ri, ci, { content: e.target.value })}
                              onBlur={commit}
                              placeholder="Question text..."
                              className="w-full border rounded text-xs p-1 min-h-[60px] resize-none"
                            />
                            {/* Correct answer authoring moved below table for clarity */}
                            {cell?.questionType === 'fill_blank' && (
                              <div className="text-[9px] text-gray-500 italic">Answers moved below the table ↓</div>
                            )}
                            {cell?.questionType === 'short_answer' && (
                              <div className="space-y-0.5">
                                <input
                                  value={cell?.correctAnswer || ''}
                                  onChange={(e) => updateCell(ri, ci, { correctAnswer: e.target.value })}
                                  onBlur={commit}
                                  placeholder="Accepted answers (| separated, 1-3 words each)"
                                  className="w-full border rounded text-[10px] px-1 py-0.5"
                                />
                              </div>
                            )}
                            {cell?.questionType === 'multiple_choice' && (
                              <div className="space-y-0.5">
                                <div className="text-[10px] text-gray-500">Add options inline in the text (e.g. A) Paris  B) Rome  C) London)</div>
                                <input
                                  value={cell?.correctAnswer || ''}
                                  onChange={(e) => updateCell(ri, ci, { correctAnswer: e.target.value.toUpperCase().replace(/[^A-Z|]/g,'') })}
                                  onBlur={commit}
                                  placeholder="Correct letter(s) e.g. A or A|C"
                                  className="w-full border rounded text-[10px] px-1 py-0.5"
                                />
                              </div>
                            )}
                            {cell?.questionType === 'true_false' && (
                              <div className="space-y-0.5">
                                <select
                                  value={cell?.correctAnswer || ''}
                                  onChange={(e) => { updateCell(ri, ci, { correctAnswer: e.target.value }); commit(); }}
                                  className="w-full border rounded text-[10px] px-1 py-0.5"
                                >
                                  <option value="">(No correct answer yet)</option>
                                  <option value="true">True</option>
                                  <option value="false">False</option>
                                  <option value="not given">Not Given</option>
                                </select>
                              </div>
                            )}
                            {cell?.questionType === 'multiple_choice' && (
                              <div className="text-[10px] text-gray-500">
                                Add options: A) Option 1  B) Option 2  C) Option 3
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 text-[10px]">
          <button 
            type="button" 
            className="px-2 py-1 border rounded border-blue-300 text-blue-600" 
            onClick={() => { addRow(); commit(); }}
          >+ Row</button>
          <button 
            type="button" 
            className="px-2 py-1 border rounded border-blue-300 text-blue-600" 
            onClick={() => { addCol(); commit(); }}
          >+ Column</button>
          <span className="text-gray-500 self-center">
            Text cells contain static content. Question cells will be interactive for students.
          </span>
        </div>
        {/* Consolidated answer editor for question cells */}
        {questionCells.length > 0 && (
          <div className="mt-4 border rounded bg-gray-50 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-gray-700">Question Cell Answers (outside table)</span>
              <button
                type="button"
                className="text-[10px] px-2 py-0.5 border rounded border-gray-300 text-gray-600 hover:bg-gray-100"
                onClick={() => {
                  // Clear all correct answers for question cells
                  setLocalRows(r => {
                    const next = r.map(row => row.map((c:any) => c.type==='question' ? { ...c, correctAnswer: '' } : c));
                    setDirty(true);
                    return next;
                  });
                }}
              >Clear All</button>
            </div>
            <div className="space-y-3 max-h-80 overflow-auto pr-1">
              {questionCells.map(({ ri, ci, cell }: any) => {
                const qNum = Array.isArray(cell.multiNumbers) ? (cell.multiNumbers.join(', ')) : (cell.questionNumber ?? '—');
                const cellLabel = `R${ri+1}C${ci+1}`;
                const qType = cell.questionType || 'fill_blank';
                if (qType === 'fill_blank') {
                  const raw = cell?.content || '';
                  const blankMatches = raw.match(/\{answer\}|_{3,}/gi) || [];
                  const blanks = blankMatches.length || 1;
                  const existing = (cell?.correctAnswer || '').trim();
                  let perBlank: string[] = existing ? existing.split(/\s*;\s*/).map((s: string)=>s.trim()) : [];
                  if (perBlank.length < blanks) perBlank = [...perBlank, ...Array(blanks - perBlank.length).fill('')];
                  else if (perBlank.length > blanks) perBlank = perBlank.slice(0, blanks);
                  const updatePerBlank = (arr: string[]) => {
                    updateCell(ri, ci, { correctAnswer: arr.join(';') });
                  };
                  return (
                    <div key={`ans-${ri}-${ci}`} className="border rounded bg-white p-2 shadow-sm">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[10px] font-medium text-gray-700 flex flex-wrap gap-2">
                          <span className="px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 rounded">Q{qNum}</span>
                          <span className="text-gray-500">{cellLabel}</span>
                          <span className="text-gray-500 truncate max-w-[180px]" title={raw}>{raw ? raw.replace(/\s+/g,' ').slice(0,80) : '(blank question text)'}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {blanks > 1 && <span className="text-[9px] text-gray-500">{blanks} blanks</span>}
                          <button
                            type="button"
                            className="text-[9px] px-1.5 py-0.5 border rounded border-gray-300 text-gray-600 hover:bg-gray-100"
                            onClick={() => updatePerBlank(Array(blanks).fill(''))}
                          >Clear</button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {perBlank.map((val: string, bi: number) => (
                          <input
                            key={bi}
                            value={val}
                            onChange={(e) => {
                              const next = [...perBlank];
                              next[bi] = e.target.value;
                              updatePerBlank(next);
                            }}
                            onBlur={commit}
                            placeholder={blanks > 1 ? `Blank ${bi+1} (variants with |)` : 'Answer or variants with |'}
                            className="w-full border rounded text-[10px] px-1 py-0.5"
                          />
                        ))}
                        <div className="text-[9px] text-gray-500 leading-snug">Variants with | . Points split equally across blanks. Case-insensitive; numeric answers compared numerically.</div>
                      </div>
                    </div>
                  );
                }
                // Other question types inside table (short_answer, multiple_choice, true_false)
                if (qType === 'short_answer') {
                  return (
                    <div key={`ans-${ri}-${ci}`} className="border rounded bg-white p-2 shadow-sm">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[10px] font-medium text-gray-700 flex flex-wrap gap-2">
                          <span className="px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 rounded">Q{qNum}</span>
                          <span className="text-gray-500">{cellLabel}</span>
                        </div>
                        <button
                          type="button"
                          className="text-[9px] px-1.5 py-0.5 border rounded border-gray-300 text-gray-600 hover:bg-gray-100"
                          onClick={() => updateCell(ri, ci, { correctAnswer: '' })}
                        >Clear</button>
                      </div>
                      <input
                        value={cell?.correctAnswer || ''}
                        onChange={(e) => updateCell(ri, ci, { correctAnswer: e.target.value })}
                        onBlur={commit}
                        placeholder="Accepted answers (| separated)"
                        className="w-full border rounded text-[10px] px-1 py-0.5"
                      />
                    </div>
                  );
                }
                if (qType === 'multiple_choice') {
                  return (
                    <div key={`ans-${ri}-${ci}`} className="border rounded bg-white p-2 shadow-sm">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[10px] font-medium text-gray-700 flex flex-wrap gap-2">
                          <span className="px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 rounded">Q{qNum}</span>
                          <span className="text-gray-500">{cellLabel}</span>
                        </div>
                        <button
                          type="button"
                          className="text-[9px] px-1.5 py-0.5 border rounded border-gray-300 text-gray-600 hover:bg-gray-100"
                          onClick={() => updateCell(ri, ci, { correctAnswer: '' })}
                        >Clear</button>
                      </div>
                      <input
                        value={cell?.correctAnswer || ''}
                        onChange={(e) => updateCell(ri, ci, { correctAnswer: e.target.value.toUpperCase().replace(/[^A-Z|]/g,'') })}
                        onBlur={commit}
                        placeholder="Correct letter(s) e.g. A or A|C"
                        className="w-full border rounded text-[10px] px-1 py-0.5"
                      />
                    </div>
                  );
                }
                if (qType === 'true_false') {
                  return (
                    <div key={`ans-${ri}-${ci}`} className="border rounded bg-white p-2 shadow-sm">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[10px] font-medium text-gray-700 flex flex-wrap gap-2">
                          <span className="px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 rounded">Q{qNum}</span>
                          <span className="text-gray-500">{cellLabel}</span>
                        </div>
                        <button
                          type="button"
                          className="text-[9px] px-1.5 py-0.5 border rounded border-gray-300 text-gray-600 hover:bg-gray-100"
                          onClick={() => updateCell(ri, ci, { correctAnswer: '' })}
                        >Clear</button>
                      </div>
                      <select
                        value={cell?.correctAnswer || ''}
                        onChange={(e) => { updateCell(ri, ci, { correctAnswer: e.target.value }); commit(); }}
                        className="w-full border rounded text-[10px] px-1 py-0.5"
                      >
                        <option value="">(No correct answer yet)</option>
                        <option value="true">True</option>
                        <option value="false">False</option>
                        <option value="not given">Not Given</option>
                      </select>
                    </div>
                  );
                }
                return null;
              })}
            </div>
            <div className="mt-2 text-[10px] text-gray-500">Edit all answers here. This keeps the table layout clean.</div>
          </div>
        )}
      </div>
    </div>
  );
};


import ConfirmDialog from '../../components/ui/ConfirmDialog';

// Exam-level audio manager component (upload + external URL)
const ExamAudioManager: React.FC<{ exam: any; apiOrigin: string; onUpdate: (payload: { audioUrl?: string }) => void }> = ({ exam, apiOrigin, onUpdate }) => {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error'>('idle');

  const handleUpload = async () => {
    if (!file) return;
    if (file.size > 26 * 1024 * 1024) { toast.error('File too large (max 25MB)'); return; }
    try {
      setStatus('uploading');
      setProgress(0);
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${apiOrigin}/api/admin/exams/${exam.id}/audio`, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || sessionStorage.getItem('token') || ''}`
        }
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Upload failed');
      toast.success('Exam audio uploaded');
      onUpdate({}); // trigger refetch upstream via mutation onUpdate? We'll rely on invalidation outside
      setFile(null);
      setProgress(100);
      setStatus('idle');
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
      setStatus('error');
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {exam.audioUrl ? (
        <div className="p-2 border rounded bg-gray-50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Current Audio</span>
            <button
              type="button"
              className="px-2 py-0.5 border rounded text-[11px] text-red-600 border-red-300 hover:bg-red-50"
              onClick={() => onUpdate({ audioUrl: '' })}
            >Remove</button>
          </div>
          <audio controls className="w-full">
            <source src={exam.audioUrl.startsWith('http') ? exam.audioUrl : `${apiOrigin}${exam.audioUrl}`} />
            Your browser does not support the audio element.
          </audio>
          <div className="text-[11px] break-all text-gray-500">{exam.audioUrl}</div>
        </div>
      ) : (
        <div className="text-[11px] text-gray-500">No audio set. Upload a file or paste an external URL below.</div>
      )}
      <div className="flex items-center gap-2">
        <input
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/*"
          onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); setProgress(0); setStatus('idle'); }}
          className="flex-1 text-[11px]"
        />
        <button
          type="button"
          disabled={!file || status === 'uploading'}
          onClick={handleUpload}
          className={`px-3 py-1 rounded border text-xs ${(!file || status==='uploading') ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-500'}`}
        >{status==='uploading' ? 'Uploading…' : (exam.audioUrl ? 'Replace' : 'Upload')}</button>
      </div>
      {file && (
        <div className="flex justify-between text-[11px] text-gray-600">
          <span>{file.name} ({(file.size/1024/1024).toFixed(2)} MB)</span>
          {progress > 0 && <span>{progress}%</span>}
        </div>
      )}
      <div>
        <label className="block text-[11px] text-gray-600 mb-0.5">External Audio URL (optional)</label>
        <input
          placeholder="https://..."
          defaultValue={exam.audioUrl && exam.audioUrl.startsWith('http') ? exam.audioUrl : ''}
          onBlur={(e) => {
            const val = e.target.value.trim();
            onUpdate({ audioUrl: val });
          }}
          className="w-full rounded-md border-gray-300 text-xs"
        />
        <div className="text-[10px] text-gray-400 mt-0.5">External URL overrides uploaded file path.</div>
      </div>
      <div className="text-[10px] text-gray-500">Audio plays once globally in Listening. Max 25MB. Supported: MP3/WAV.</div>
    </div>
  );
};
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { apiService } from '../../services/api';
// Simplified: temporarily hide complex bulk importers for clarity

const AdminExamEdit: React.FC = () => {
  // Global confirm dialog pattern
  const [confirmState, setConfirmState] = useState<{ open: boolean; title?: string; description?: React.ReactNode; tone?: 'danger' | 'default' | 'warning'; onConfirm?: () => void; confirmText?: string }>({ open: false });
  const openConfirm = (cfg: Omit<typeof confirmState, 'open'>) => setConfirmState({ open: true, ...cfg });
  const closeConfirm = () => setConfirmState(s => ({ ...s, open: false }));
  const runConfirm = () => { const fn = confirmState.onConfirm; closeConfirm(); if (fn) fn(); };
  // Derive API server origin (strip trailing /api) for static asset prefix
  const apiFull = (import.meta.env.VITE_API_URL || 'http://localhost:7000/api');
  const apiOrigin = apiFull.replace(/\/?api\/?$/, '');
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: exam, isLoading } = useQuery({
    queryKey: ['admin-exam', examId],
    queryFn: async () => {
      const res = await apiService.get<any>(`/exams/${examId}`, { questions: 'true' });
      return (res.data as any)?.exam || res.data;
    },
    enabled: !!examId
  });

  const updateExam = useMutation({
    mutationFn: async (payload: any) => apiService.put(`/admin/exams/${examId}`, payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); },
    onError: (e: any) => toast.error(e.message || 'Failed to update exam')
  });

  const updateSection = useMutation({
    mutationFn: async ({ sectionId, data }: { sectionId: string; data: any }) => apiService.put(`/admin/exams/${examId}/sections/${sectionId}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); },
    onError: (e: any) => toast.error(e.message || 'Failed to update section')
  });

  const createSection = useMutation({
    mutationFn: async (data: { sectionType: string; title: string; maxScore: number; sectionOrder: number }) => apiService.post(`/admin/exams/${examId}/sections`, { sections: [data] }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); toast.success('Section added'); },
    onError: (e: any) => toast.error(e.message || 'Failed to add section')
  });

  const deleteSection = useMutation({
    mutationFn: async ({ sectionId }: { sectionId: string }) => apiService.delete(`/admin/sections/${sectionId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); toast.success('Section deleted'); },
    onError: (e: any) => toast.error(e.message || 'Failed to delete section')
  });

  const bulkCreateQuestions = useMutation({
    mutationFn: async ({ sectionId, groups }: { sectionId: string; groups: any[] }) => apiService.post(`/admin/exams/${examId}/questions/bulk`, { sectionId, groups }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); toast.success('Questions created'); },
    onError: (e: any) => toast.error(e.message || 'Bulk create failed')
  });

  // Local draft for adding a section
  const [newSection, setNewSection] = useState<{ sectionType: string; title: string; maxScore: number }>({ sectionType: 'reading', title: '', maxScore: 9 });
  const nextSectionOrder = () => {
    const orders = (exam.sections || []).map((s: any)=> s.sectionOrder || 0);
    return (orders.length ? Math.max(...orders) : 0) + 1;
  };

  // Per-section bulk range draft UI state
  const [rangeDrafts, setRangeDrafts] = useState<Record<string, { questionType: string; start: string; end: string; points: string; fillMissing?: boolean }>>({});
  const setRangeDraft = (sectionId: string, patch: Partial<{ questionType: string; start: string; end: string; points: string; fillMissing?: boolean }>) => {
    setRangeDrafts(prev => ({ ...prev, [sectionId]: { questionType: prev[sectionId]?.questionType || 'multiple_choice', start: prev[sectionId]?.start || '', end: prev[sectionId]?.end || '', points: prev[sectionId]?.points || '1', fillMissing: prev[sectionId]?.fillMissing || false, ...patch } }));
  };

  // Question save status indicator
  type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  const [questionStatus, setQuestionStatus] = useState<Record<string, SaveStatus>>({});
  const setStatus = (id: string, s: SaveStatus) => setQuestionStatus(prev => ({ ...prev, [id]: s }));
  const markSavedFor = (id: string, ms = 1200) => {
    setStatus(id, 'saved');
    setTimeout(() => setStatus(id, 'idle'), ms);
  };

  // Pending heading selection for matching assignment
  const [pendingHeading, setPendingHeading] = useState<string | null>(null);
  // Simple DnD assist
  const [draggingLetter, setDraggingLetter] = useState<string | null>(null);
  const [dragOverQuestionId, setDragOverQuestionId] = useState<string | null>(null);
  // Bulk ranges for non-matching editors (key: sectionId:type)
  // Advanced list visibility per section
  const [showAdvanced, setShowAdvanced] = useState<Record<string, boolean>>({});
  const [openLocalOptions, setOpenLocalOptions] = useState<Record<string, boolean>>({});
  const [hideSharedOptions, setHideSharedOptions] = useState<Record<string, boolean>>({});

  // Section type navigator (tabs) to reduce page length for full mock exams
  const [activeSectionType, setActiveSectionType] = useState<string>('');
  // Part grouping for full-mock exams: listening has 4 parts, reading has 3 passages.
  const [activePartByType, setActivePartByType] = useState<Record<string, number>>({});
  const FULL_MOCK = Array.isArray(exam?.tags) && exam.tags.includes('full-mock');
  const LISTENING_PARTS = [1,2,3,4];
  const READING_PARTS = [1,2,3];
  useEffect(() => {
    if (!exam) return;
    const types: string[] = Array.from(new Set((exam.sections || []).map((s: any) => s.sectionType))) as string[];
    if (!types.length) return;
    const prefOrder = ['listening','reading','writing','speaking'];
    const sorted = types.sort((a: string, b: string) => (prefOrder.indexOf(a) - prefOrder.indexOf(b)));
    if (!activeSectionType || !sorted.includes(activeSectionType)) {
      setActiveSectionType(sorted[0] as string);
    }
    // Initialize active part per type if not set
    sorted.forEach(t => {
      setActivePartByType(prev => prev[t] ? prev : { ...prev, [t]: 1 });
    });
  }, [exam?.sections]);

  const updateQuestion = useMutation({
    mutationFn: async ({ questionId, data }: { questionId: string; data: any }) => apiService.put(`/admin/questions/${questionId}`, data),
    onSuccess: (_res, vars) => { markSavedFor(vars.questionId); queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); },
    onError: (e: any, vars) => { setStatus(vars.questionId, 'error'); toast.error(e.message || 'Failed to update question'); }
  });

  const createQuestion = useMutation({
    mutationFn: async ({ sectionId, questionType, metadata, questionText }: { sectionId: string; questionType: string; metadata?: any; questionText?: string }) => apiService.post(`/admin/sections/${sectionId}/questions`, { questionType, metadata, questionText }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); toast.success('Question added'); },
    onError: (e: any) => toast.error(e.message || 'Failed to add question')
  });

  // Helper to produce part metadata for current active part when creating questions in a full-mock listening/reading section
  const basePartMeta = (section: any): any | undefined => {
    if (!FULL_MOCK) return undefined;
    if (!section) return undefined;
    if (section.sectionType === 'listening') return { listeningPart: activePartByType['listening'] || 1 };
    if (section.sectionType === 'reading') return { readingPart: activePartByType['reading'] || 1 };
    return undefined;
  };
  // Merge helper: attach current part meta (if any) to provided metadata object
  const withPartMeta = (section: any, meta?: any) => {
    const part = basePartMeta(section);
    if (part) return { ...(meta||{}), ...part };
    return meta;
  };

  const deleteQuestion = useMutation({
    mutationFn: async ({ questionId }: { questionId: string }) => apiService.delete(`/admin/questions/${questionId}`),
  onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); },
    onError: (e: any) => toast.error(e.message || 'Failed to delete question')
  });

  const createOption = useMutation({
    mutationFn: async ({ questionId, optionText, optionLetter, optionOrder }: any) => apiService.post(`/admin/questions/${questionId}/options`, { optionText, optionLetter, optionOrder }),
    onSuccess: (_res, vars: any) => { markSavedFor(vars.questionId); queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); },
    onError: (_e, vars: any) => setStatus(vars.questionId, 'error')
  });
  const updateOption = useMutation({
    mutationFn: async ({ optionId, data }: any) => apiService.put(`/admin/options/${optionId}`, data),
    onSuccess: (_res, vars: any) => { markSavedFor(vars.questionId); queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); },
    onError: (_e, vars: any) => setStatus(vars.questionId, 'error')
  });
  const deleteOption = useMutation({
    mutationFn: async ({ optionId }: any) => apiService.delete(`/admin/options/${optionId}`),
    onSuccess: (_res, vars: any) => { markSavedFor(vars.questionId); queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); },
    onError: (_e, vars: any) => setStatus(vars.questionId, 'error')
  });

  // Dynamic shared MCQ options per section (letters list)
  const [sharedOptionLetters, setSharedOptionLetters] = useState<Record<string, Record<string, string[]>>>({});
  // Per-section audio logic removed (centralized exam audio)

  const resolveSharedLetters = (section: any, block: SharedMcqBlock): string[] => {
    const sectionLetters = sharedOptionLetters[section.id] || {};
    const key = makeBlockKey(section.id, block);
    const existing = sectionLetters[key];
    if (existing && existing.length) {
      return existing;
    }
    return buildLettersFromQuestions(block.questions);
  };

  // Initialize letters for sections that use shared options
  useEffect(() => {
    if (!exam) return;
    setSharedOptionLetters((prev) => {
      const next: Record<string, Record<string, string[]>> = {};
      let changed = false;
      const sectionIds = new Set((exam.sections || []).map((s: any) => s.id));

      Object.entries(prev).forEach(([sectionId, blocks]) => {
        if (sectionIds.has(sectionId)) {
          next[sectionId] = { ...blocks };
        } else {
          changed = true;
        }
      });

      exam.sections?.forEach((section: any) => {
        const blocks = computeSharedMcqBlocks(section);
        const sectionKey = section.id;
        const existingBlocks = next[sectionKey] ? { ...next[sectionKey] } : {};
        const validKeys = new Set(blocks.map((block) => makeBlockKey(sectionKey, block)));

        Object.keys(existingBlocks).forEach((blockKey) => {
          if (!validKeys.has(blockKey)) {
            delete existingBlocks[blockKey];
            changed = true;
          }
        });

        blocks.forEach((block) => {
          const key = makeBlockKey(sectionKey, block);
          const currentLetters = existingBlocks[key] || [];
          const letters = buildLettersFromQuestions(block.questions);
          if (!existingBlocks[key] || currentLetters.join('|') !== letters.join('|')) {
            existingBlocks[key] = letters;
            changed = true;
          }
        });

        next[sectionKey] = existingBlocks;
      });

      return changed ? next : prev;
    });
  }, [exam]);

  const computeNextLetter = (used: string[]): string => {
    const A = 'A'.charCodeAt(0);
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(A + i);
      if (!used.includes(letter)) return letter;
    }
    return String.fromCharCode(A + used.length); // fallback (should not exceed Z realistically)
  };

  // --- Custom MCQ group option helpers ---
  const mcqGroupMembers = (section: any, anchorId: string) => section.questions.filter((qq: any) => qq.questionType === 'multiple_choice' && (qq.id === anchorId || qq.metadata?.groupMemberOf === anchorId));
  const toggleCustomOptionsForGroup = async (section: any, anchor: any, enable: boolean) => {
    const members = mcqGroupMembers(section, anchor.id);
    // Determine shared baseline options (letters + text) from first non-custom MCQ or anchor itself
    const block = findBlockForQuestion(section, anchor.id);
    const blockBaseline = block?.questions?.find((q:any)=> !q.metadata?.customOptionsGroup) || block?.questions?.[0];
    const baselineQ = blockBaseline || section.questions.find((q:any)=> q.questionType==='multiple_choice' && !q.metadata?.customOptionsGroup) || anchor;
    const baselineOptions = (baselineQ?.options || []).map((o:any)=>({ letter: o.option_letter || o.letter, text: o.option_text || o.text || '' })).filter((o:any)=>o.letter);
    for (const m of members) {
      const meta = { ...(m.metadata || {}) };
      if (enable) meta.customOptionsGroup = true; else delete meta.customOptionsGroup;
      await updateQuestion.mutateAsync({ questionId: m.id, data: { metadata: meta } });
      if (enable) {
        // Ensure each baseline option exists for this member, cloning text
        const existingLetters = new Set((m.options || []).map((o:any)=> o.option_letter || o.letter));
        for (const bo of baselineOptions) {
          if (!existingLetters.has(bo.letter)) {
            await createOption.mutateAsync({ questionId: m.id, optionText: bo.text, optionLetter: bo.letter, optionOrder: (m.options?.length || 0) + 1 });
          }
        }
      }
    }
    if (enable) {
      setOpenLocalOptions(prev => ({ ...prev, [anchor.id]: true }));
    }
  };

  const addSharedOption = async (section: any, block: SharedMcqBlock) => {
    const sharedMcqs = block.questions;
    if (!sharedMcqs.length) {
      toast.error('No questions in this section are using shared options. Switch a question back to "Shared opts" first.');
      return;
    }
    const key = makeBlockKey(section.id, block);
    const current = resolveSharedLetters(section, block);
    const existingLetters = Array.from(new Set([...(current || []).filter(Boolean), ...buildLettersFromQuestions(sharedMcqs)]));
    const nextLetter = computeNextLetter(existingLetters);
    for (const q of sharedMcqs) {
      const alreadyExists = (q.options || []).some((o: any) => (o.option_letter || o.letter) === nextLetter);
      if (!alreadyExists) {
        await createOption.mutateAsync({ questionId: q.id, optionText: '', optionLetter: nextLetter, optionOrder: (q.options?.length || 0) + 1 });
      }
    }
    const nextLetters = [...existingLetters];
    if (!nextLetters.includes(nextLetter)) {
      nextLetters.push(nextLetter);
    }
    setSharedOptionLetters((prev) => {
      const sectionMap = { ...(prev[section.id] || {}) };
      sectionMap[key] = nextLetters;
      return { ...prev, [section.id]: sectionMap };
    });
  };

  const removeSharedOption = async (section: any, block: SharedMcqBlock, letter: string) => {
    openConfirm({
      title: 'Remove Shared Option',
      description: <>Remove option <strong>{letter}</strong> from this shared MCQ group? This action cannot be undone.</>,
      tone: 'warning',
      confirmText: 'Remove',
      onConfirm: async () => {
        const mcqs = block.questions;
        for (const q of mcqs) {
          const opt = (q.options || []).find((o: any) => (o.option_letter || o.letter) === letter);
          if (opt) {
            await deleteOption.mutateAsync({ optionId: opt.id, questionId: q.id });
          }
          if (q.correctAnswer) {
            if (q.metadata?.allowMultiSelect || String(q.correctAnswer).includes('|')) {
              const parts = String(q.correctAnswer).split('|').filter(Boolean);
              if (parts.includes(letter)) {
                const next = parts.filter((p: string) => p !== letter).join('|');
                await updateQuestion.mutateAsync({ questionId: q.id, data: { correctAnswer: next } });
              }
            } else if (String(q.correctAnswer) === letter) {
              await updateQuestion.mutateAsync({ questionId: q.id, data: { correctAnswer: '' } });
            }
          }
        }
        const key = makeBlockKey(section.id, block);
        setSharedOptionLetters((prev) => {
          const sectionMap = { ...(prev[section.id] || {}) };
          sectionMap[key] = (sectionMap[key] || []).filter((l) => l !== letter);
          return { ...prev, [section.id]: sectionMap };
        });
      }
    });
  };

  if (isLoading || !exam) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Edit Exam</h1>
          <button onClick={() => navigate('/admin/exams')} className="px-4 py-2 rounded-md border border-gray-300">Back</button>
        </div>

        {/* Exam Meta */}
        <div className="bg-white rounded-lg border p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Title</label>
              <input defaultValue={exam.title} onBlur={(e) => updateExam.mutate({ title: e.target.value })} className="w-full rounded-md border-gray-300" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tag</label>
              {(() => {
                const current: string = (Array.isArray(exam.tags) && exam.tags[0]) || '';
                const isPreset = current === 'full-mock' || current === 'one-skill';
                const selection: 'full-mock' | 'one-skill' | 'custom' = isPreset ? (current as any) : 'custom';
                const setTagPreset = (tag: 'full-mock' | 'one-skill') => updateExam.mutate({ tags: [tag] });
                const setCustom = (val: string) => updateExam.mutate({ tags: [val] });
                return (
                  <div className="text-sm">
                    <div className="flex items-center gap-3 mb-2">
                      <label className="inline-flex items-center gap-2">
                        <input type="radio" name="tag" value="full-mock" checked={selection==='full-mock'} onChange={(e)=>{ if(e.target.checked) setTagPreset('full-mock'); }} />
                        <span>Full Mock</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input type="radio" name="tag" value="one-skill" checked={selection==='one-skill'} onChange={(e)=>{ if(e.target.checked) setTagPreset('one-skill'); }} />
                        <span>One Skill</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="tag"
                          value="custom"
                          checked={selection==='custom'}
                          onChange={(e)=>{
                            if (!e.target.checked) return;
                            const currentVal = isPreset ? '' : current;
                            const v = window.prompt('Enter custom tag', currentVal || '') || '';
                            const tagVal = v.trim();
                            if (tagVal) setCustom(tagVal);
                          }}
                        />
                        <span>Custom</span>
                      </label>
                    </div>
                    {selection==='custom' && (
                      <input
                        className="w-full rounded-md border-gray-300"
                        placeholder="Enter custom tag (e.g., Peter)"
                        defaultValue={isPreset ? '' : current}
                        onBlur={(e)=> { const v = e.target.value.trim(); if (v) setCustom(v); }}
                      />
                    )}
                  </div>
                );
              })()}
            </div>
            {/* Passing Score removed per policy */}
            <div className="md:col-span-3">
              <label className="block text-sm text-gray-600 mb-1">Description</label>
              <textarea defaultValue={exam.description} onBlur={(e) => updateExam.mutate({ description: e.target.value })} className="w-full rounded-md border-gray-300" rows={3} />
            </div>
          </div>
        </div>

        {/* Add Section (hidden when full-mock) */}
        {!(Array.isArray(exam.tags) && exam.tags.includes('full-mock')) && (
          <div className="bg-white rounded-lg border p-6 mb-6">
            <div className="text-sm font-semibold text-gray-900 mb-3">Add Section</div>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Type</label>
                <select className="rounded-md border-gray-300" value={newSection.sectionType} onChange={(e)=> setNewSection(s => ({ ...s, sectionType: e.target.value }))}>
                  <option value="listening">Listening</option>
                  <option value="reading">Reading</option>
                  <option value="writing">Writing</option>
                  <option value="speaking">Speaking</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-600 mb-1">Title (optional)</label>
                <input className="rounded-md border-gray-300 w-full" value={newSection.title} placeholder="Auto if blank" onChange={(e)=> setNewSection(s => ({ ...s, title: e.target.value }))} />
              </div>
              {/* Removed per-section duration; global exam duration applies */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">Max Score</label>
                <input type="number" step="0.5" className="rounded-md border-gray-300 w-full" value={newSection.maxScore} onChange={(e)=> setNewSection(s => ({ ...s, maxScore: Number(e.target.value)||0 }))} />
              </div>
              <div>
                <button type="button" className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm disabled:opacity-50" disabled={createSection.isPending} onClick={() => {
                  const data = { sectionType: newSection.sectionType, title: newSection.title || newSection.sectionType.charAt(0).toUpperCase()+newSection.sectionType.slice(1), maxScore: newSection.maxScore || 9, sectionOrder: nextSectionOrder() };
                  createSection.mutate(data);
                }}>{createSection.isPending ? 'Adding...' : 'Add Section'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Section Navigator (tabs) for composite exams */}
        {(() => {
          const types: string[] = Array.from(new Set((exam.sections || []).map((s: any) => s.sectionType))) as string[];
          if (types.length <= 1) return null; // single-skill exams don't need tabs
          const prefOrder = ['listening','reading','writing','speaking'];
          const sorted = types.sort((a: string, b: string) => (prefOrder.indexOf(a) - prefOrder.indexOf(b)));
          const counts: Record<string, number> = {};
          (exam.sections || []).forEach((s: any) => { counts[s.sectionType] = (counts[s.sectionType] || 0) + 1; });
          return (
            <div className="bg-white rounded-lg border p-2 mb-6">
              <div className="flex gap-2 flex-wrap">
                {sorted.map((t: string) => (
                  <button
                    key={t as string}
                    type="button"
                    className={`px-3 py-1.5 text-sm rounded border ${activeSectionType === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => setActiveSectionType(t as string)}
                  >
                    {(t as string).charAt(0).toUpperCase() + (t as string).slice(1)}
                    <span className="ml-1 text-[11px] opacity-80">({counts[t as string] || 0})</span>
                  </button>
                ))}
              </div>
              {/* Part tabs for full-mock listening/reading */}
              {FULL_MOCK && ['listening','reading'].includes(activeSectionType) && (
                <div className="mt-4 flex gap-2 flex-wrap border-t pt-3">
                  { (activeSectionType === 'listening' ? LISTENING_PARTS : READING_PARTS).map(p => {
                      const label = activeSectionType === 'listening' ? `Part ${p}` : `Passage ${p}`;
                      return (
                        <button
                          key={`part-${activeSectionType}-${p}`}
                          type="button"
                          className={`px-3 py-1 text-xs rounded border ${ (activePartByType[activeSectionType]||1) === p ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                          onClick={() => setActivePartByType(prev => ({ ...prev, [activeSectionType]: p }))}
                        >
                          {label}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Exam-level Listening Audio (centralized) - show only when Listening tab active and at least one Listening section exists */}
        {(() => {
          const hasListening = (exam.sections || []).some((s: any) => s.sectionType === 'listening');
          if (!hasListening || activeSectionType !== 'listening') return null;
          return (
            <div className="bg-white rounded-lg border p-6 mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Exam Listening Audio (single file for entire exam)</h3>
              <ExamAudioManager exam={exam} apiOrigin={apiOrigin} onUpdate={(payload)=> updateExam.mutate(payload)} />
            </div>
          );
        })()}

        {/* Sections & Questions */}
        {exam.sections?.filter((s: any) => !activeSectionType || s.sectionType === activeSectionType).map((section: any) => {
          // Part filtering: only apply to listening/reading in full-mock; questions carry metadata listeningPart/readingPart.
          const activePart = activePartByType[section.sectionType];
          const partKey = section.sectionType === 'listening' ? 'listeningPart' : (section.sectionType === 'reading' ? 'readingPart' : null);
          const filterByPart = FULL_MOCK && partKey && activePart;
          const originalQuestions = section.questions || [];
          const questions = filterByPart ? originalQuestions.filter((q:any)=> (q.metadata?.[partKey] || 1) === activePart) : originalQuestions;
          const sectionWithFiltered = { ...section, questions };
          return (
          <div key={section.id} className="bg-white rounded-lg border p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-600 mb-1">Section Title</label>
                <input defaultValue={section.title} onBlur={(e) => updateSection.mutate({ sectionId: section.id, data: { title: e.target.value } })} className="w-full rounded-md border-gray-300" />
              </div>
              {/* Duration field removed */}
              <div>
                <label className="block text-sm text-gray-600 mb-1">Max Score</label>
                <input type="number" step="0.5" defaultValue={section.maxScore} onBlur={(e) => updateSection.mutate({ sectionId: section.id, data: { maxScore: Number(e.target.value) } })} className="w-full rounded-md border-gray-300" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Order</label>
                <input type="number" defaultValue={section.sectionOrder} onBlur={(e) => updateSection.mutate({ sectionId: section.id, data: { sectionOrder: Number(e.target.value) } })} className="w-full rounded-md border-gray-300" />
              </div>
              <div className="flex items-end">
                <button type="button" disabled={Array.isArray(exam.tags) && exam.tags.includes('full-mock')} className={`mt-5 px-3 py-1.5 text-xs rounded-md border ${Array.isArray(exam.tags) && exam.tags.includes('full-mock') ? 'border-gray-200 text-gray-400 cursor-not-allowed' : 'border-red-300 text-red-600 hover:bg-red-50'}`} onClick={() => openConfirm({ title: 'Delete Section', tone: 'danger', description: <>Delete section <strong>{section.title}</strong> and all its questions?</>, confirmText: 'Delete', onConfirm: () => deleteSection.mutate({ sectionId: section.id }) })}>Delete Section</button>
              </div>
              {/* Per-section listening audio UI removed; centralized at exam level */}
              {section.sectionType === 'reading' && (
                <div className="md:col-span-5">
                  <label className="block text-sm text-gray-600 mb-1">Passage Text</label>
                  <textarea defaultValue={section.passageText || ''} onBlur={(e) => updateSection.mutate({ sectionId: section.id, data: { passageText: e.target.value } })} className="w-full rounded-md border-gray-300" rows={4} />
                </div>
              )}
            </div>

            {/* Writing Section: Two-part essay editors (Task 1 and Task 2). Hide normal range UI. */}
            {section.sectionType === 'writing' && (
              <div className="mb-6 border rounded bg-gray-50 p-4">
                <div className="text-sm font-medium text-gray-700 mb-3">Writing Tasks</div>
                {(() => {
                  const qs = section.questions || [];
                  const task1 = qs.find((q:any) => q.questionType === 'writing_task1');
                  const task2 = qs.find((q:any) => q.questionType === 'essay');
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border rounded bg-white p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium text-gray-800">Task 1</div>
                          {!task1 && (
                            <button type="button" className="px-2 py-1 text-xs rounded border border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'writing_task1', questionText: 'Writing Task 1', metadata: withPartMeta(section, { variant: 'academic_report', minWords: 150, maxWords: 220, guidance: '' }) })}>Create Task 1</button>
                          )}
                        </div>
                        {task1 && (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-3 items-end">
                              <label className="text-xs text-gray-700 flex flex-col gap-1">
                                Variant
                                <select defaultValue={task1.metadata?.variant || 'academic_report'} onChange={e=> updateQuestion.mutate({ questionId: task1.id, data: { metadata: { ...(task1.metadata||{}), variant: e.target.value } } })} className="rounded border-gray-300">
                                  <option value="academic_report">Academic Report</option>
                                  <option value="gt_letter">GT Letter</option>
                                </select>
                              </label>
                              <label className="text-xs text-gray-700 flex flex-col gap-1">
                                Min Words
                                <input type="number" defaultValue={task1.metadata?.minWords || 150} onBlur={e=> updateQuestion.mutate({ questionId: task1.id, data: { metadata: { ...(task1.metadata||{}), minWords: Number(e.target.value)||150 } } })} className="rounded border-gray-300 px-2 py-1 w-24" />
                              </label>
                              <label className="text-xs text-gray-700 flex flex-col gap-1">
                                Max Words
                                <input type="number" defaultValue={task1.metadata?.maxWords || 220} onBlur={e=> updateQuestion.mutate({ questionId: task1.id, data: { metadata: { ...(task1.metadata||{}), maxWords: Number(e.target.value)||220 } } })} className="rounded border-gray-300 px-2 py-1 w-24" />
                              </label>
                            </div>
                            <textarea defaultValue={task1.metadata?.guidance || ''} placeholder="Instructions / prompt" onBlur={e=> updateQuestion.mutate({ questionId: task1.id, data: { metadata: { ...(task1.metadata||{}), guidance: e.target.value } } })} className="w-full rounded border border-gray-300 text-sm p-2" rows={4} />
                            <div className="flex flex-col gap-2">
                              <label className="text-xs text-gray-700">Image URL (optional)</label>
                              <input defaultValue={task1.imageUrl || ''} placeholder="/uploads/images/abc.png or https://..." onBlur={(e)=> updateQuestion.mutate({ questionId: task1.id, data: { imageUrl: e.target.value } })} className="rounded border-gray-300 px-2 py-1" />
                              <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" onChange={async (e)=> { const file = e.target.files?.[0]; if (!file) return; try { const res = await apiService.upload<{ imageUrl: string; absoluteUrl: string }>(`/admin/questions/${task1.id}/image`, file); const payload: any = (res?.data as any) || res; const imageUrl = payload?.imageUrl || payload?.data?.imageUrl || ''; updateQuestion.mutate({ questionId: task1.id, data: { imageUrl } }); toast.success('Image uploaded'); } catch { toast.error('Upload failed'); } }} className="rounded border-gray-300 px-2 py-1 w-full" />
                              {task1.imageUrl && (
                                <img src={task1.imageUrl.startsWith('http') ? task1.imageUrl : `${apiOrigin}${task1.imageUrl}`} alt="Task 1" className="max-h-32 rounded border" />
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="border rounded bg-white p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium text-gray-800">Task 2</div>
                          {!task2 && (
                            <button type="button" className="px-2 py-1 text-xs rounded border border-green-300 text-green-700 hover:bg-green-50" onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'essay', questionText: 'Writing Task 2', metadata: withPartMeta(section, { writingPart: 2, guidance: '' }) })}>Create Task 2</button>
                          )}
                        </div>
                        {task2 && (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-3 items-end">
                              <label className="text-xs text-gray-700 flex flex-col gap-1">
                                Writing Part
                                <select defaultValue={String(task2.metadata?.writingPart || 2)} onChange={e=> updateQuestion.mutate({ questionId: task2.id, data: { metadata: { ...(task2.metadata||{}), writingPart: Number(e.target.value) } } })} className="rounded border-gray-300">
                                  <option value="1">Task 1</option>
                                  <option value="2">Task 2</option>
                                </select>
                              </label>
                            </div>
                            <textarea defaultValue={task2.metadata?.guidance || ''} placeholder="Instructions / prompt" onBlur={e=> updateQuestion.mutate({ questionId: task2.id, data: { metadata: { ...(task2.metadata||{}), guidance: e.target.value } } })} className="w-full rounded border border-gray-300 text-sm p-2" rows={6} />
                            <div className="flex flex-col gap-2">
                              <label className="text-xs text-gray-700">Image URL (optional)</label>
                              <input defaultValue={task2.imageUrl || ''} placeholder="/uploads/images/abc.png or https://..." onBlur={(e)=> updateQuestion.mutate({ questionId: task2.id, data: { imageUrl: e.target.value } })} className="rounded border-gray-300 px-2 py-1" />
                              <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" onChange={async (e)=> { const file = e.target.files?.[0]; if (!file) return; try { const res = await apiService.upload<{ imageUrl: string; absoluteUrl: string }>(`/admin/questions/${task2.id}/image`, file); const payload: any = (res?.data as any) || res; const imageUrl = payload?.imageUrl || payload?.data?.imageUrl || ''; updateQuestion.mutate({ questionId: task2.id, data: { imageUrl } }); toast.success('Image uploaded'); } catch { toast.error('Upload failed'); } }} className="rounded border-gray-300 px-2 py-1 w-full" />
                              {task2.imageUrl && (
                                <img src={task2.imageUrl.startsWith('http') ? task2.imageUrl : `${apiOrigin}${task2.imageUrl}`} alt="Task 2" className="max-h-32 rounded border" />
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Simplified Table Editor */}
            {section.sectionType === 'listening' && (
              <div className="mb-6 border rounded bg-gray-50 p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <span className="text-sm font-medium text-gray-700">Simplified Tables</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      className="px-2 py-1 text-xs rounded border border-green-300 text-green-700 hover:bg-green-50"
                      title="Create a simple table with embedded questions"
                      onClick={() => createQuestion.mutate({ 
                        sectionId: section.id, 
                        questionType: 'simple_table', 
                        questionText: 'Table Instructions', 
                        metadata: withPartMeta(section, { 
                          simpleTable: { 
                            rows: [
                              [
                                { type: 'text', content: 'Name' },
                                { type: 'question', content: '', questionType: 'fill_blank', points: 1 }
                              ]
                            ]
                          } 
                        }) 
                      })}
                    >+ Simple Table</button>
                  </div>
                </div>
                {(() => {
                  const simpleTableQuestions = (sectionWithFiltered.questions || []).filter((q:any)=> q.questionType === 'simple_table');
                  return simpleTableQuestions.map((tq:any)=> (
                    <SimpleTableEditor key={tq.id} question={tq} updateQuestion={updateQuestion} deleteQuestion={deleteQuestion} />
                  ));
                })()}
                {(() => { 
                  const count = (sectionWithFiltered.questions || []).filter((q:any)=> q.questionType==='simple_table').length; 
                  return count===0 ? (
                    <div className="text-[11px] text-gray-500 italic">No simplified tables yet.</div>
                  ) : null; 
                })()}
                
                <div className="mt-4 text-[10px] text-gray-500 space-y-1">
                  <div><strong>Simple Tables:</strong> Embed questions directly in table cells. No complex placeholder linking needed.</div>
                  <div><strong>Text cells:</strong> Static content for headers, labels, instructions.</div>
                  <div><strong>Question cells:</strong> Interactive fields that students can answer directly in the table.</div>
                  <div><strong>Auto #:</strong> Assigns sequential question numbers to each question cell (row-major). These numbers appear inside blanks for students. Clearing numbers will remove them from all cells.</div>
                </div>
              </div>
            )}

            {/* Quick bulk question creator for this section (hidden for Writing sections) */}
            {section.sectionType !== 'writing' && (
            <div className="mb-6 border rounded bg-gray-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-700">Add Question Range</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                {(() => { const rd = rangeDrafts[section.id] || { questionType: 'multiple_choice', start: '', end: '', points: '1', fillMissing: false }; return (
                  <>
                    <div className="md:col-span-3">
                      <label className="block text-xs text-gray-600 mb-1">Type</label>
                      <select className="rounded-md border-gray-300 w-full" value={rd.questionType} onChange={e=> setRangeDraft(section.id, { questionType: e.target.value })}>
                        <option value="multiple_choice">Multiple Choice</option>
                        <option value="true_false">True/False/NG</option>
                        <option value="fill_blank">Fill Blank</option>
                        <option value="drag_drop">Drag & Drop</option>
                        <option value="matching">Heading Matching</option>
                        <option value="essay">Essay</option>
                        <option value="speaking_task">Speaking</option>
                        <option value="simple_table">Simple Table</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Start #</label>
                      <input className="rounded-md border-gray-300 w-full" value={rd.start} onChange={e=> setRangeDraft(section.id, { start: e.target.value.replace(/[^0-9]/g,'') })} placeholder="1" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">End #</label>
                      <input className="rounded-md border-gray-300 w-full" value={rd.end} onChange={e=> setRangeDraft(section.id, { end: e.target.value.replace(/[^0-9]/g,'') })} placeholder="5" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Points</label>
                      <input className="rounded-md border-gray-300 w-full" value={rd.points} onChange={e=> setRangeDraft(section.id, { points: e.target.value.replace(/[^0-9.]/g,'') })} placeholder="1" />
                    </div>
                    <div className="md:col-span-3 flex items-end gap-3 flex-wrap">
                      <button type="button" className="px-3 py-2 text-xs rounded-md bg-blue-600 text-white disabled:opacity-50" disabled={bulkCreateQuestions.isPending} onClick={() => {
                        const start = Number(rd.start)||0; const end = Number(rd.end)||0; const points = Number(rd.points)||1;
                        if (!start || !end || end < start) { toast.error('Invalid range'); return; }
                        // Include part metadata for listening/reading when full-mock so created questions attach to current part/passsage
                        let meta: any = undefined;
                        if (FULL_MOCK && ['listening','reading'].includes(section.sectionType)) {
                          const partKey = section.sectionType === 'listening' ? 'listeningPart' : 'readingPart';
                          const activePart = activePartByType[section.sectionType] || 1;
                          meta = { [partKey]: activePart };
                        }
                        bulkCreateQuestions.mutate({ sectionId: section.id, groups: [{ questionType: rd.questionType, start, end, points, fillMissing: rd.fillMissing, metadata: meta }] });
                      }}>{bulkCreateQuestions.isPending ? 'Adding...' : 'Add Range'}</button>
                      <button type="button" className="px-3 py-2 text-xs rounded-md border" onClick={() => setRangeDraft(section.id, { start: '', end: '' })}>Reset</button>
                      <label className="flex items-center gap-1 text-xs text-gray-600">
                        <input type="checkbox" className="rounded border-gray-300" checked={!!rd.fillMissing} onChange={(e)=> setRangeDraft(section.id, { fillMissing: e.target.checked })} />
                        Skip existing
                      </label>
                    </div>
                  </>
                ); })()}
              </div>
              <div className="text-[11px] text-gray-500 mt-2">For drag & drop, Q start becomes group anchor; subsequent numbers become group items.</div>
            </div>
            )}

            {/* Image Labeling (map/plan/diagram) */}
            <div className="mb-6 border rounded bg-gray-50 p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <span className="text-sm font-medium text-gray-700">Image Labeling (per-question anchors)</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
                    onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'image_labeling', questionText: 'Label the indicated position', metadata: withPartMeta(section, { anchor: { x: 0.5, y: 0.5 } }) })}
                  >+ Add Image Label</button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-green-300 text-green-700 hover:bg-green-50"
                    onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'image_dnd', questionText: 'Drag the correct label to its position', metadata: withPartMeta(section, { anchors: [{ id: 'A', x: 0.5, y: 0.5 }], tokens: ['A'], correctMap: { A: 'A' } }) })}
                  >+ Add Image Drag/Drop</button>
                </div>
              </div>
              {(() => {
                const imageQs = (sectionWithFiltered.questions || []).filter((q:any)=> q.questionType === 'image_labeling' || q.questionType === 'image_dnd').sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0));
                if (imageQs.length === 0) return <div className="text-[11px] text-gray-500 italic">No image labeling questions yet.</div>;
                const sharedUrl = imageQs[0]?.imageUrl || '';
                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                      <label className="text-xs text-gray-700 flex flex-col gap-1 md:col-span-3">
                        Shared Image URL
                        <input defaultValue={sharedUrl} placeholder="/uploads/images/plan.png or https://..." onBlur={(e)=> {
                          const url = e.target.value;
                          imageQs.forEach((q:any)=> updateQuestion.mutate({ questionId: q.id, data: { imageUrl: url } }));
                        }} className="rounded border-gray-300 px-2 py-1" />
                      </label>
                      <label className="text-xs text-gray-700 flex flex-col gap-1 md:col-span-2">
                        Upload Shared Image
                        <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={async (e)=> {
                          const file = e.target.files?.[0]; if (!file) return;
                          try {
                            const targetId = imageQs[0].id;
                            const res = await apiService.upload<{ imageUrl: string; absoluteUrl: string }>(`/admin/questions/${targetId}/image`, file);
                            const payload: any = (res?.data as any) || res; const imageUrl = payload?.imageUrl || payload?.data?.imageUrl || '';
                            imageQs.forEach((q:any)=> updateQuestion.mutate({ questionId: q.id, data: { imageUrl } }));
                            toast.success('Image uploaded');
                          } catch { toast.error('Upload failed'); }
                        }} className="rounded border-gray-300 px-2 py-1" />
                      </label>
                    </div>
                    {sharedUrl && (
                      <div className="relative inline-block border rounded overflow-hidden">
                        <img src={sharedUrl.startsWith('http') ? sharedUrl : `${apiOrigin}${sharedUrl}`} alt="Labeling" className="max-h-72" id={`img-prev-${section.id}`} />
                        {/* Anchor previews */}
                        {imageQs.map((q:any)=>{
                          const ax = q.questionType==='image_labeling' ? (q.metadata?.anchor?.x ?? 0.5) : ((q.metadata?.anchors?.[0]?.x) ?? 0.5);
                          const ay = q.questionType==='image_labeling' ? (q.metadata?.anchor?.y ?? 0.5) : ((q.metadata?.anchors?.[0]?.y) ?? 0.5);
                          return (
                            <button key={`dot-${q.id}`} title={`Set anchor for Q${q.questionNumber||''}`}
                              className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-700 bg-blue-500/80 cursor-crosshair"
                              style={{ left: `${ax*100}%`, top: `${ay*100}%` }}
                              onClick={() => {
                                // Open modal overlay to pick coordinates visually
                                const backdrop = document.createElement('div');
                                backdrop.style.position='fixed';backdrop.style.inset='0';backdrop.style.background='rgba(30,30,30,0.6)';backdrop.style.zIndex='9999';
                                const frame = document.createElement('div');
                                frame.style.position='absolute';frame.style.top='50%';frame.style.left='50%';frame.style.transform='translate(-50%,-50%)';frame.style.background='#fff';frame.style.padding='8px';frame.style.borderRadius='8px';frame.style.boxShadow='0 10px 30px rgba(0,0,0,.3)';
                                const img = document.createElement('img');
                                img.src = sharedUrl.startsWith('http') ? sharedUrl : `${apiOrigin}${sharedUrl}`;
                                img.style.maxHeight='70vh';img.style.maxWidth='80vw';img.style.display='block';
                                img.style.cursor='crosshair';
                                const hint = document.createElement('div');
                                hint.textContent = 'Click on the image to set anchor. Press Esc or click outside to cancel.';
                                hint.style.fontSize='12px';hint.style.margin='6px 0 4px';hint.style.color='#334155';
                                frame.appendChild(img);frame.appendChild(hint);backdrop.appendChild(frame);document.body.appendChild(backdrop);
                                const done = (x:number,y:number)=>{ 
                                  let meta:any = { ...(q.metadata||{}) };
                                  if (q.questionType==='image_labeling') meta.anchor = { x, y }; else {
                                    const first = (meta.anchors && meta.anchors[0]) || { id: 'A' };
                                    meta.anchors = [{ ...first, x, y }];
                                    if (!meta.tokens) meta.tokens = [first.id];
                                    if (!meta.correctMap) meta.correctMap = { [first.id]: first.id };
                                  }
                                  updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } }); 
                                  toast.success(`Anchor set for Q${q.questionNumber||''}`); document.body.removeChild(backdrop); };
                                const clickHandler=(ev:MouseEvent)=>{ const rect = img.getBoundingClientRect(); const x = Math.min(1, Math.max(0, (ev.clientX - rect.left)/rect.width)); const y = Math.min(1, Math.max(0, (ev.clientY - rect.top)/rect.height)); done(x,y); };
                                const keyHandler=(ev:KeyboardEvent)=>{ if(ev.key==='Escape'){ document.body.removeChild(backdrop);} };
                                backdrop.addEventListener('click',(ev)=>{ if(ev.target===backdrop){ document.body.removeChild(backdrop);} });
                                img.addEventListener('click', clickHandler, { once:true });
                                window.addEventListener('keydown', keyHandler, { once:true });
                              }}
                            />
                          );
                        })}
                      </div>
                    )}
                    <div className="space-y-2">
                      {imageQs.map((q:any, idx:number)=> (
                        <div key={q.id} className="p-2 rounded border bg-white flex flex-wrap gap-2 items-center">
                          <div className="text-[11px] text-gray-500 w-12">Q{q.questionNumber||idx+1}</div>
                          <input defaultValue={q.questionText||''} onBlur={(e)=> updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } })} className="flex-1 rounded border-gray-300 text-sm px-2 py-1" placeholder="Question text" />
                          <label className="text-xs text-gray-700 flex items-center gap-1">
                            X
                            <input type="number" step="0.01" min={0} max={1} defaultValue={(q.questionType==='image_labeling'? q.metadata?.anchor?.x : q.metadata?.anchors?.[0]?.x) ?? 0.5} onBlur={(e)=>{ const x = Math.min(1, Math.max(0, Number(e.target.value)||0)); let meta:any = { ...(q.metadata||{}) }; if (q.questionType==='image_labeling') { meta.anchor = { x, y: meta.anchor?.y ?? 0.5 }; } else { const first = (meta.anchors && meta.anchors[0]) || { id: 'A', y: 0.5 }; meta.anchors = [{ ...first, x }]; } updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } }); }} className="w-20 rounded border-gray-300 px-2 py-1" />
                          </label>
                          <label className="text-xs text-gray-700 flex items-center gap-1">
                            Y
                            <input type="number" step="0.01" min={0} max={1} defaultValue={(q.questionType==='image_labeling'? q.metadata?.anchor?.y : q.metadata?.anchors?.[0]?.y) ?? 0.5} onBlur={(e)=>{ const y = Math.min(1, Math.max(0, Number(e.target.value)||0)); let meta:any = { ...(q.metadata||{}) }; if (q.questionType==='image_labeling') { meta.anchor = { x: meta.anchor?.x ?? 0.5, y }; } else { const first = (meta.anchors && meta.anchors[0]) || { id: 'A', x: 0.5 }; meta.anchors = [{ ...first, y }]; } updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } }); }} className="w-20 rounded border-gray-300 px-2 py-1" />
                          </label>
                          {q.questionType==='image_labeling' ? (
                            <input defaultValue={q.correctAnswer||''} onBlur={(e)=> updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: e.target.value } })} className="rounded border-gray-300 text-sm px-2 py-1" placeholder="Correct answer" />
                          ) : (
                            <div className="flex items-center gap-2 text-xs">
                              <label className="flex items-center gap-1">Token
                                <input defaultValue={q.metadata?.anchors?.[0]?.id || 'A'} onBlur={(e)=>{ let meta:any = { ...(q.metadata||{}) }; const first = (meta.anchors && meta.anchors[0]) || { x: 0.5, y: 0.5 }; const id = e.target.value || 'A'; meta.anchors = [{ ...first, id }]; meta.tokens = [id]; meta.correctMap = { [id]: id }; updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } }); }} className="w-20 rounded border-gray-300 px-2 py-1" />
                              </label>
                            </div>
                          )}
                          <button className="px-2 py-1 text-xs border rounded text-red-600 border-red-300" onClick={()=> deleteQuestion.mutate({ questionId: q.id })}>Delete</button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div className="mt-2 text-[11px] text-gray-500">Tip: Click any dot, then click on the image to position the anchor precisely. X/Y are relative (0–1).</div>
            </div>

            {/* Import Headings for matching */}
            {/* Headings import hidden to reduce complexity; manage in create flow */}

            {/* Dynamic grouped blocks sorted by lowest question number per type */}
            {(() => {
              const qs = sectionWithFiltered.questions || [];
              const types: string[] = Array.from(new Set(qs.map((q: any) => q.questionType))) as string[];
              const getNum = (q: any) => q.questionNumber || q.order || 999999;
              const typeMeta = types
                .filter((t: string) => ['matching','multiple_choice','multi_select','true_false','fill_blank','drag_drop'].includes(t))
                .map(t => ({ type: t, min: Math.min(...qs.filter((q: any) => q.questionType === t).map(getNum)) }))
                .sort((a,b) => a.min - b.min);
              return typeMeta.map(tm => {
                if (tm.type === 'matching') {
                  return (
                    <div key={`block-${tm.type}`} className="mb-4 border rounded">
                      <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium text-gray-700">Headings & Matching</div>
                      <div className="p-3">
                        <div className="mb-3">
                          <textarea
                            placeholder="Group instruction (shown once to students)"
                            defaultValue={(() => { const q0 = section.questions.find((q: any)=>q.questionType==='matching'); return q0?.metadata?.groupInstruction || ''; })()}
                            onBlur={(e) => {
                              const val = e.target.value;
                              section.questions.filter((q: any)=>q.questionType==='matching').forEach((q: any) => {
                                const meta = { ...(q.metadata || {}), groupInstruction: val };
                                updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } });
                              });
                            }}
                            className="w-full rounded border border-gray-300 text-xs p-2"
                            rows={2}
                          />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mb-3">
                          <button className="px-3 py-2 text-sm border rounded" onClick={() => {
                            const letters = ['A','B','C','D','E','F','G'];
                            const options = letters.map(l => ({ letter: l, text: '' }));
                            updateSection.mutate({ sectionId: section.id, data: { headingBank: { options } } });
                          }}>Seed A–G</button>
                          <button className="px-3 py-2 text-sm border rounded" onClick={() => {
                            const romans = ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi'];
                            const options = romans.map(l => ({ letter: l, text: '' }));
                            updateSection.mutate({ sectionId: section.id, data: { headingBank: { options } } });
                          }}>Seed i–xi</button>
                          <button className="px-3 py-2 text-sm border rounded" onClick={() => {
                            const options = [ ...(section.headingBank?.options || []), { letter: '', text: '' } ];
                            updateSection.mutate({ sectionId: section.id, data: { headingBank: { options } } });
                          }}>Add Heading</button>
                          <button className="px-3 py-2 text-sm border rounded bg-blue-50 border-blue-300 text-blue-700" onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'matching', metadata: withPartMeta(section) })}>+ Add Paragraph</button>
                          <button className="px-3 py-2 text-sm border rounded bg-green-50 border-green-300 text-green-700" onClick={async () => {
                            const passage = section.passageText || '';
                            // Detect explicit markers first: [[P1]] [[paragraph2]] etc.
                            const markerRegex = /\[\[(?:p|paragraph)\s*(\d+)\]\]/gi;
                            const markers: { index: number; start: number; end: number; token: string }[] = [];
                            let m: RegExpExecArray | null;
                            while ((m = markerRegex.exec(passage)) !== null) {
                              markers.push({ index: Number(m[1]), start: m.index, end: m.index + m[0].length, token: m[0] });
                            }
                            let paras: { idx: number; text: string }[] = [];
                            if (markers.length) {
                              for (let i = 0; i < markers.length; i++) {
                                const cur = markers[i];
                                const next = markers[i + 1];
                                const seg = passage.slice(cur.end, next ? next.start : undefined).trim();
                                paras.push({ idx: cur.index, text: seg });
                              }
                              // Sort by idx (explicit numbers may be out-of-order in text)
                              paras.sort((a,b)=>a.idx - b.idx);
                            } else {
                              const split = passage.split(/\n\s*\n+/).map((p:string)=>p.trim()).filter((p:string)=>p.length>0);
                              paras = split.map((t:string,i:number)=>({ idx: i+1, text: t }));
                            }
                            if (!paras.length) { toast.info('No paragraphs detected (markers or blank lines).'); return; }
                            const existing = section.questions.filter((q:any)=>q.questionType==='matching');
                            const toCreate = paras.filter(p => !existing.find((q:any)=>q.metadata?.paragraphIndex === p.idx));
                            if (!toCreate.length) { toast.info('All detected paragraphs already have questions.'); return; }
                            if (toCreate.length > 10 && !window.confirm(`Create ${toCreate.length} paragraph questions?`)) return;
                            for (const p of toCreate) {
                              const snippet = p.text.slice(0, 110).replace(/\s+/g,' ').trim();
                              await createQuestion.mutateAsync({ sectionId: section.id, questionType: 'matching', metadata: withPartMeta(section, { paragraphIndex: p.idx }), questionText: snippet ? `Paragraph ${p.idx}: ${snippet}` : `Paragraph ${p.idx}` });
                            }
                          }}>Generate from Passage</button>
                        </div>
                        <div className="space-y-2 mb-3">
                          {(section.headingBank?.options || []).map((opt: any, idx: number) => (
                            <div key={`row-${idx}`} className="grid grid-cols-12 gap-2 items-center">
                              <input className="col-span-2 rounded-md border-gray-300 px-2 py-1 text-sm" defaultValue={opt.letter || ''} placeholder="Letter" onBlur={(e) => {
                                const options = [ ...(section.headingBank?.options || []) ]; options[idx] = { ...options[idx], letter: e.target.value }; updateSection.mutate({ sectionId: section.id, data: { headingBank: { options } } });
                              }} />
                              <input className="col-span-9 rounded-md border-gray-300 px-2 py-1 text-sm" defaultValue={opt.text || ''} placeholder={`Heading ${idx + 1}`} onBlur={(e) => {
                                const options = [ ...(section.headingBank?.options || []) ]; options[idx] = { ...options[idx], text: e.target.value }; updateSection.mutate({ sectionId: section.id, data: { headingBank: { options } } });
                              }} />
                              <button className="col-span-1 px-2 py-1 text-sm text-red-600 border border-red-200 rounded" onClick={() => {
                                const options = (section.headingBank?.options || []).filter((_: any, i: number) => i !== idx); updateSection.mutate({ sectionId: section.id, data: { headingBank: { options } } });
                              }}>Delete</button>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3">
                          <div className="md:col-span-3">
                            <div className="text-xs text-gray-600 mb-1">Headings</div>
                            <div className="flex flex-wrap gap-2">
                              {((section.headingBank?.options) || (section.questions.find((qq: any) => qq.questionType === 'matching')?.options || [])).map((opt: any, i: number) => (
                                <button
                                  key={`hchip2-${i}`}
                                  draggable
                                  onDragStart={(e) => { const letter = opt.letter || opt.option_letter || ''; e.dataTransfer.setData('text/letter', letter); setDraggingLetter(letter); }}
                                  onDragEnd={() => setDraggingLetter(null)}
                                  onClick={() => setPendingHeading((opt.letter || opt.option_letter || '') || null)}
                                  className={`px-2.5 py-1 rounded border text-sm ${pendingHeading === (opt.letter || opt.option_letter) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'}`}
                                >{opt.letter || opt.option_letter || ''}</button>
                              ))}
                            </div>
                          </div>
                          <div className="md:col-span-9 space-y-2">
                            {sectionWithFiltered.questions.filter((q: any) => q.questionType === 'matching').sort((a: any,b: any) => getNum(a)-getNum(b)).map((q: any, idx: number) => (
                              <div
                                key={`dnd-${q.id}`}
                                className={`flex items-center gap-3 p-2 rounded border transition-colors ${dragOverQuestionId === q.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}
                                onDragOver={(e) => e.preventDefault()}
                                onDragEnter={() => setDragOverQuestionId(q.id)}
                                onDragLeave={() => setDragOverQuestionId((prev) => (prev === q.id ? null : prev))}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  const letter = e.dataTransfer.getData('text/letter') || draggingLetter;
                                  if (letter) updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: letter } });
                                  setDraggingLetter(null);
                                  setDragOverQuestionId(null);
                                }}
                              >
                                <div className="w-12 text-[11px] text-gray-500 flex flex-col items-start">
                                  <span>Q{q.questionNumber || q.order || idx + 1}</span>
                                  {q.metadata?.paragraphIndex && <span className="text-green-600">P{q.metadata.paragraphIndex}</span>}
                                </div>
                                <input
                                  defaultValue={q.questionText || ''}
                                  placeholder={`Question text for paragraph ${q.questionNumber || q.order || idx + 1}`}
                                  onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } })}
                                  className="flex-1 rounded-md border-gray-300 text-sm"
                                />
                                <div className="flex items-center gap-2">
                                  <div className="w-16 text-center px-2 py-1 rounded border bg-white">{q.correctAnswer || '-'}</div>
                                  <button className="px-2 py-1 text-xs border rounded" onClick={() => updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: '' } })}>Clear</button>
                                  <button className="px-2 py-1 text-xs border rounded text-red-600 border-red-300" onClick={() => { if (window.confirm('Delete this paragraph question?')) deleteQuestion.mutate({ questionId: q.id }); }}>Delete</button>
                                  <button className="px-2 py-1 text-xs border rounded text-gray-600" title="Set paragraph index" onClick={() => {
                                    const val = window.prompt('Paragraph index (1-based):', q.metadata?.paragraphIndex || '');
                                    if (val) {
                                      const num = Number(val);
                                      if (!isNaN(num) && num>0) {
                                        const meta = { ...(q.metadata||{}), paragraphIndex: num };
                                        updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } });
                                      }
                                    }
                                  }}>Set P#</button>
                                </div>
                              </div>
                            ))}
                            {sectionWithFiltered.questions.filter((q: any)=>q.questionType==='matching').length === 0 && (
                              <div className="text-xs text-gray-500 italic">No paragraph questions yet. Click "+ Add Paragraph" to create them manually.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                if (tm.type === 'multiple_choice') {
                  const sharedBlocks = computeSharedMcqBlocks(sectionWithFiltered);
                  const questionBlockMap = new Map<string, SharedMcqBlock>();
                  sharedBlocks.forEach((block) => {
                    block.questions.forEach((q: any) => {
                      questionBlockMap.set(q.id, block);
                    });
                  });
                  const baseSharedQuestion = sharedBlocks[0]?.questions?.[0] || section.questions.find((q: any) => q.questionType === 'multiple_choice');
                  const sharedLettersByBlock = new Map<string, string[]>();
                  const sharedTextByBlock = new Map<string, Map<string, string>>();
                  sharedBlocks.forEach((block) => {
                    const key = makeBlockKey(section.id, block);
                    const letters = resolveSharedLetters(section, block);
                    sharedLettersByBlock.set(key, letters);
                    const textMap = new Map<string, string>();
                    block.questions.forEach((q: any) => {
                      (q.options || []).forEach((o: any) => {
                        const letter = (o.option_letter || o.letter) as string;
                        if (letter && !textMap.has(letter)) {
                          textMap.set(letter, o.option_text || o.text || '');
                        }
                      });
                    });
                    sharedTextByBlock.set(key, textMap);
                  });
                  return (
                    <div key={`block-${tm.type}`} className="mb-4 border rounded">
                      <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium text-gray-700 flex items-center justify-between">
                        <span>Multiple Choice</span>
                        <div className="flex items-center gap-4">
                          <button
                            type="button"
                            className="text-xs px-2 py-1 border rounded border-gray-300 text-gray-600 hover:bg-gray-100"
                            onClick={() => setHideSharedOptions(prev => ({ ...prev, [section.id]: !prev[section.id] }))}
                          >{hideSharedOptions[section.id] ? 'Show shared options' : 'Hide shared options'}</button>
                          <label className="flex items-center gap-2 text-xs text-gray-600">
                            <input type="checkbox" className="rounded border-gray-300" checked={!!showAdvanced[section.id]} onChange={(e) => setShowAdvanced(prev => ({ ...prev, [section.id]: e.target.checked }))} />
                            Show advanced list
                          </label>
                          {/* Global dropdown seeding removed; now per-question/group controls */}
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="mb-2 flex flex-wrap gap-4 items-center text-xs">
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300"
                              defaultChecked={(() => { const q0 = section.questions.find((q:any)=>q.questionType==='multiple_choice'); return !!(q0?.metadata?.allowMultiSelect); })()}
                              onChange={(e) => {
                                const allow = e.target.checked;
                                section.questions.filter((q:any)=>q.questionType==='multiple_choice').forEach((q:any) => {
                                  const meta = { ...(q.metadata||{}), allowMultiSelect: allow };
                                  if (!allow) { delete meta.allowMultiSelect; delete meta.selectCount; }
                                  updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } });
                                });
                              }}
                            />
                            Enable multi-select for this block
                          </label>
                          {/* Removed block-wide dropdown toggle */}
                          {(() => { const q0 = section.questions.find((q:any)=>q.questionType==='multiple_choice'); const allow = q0?.metadata?.allowMultiSelect; return allow ? (
                            <label className="flex items-center gap-1">
                              Select count:
                              <input type="number" min={2} max={5} defaultValue={q0?.metadata?.selectCount || 2} className="w-16 rounded border-gray-300"
                                onBlur={(e) => {
                                  const count = Math.max(2, Math.min(5, Number(e.target.value)||2));
                                  section.questions.filter((q:any)=>q.questionType==='multiple_choice').forEach((q:any) => {
                                    const meta = { ...(q.metadata||{}), allowMultiSelect: true, selectCount: count };
                                    updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } });
                                  });
                                }} />
                            </label>
                          ) : null; })()}
                        </div>
                        <div className="mb-3">
                          <textarea
                            placeholder="Group instruction (shown once to students)"
                            defaultValue={(() => { const q0 = section.questions.find((q: any)=>q.questionType==='multiple_choice'); return q0?.metadata?.groupInstruction || ''; })()}
                            onBlur={(e) => {
                              const val = e.target.value;
                              section.questions.filter((q: any)=>q.questionType==='multiple_choice').forEach((q: any) => {
                                const meta = { ...(q.metadata || {}), groupInstruction: val };
                                updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } });
                              });
                            }}
                            className="w-full rounded border border-gray-300 text-xs p-2"
                            rows={2}
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
                          {!hideSharedOptions[section.id] && (
                          <div className="md:col-span-4">
                            <div className="text-xs text-gray-600 mb-1">Shared options</div>
                            <div className="space-y-3">
                              {sharedBlocks.length === 0 ? (
                                <div className="text-[11px] text-gray-500 bg-gray-100 border border-dashed border-gray-300 rounded px-2 py-1.5">
                                  No questions are currently using shared options. Switch a question back to <strong>Shared opts</strong> to manage shared banks here.
                                </div>
                              ) : (
                                sharedBlocks.map((block) => {
                                  const key = makeBlockKey(section.id, block);
                                  const letters = sharedLettersByBlock.get(key) || [];
                                  const sharedTextMap = sharedTextByBlock.get(key) || new Map<string, string>();
                                  const displayStart = block.start || questionNumberOf(block.questions[0]) || 0;
                                  const displayEnd = block.end || questionNumberOf(block.questions[block.questions.length - 1]) || displayStart;
                                  const rangeLabel = displayStart && displayEnd
                                    ? (displayStart === displayEnd ? `Q${displayStart}` : `Q${displayStart}–${displayEnd}`)
                                    : `${block.questions.length} question${block.questions.length > 1 ? 's' : ''}`;
                                  return (
                                    <div key={key} className="border border-gray-200 rounded p-2 bg-white space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-medium text-gray-600">{rangeLabel}</span>
                                        <span className="text-[10px] text-gray-400">{block.questions.length} question{block.questions.length > 1 ? 's' : ''}</span>
                                      </div>
                                      {letters.length === 0 ? (
                                        <div className="text-[11px] text-gray-500 bg-gray-100 border border-dashed border-gray-300 rounded px-2 py-1.5">
                                          No shared options yet. Add one below.
                                        </div>
                                      ) : (
                                        letters.map((letter, idx) => (
                                          <div key={`${key}-${letter}`} className="flex items-center gap-2 group">
                                            <span className="w-6 text-sm text-gray-600">{letter}</span>
                                            <input
                                              className="flex-1 rounded-md border-gray-300 text-sm"
                                              placeholder={`Option ${letter}`}
                                              defaultValue={sharedTextMap.get(letter) || ''}
                                              onBlur={(e) => {
                                                const value = e.target.value;
                                                block.questions.forEach(async (q: any) => {
                                                  const existing = (q.options || []).find((o: any) => (o.option_letter || o.letter) === letter);
                                                  if (existing) {
                                                    if (value !== (existing.option_text || existing.text)) {
                                                      await updateOption.mutateAsync({ optionId: existing.id, data: { optionText: value }, questionId: q.id });
                                                    }
                                                  } else {
                                                    await createOption.mutateAsync({ questionId: q.id, optionText: value, optionLetter: letter, optionOrder: idx + 1 });
                                                  }
                                                });
                                              }}
                                            />
                                            <button
                                              type="button"
                                              onClick={() => removeSharedOption(section, block, letter)}
                                              className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 border rounded text-red-600 border-red-300 hover:bg-red-50"
                                            >Del</button>
                                          </div>
                                        ))
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => addSharedOption(section, block)}
                                        disabled={!block.questions.length}
                                        className={`px-2 py-1 text-xs border rounded ${block.questions.length ? 'text-blue-600 border-blue-300 hover:bg-blue-50' : 'text-gray-400 border-gray-200 cursor-not-allowed bg-gray-100'}`}
                                      >Add option</button>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                          )}
                          <div className={`md:col-span-8 ${hideSharedOptions[section.id] ? 'md:col-span-12' : ''}`}>
                            <div className="text-xs text-gray-600 mb-1">Questions and correct answers</div>
                            <div className="space-y-2">
                              {sectionWithFiltered.questions
                                .filter((q: any) => q.questionType === 'multiple_choice')
                                .sort((a: any, b: any) => getNum(a) - getNum(b))
                                .map((q: any, i: number) => {
                                  const isGroupAnchor = !!q.metadata?.groupRangeEnd;
                                  const groupMembers = isGroupAnchor ? section.questions.filter((m: any) => m.metadata?.groupMemberOf === q.id) : [];
                                  const applyToGroup = (fn: (target: any) => void | Promise<void>) => {
                                    if (isGroupAnchor) {
                                      fn(q);
                                      groupMembers.forEach(fn);
                                    } else {
                                      fn(q);
                                    }
                                  };
                                  const toggleDropdown = (checked: boolean) => {
                                    applyToGroup((target) => {
                                      const meta = { ...(target.metadata || {}) } as any;
                                      if (checked) {
                                        meta.displayMode = 'dropdown';
                                        meta.display_mode = 'dropdown';
                                        meta.renderMode = 'dropdown';
                                        meta.dropdown = true;
                                      } else {
                                        delete meta.displayMode;
                                        delete meta.display_mode;
                                        delete meta.renderMode;
                                        delete meta.dropdown;
                                      }
                                      target.metadata = meta;
                                      updateQuestion.mutate({ questionId: target.id, data: { metadata: meta } });
                                    });
                                  };
                                  const dropdownEnabled = q.metadata?.displayMode === 'dropdown'
                                    || q.metadata?.display_mode === 'dropdown'
                                    || q.metadata?.renderMode === 'dropdown'
                                    || q.metadata?.dropdown === true;
                                  return (
                                    <div key={`mc-row-${q.id}`} className="flex items-center gap-2">
                                      <div className="w-10 text-xs text-gray-500">Q{q.questionNumber || q.order || i + 1}</div>
                                      <input
                                        defaultValue={q.questionText || ''}
                                        placeholder="Question text"
                                        onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } })}
                                        className="flex-1 rounded-md border-gray-300 text-sm"
                                      />
                                      {!q.metadata?.groupMemberOf && (
                                        <div className="flex items-center gap-1">
                                          {(() => {
                                            const block = questionBlockMap.get(q.id);
                                            const sharedLetters = block ? (sharedLettersByBlock.get(makeBlockKey(section.id, block)) || resolveSharedLetters(section, block)) : [];
                                            const letters = q.metadata?.customOptionsGroup
                                              ? (q.options || []).map((o: any) => o.option_letter || o.letter).filter(Boolean)
                                              : (sharedLetters.length ? sharedLetters : (() => {
                                                const first = baseSharedQuestion;
                                                return (first?.options || []).map((o: any) => o.option_letter || o.letter).filter(Boolean);
                                              })());
                                            const groupSize = q.metadata?.groupRangeEnd ? (q.metadata.groupRangeEnd - (q.questionNumber || 0) + 1) : 1;
                                            const explicitMulti = !!q.metadata?.allowMultiSelect;
                                            const treatMulti = explicitMulti || (groupSize > 1 && !!q.metadata?.groupRangeEnd);
                                            const maxSel = explicitMulti ? (Number(q.metadata?.selectCount) || 2) : (treatMulti ? groupSize : 1);
                                            return letters.map((letter: string) => {
                                              if (treatMulti) {
                                                const current = (q.correctAnswer || '').split('|').filter(Boolean);
                                                const selected = current.includes(letter);
                                                return (
                                                  <button
                                                    key={`${q.id}-${letter}`}
                                                    onClick={async () => {
                                                      let next = [...current];
                                                      if (selected) {
                                                        next = next.filter((l) => l !== letter);
                                                      } else if (next.length < maxSel) {
                                                        next.push(letter);
                                                      } else {
                                                        next[next.length - 1] = letter;
                                                      }
                                                      const answer = next.join('|');
                                                      await updateQuestion.mutateAsync({ questionId: q.id, data: { correctAnswer: answer } });
                                                      if (q.metadata?.groupRangeEnd) {
                                                        section.questions
                                                          .filter((m: any) => m.metadata?.groupMemberOf === q.id)
                                                          .forEach((m: any) => {
                                                            updateQuestion.mutate({ questionId: m.id, data: { correctAnswer: answer } });
                                                          });
                                                      }
                                                    }}
                                                    className={`px-2 py-1 rounded border text-xs ${selected ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'}`}
                                                  >{letter}</button>
                                                );
                                              }
                                              return (
                                                <button
                                                  key={`${q.id}-${letter}`}
                                                  onClick={async () => {
                                                    const answer = letter;
                                                    await updateQuestion.mutateAsync({ questionId: q.id, data: { correctAnswer: answer } });
                                                    if (q.metadata?.groupRangeEnd) {
                                                      section.questions
                                                        .filter((m: any) => m.metadata?.groupMemberOf === q.id)
                                                        .forEach((m: any) => {
                                                          updateQuestion.mutate({ questionId: m.id, data: { correctAnswer: answer } });
                                                        });
                                                    }
                                                  }}
                                                  className={`px-2 py-1 rounded border text-xs ${(q.correctAnswer || '') === letter ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'}`}
                                                >{letter}</button>
                                              );
                                            });
                                          })()}
                                        </div>
                                      )}
                                      <div className="flex flex-col items-start gap-1 ml-1">
                                        <label
                                          className={`flex items-center gap-1 text-[10px] ${q.metadata?.allowMultiSelect ? 'opacity-40 cursor-not-allowed' : ''}`}
                                          title={q.metadata?.allowMultiSelect ? 'Disable multi-select to use dropdown mode' : 'Render this question as dropdown'}
                                        >
                                          <input
                                            type="checkbox"
                                            disabled={!!q.metadata?.allowMultiSelect}
                                            className="rounded border-gray-300"
                                            checked={dropdownEnabled}
                                            onChange={(e) => toggleDropdown(e.target.checked)}
                                          />
                                          DD
                                        </label>
                                      </div>
                                      <div className="flex flex-col items-start gap-1 ml-2">
                                        {(() => {
                                          const meta = q.metadata || {};
                                          if (meta.groupMemberOf) {
                                            const anchor = section.questions.find((qq: any) => qq.id === meta.groupMemberOf);
                                            const anchorNum = anchor?.questionNumber || '?';
                                            return (
                                              <span
                                                className="text-[10px] px-2 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700"
                                                title={`Member of group starting at Q${anchorNum}`}
                                              >Member of Q{anchorNum}</span>
                                            );
                                          }
                                          if (meta.groupRangeEnd) {
                                            return (
                                              <div className="flex items-center gap-1 flex-wrap">
                                                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-600 text-white" title="Group anchor">Group Q{q.questionNumber}–{meta.groupRangeEnd}</span>
                                                {meta.customOptionsGroup ? (
                                                  <>
                                                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-700" title="Group has custom options">Local opts</span>
                                                    <button
                                                      type="button"
                                                      className="text-[10px] px-2 py-0.5 border rounded border-amber-300 text-amber-700 hover:bg-amber-50"
                                                      onClick={() => toggleCustomOptionsForGroup(section, q, false)}
                                                    >Shared opts</button>
                                                    <button
                                                      type="button"
                                                      className="text-[10px] px-2 py-0.5 border rounded border-amber-300 text-amber-700 hover:bg-amber-50"
                                                      onClick={async () => {
                                                        const letters = (q.options || []).map((o: any) => o.option_letter || o.letter).filter(Boolean);
                                                        const nextLetter = computeNextLetter(letters);
                                                        const members = mcqGroupMembers(section, q.id);
                                                        for (const m of members) {
                                                          await createOption.mutateAsync({
                                                            questionId: m.id,
                                                            optionText: `Option ${nextLetter}`,
                                                            optionLetter: nextLetter,
                                                            optionOrder: (m.options?.length || 0) + 1,
                                                          });
                                                        }
                                                      }}
                                                    >Add Opt</button>
                                                    <button
                                                      type="button"
                                                      className="text-[10px] px-2 py-0.5 border rounded border-amber-300 text-amber-700 hover:bg-amber-50"
                                                      onClick={() => setOpenLocalOptions((prev) => ({ ...prev, [q.id]: !prev[q.id] }))}
                                                    >{openLocalOptions[q.id] ? 'Hide' : 'Edit'} Local</button>
                                                  </>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    className="text-[10px] px-2 py-0.5 border rounded border-purple-300 text-purple-700 hover:bg-purple-50"
                                                    onClick={() => toggleCustomOptionsForGroup(section, q, true)}
                                                  >Customize opts</button>
                                                )}
                                                {meta.customOptionsGroup && openLocalOptions[q.id] && (
                                                  <div className="w-full mt-2 bg-white border rounded p-2 text-[11px] space-y-1">
                                                    {(q.options || []).map((opt: any) => {
                                                      const letter = opt.option_letter || opt.letter;
                                                      return (
                                                        <div key={opt.id || letter} className="flex items-center gap-2">
                                                          <span className="w-5 text-gray-600 font-medium">{letter}</span>
                                                          <input
                                                            defaultValue={opt.option_text || opt.text || ''}
                                                            placeholder={`Option ${letter}`}
                                                            className="flex-1 border rounded px-2 py-1"
                                                            onBlur={async (e) => {
                                                              const value = e.target.value;
                                                              if ((opt.option_text || opt.text || '') === value) return;
                                                              const members = mcqGroupMembers(section, q.id);
                                                              for (const m of members) {
                                                                const match = (m.options || []).find((o: any) => (o.option_letter || o.letter) === letter);
                                                                if (match) {
                                                                  await updateOption.mutateAsync({ optionId: match.id, data: { optionText: value }, questionId: m.id });
                                                                }
                                                              }
                                                            }}
                                                          />
                                                          <button
                                                            type="button"
                                                            className="text-[10px] px-1.5 py-0.5 border rounded border-red-300 text-red-600 hover:bg-red-50"
                                                            title="Remove this option from the group"
                                                            onClick={async () => {
                                                              if (!window.confirm(`Remove option ${letter} from this group's local options?`)) return;
                                                              const members = mcqGroupMembers(section, q.id);
                                                              for (const m of members) {
                                                                const match = (m.options || []).find((o: any) => (o.option_letter || o.letter) === letter);
                                                                if (match) {
                                                                  await deleteOption.mutateAsync({ optionId: match.id, questionId: m.id });
                                                                }
                                                                if (m.correctAnswer) {
                                                                  if (m.metadata?.allowMultiSelect) {
                                                                    const parts = (m.correctAnswer || '').split('|').filter(Boolean);
                                                                    if (parts.includes(letter)) {
                                                                      const next = parts.filter((p: string) => p !== letter).join('|');
                                                                      await updateQuestion.mutateAsync({ questionId: m.id, data: { correctAnswer: next } });
                                                                    }
                                                                  } else if (m.correctAnswer === letter) {
                                                                    await updateQuestion.mutateAsync({ questionId: m.id, data: { correctAnswer: '' } });
                                                                  }
                                                                }
                                                              }
                                                            }}
                                                          >Del</button>
                                                        </div>
                                                      );
                                                    })}
                                                    <div className="text-[10px] text-gray-500">These options apply to Questions {q.questionNumber}–{meta.groupRangeEnd}. Editing text updates all members.</div>
                                                  </div>
                                                )}
                                                <button
                                                  type="button"
                                                  className="text-[10px] px-2 py-0.5 border rounded border-purple-300 text-purple-700 hover:bg-purple-50"
                                                  onClick={async () => {
                                                    if (!window.confirm('Remove this group? Members will be detached.')) return;
                                                    const newMeta: any = { ...meta };
                                                    delete newMeta.groupRangeEnd;
                                                    delete newMeta.customOptionsGroup;
                                                    await updateQuestion.mutateAsync({ questionId: q.id, data: { metadata: newMeta } });
                                                    section.questions.filter((qq: any) => qq.metadata?.groupMemberOf === q.id).forEach(async (m: any) => {
                                                      const mMeta: any = { ...(m.metadata || {}) };
                                                      delete mMeta.groupMemberOf;
                                                      delete mMeta.customOptionsGroup;
                                                      await updateQuestion.mutateAsync({ questionId: m.id, data: { metadata: mMeta } });
                                                    });
                                                  }}
                                                >Clear</button>
                                              </div>
                                            );
                                          }
                                          return (
                                            <button
                                              type="button"
                                              className="text-[10px] px-2 py-0.5 border rounded border-gray-300 text-gray-600 hover:bg-gray-50"
                                              onClick={() => {
                                                const maxNum = Math.max(...section.questions.filter((qq: any) => qq.questionType === 'multiple_choice').map((qq: any) => qq.questionNumber));
                                                const endStr = window.prompt(`Group range end question number (greater than ${q.questionNumber} and <= ${maxNum})`, String((q.questionNumber || 0) + 1));
                                                if (!endStr) return;
                                                const endNum = Number(endStr);
                                                if (isNaN(endNum) || endNum <= (q.questionNumber || 0) || endNum > maxNum) { toast.error('Invalid end number'); return; }
                                                const members = section.questions.filter((qq: any) => qq.questionType === 'multiple_choice' && qq.questionNumber > (q.questionNumber || 0) && qq.questionNumber <= endNum);
                                                if (members.length !== (endNum - (q.questionNumber || 0))) { toast.error('Missing questions in range'); return; }
                                                const anchorMeta = { ...(q.metadata || {}), groupRangeEnd: endNum };
                                                updateQuestion.mutate({ questionId: q.id, data: { metadata: anchorMeta } });
                                                members.forEach((m: any) => {
                                                  const mMeta = { ...(m.metadata || {}), groupMemberOf: q.id };
                                                  updateQuestion.mutate({ questionId: m.id, data: { metadata: mMeta } });
                                                });
                                              }}
                                            >Make Group</button>
                                          );
                                        })()}
                                        {!q.metadata?.groupMemberOf && !q.metadata?.groupRangeEnd && (
                                          <div className="flex items-start gap-1 flex-wrap mt-1">
                                            {q.metadata?.customOptionsGroup ? (
                                              <>
                                                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-700" title="This question uses its own local options">Local opts</span>
                                                <button
                                                  type="button"
                                                  className="text-[10px] px-2 py-0.5 border rounded border-amber-300 text-amber-700 hover:bg-amber-50"
                                                  onClick={() => toggleCustomOptionsForGroup(section, q, false)}
                                                >Shared opts</button>
                                                <button
                                                  type="button"
                                                  className="text-[10px] px-2 py-0.5 border rounded border-amber-300 text-amber-700 hover:bg-amber-50"
                                                  onClick={() => setOpenLocalOptions((prev) => ({ ...prev, [q.id]: !prev[q.id] }))}
                                                >{openLocalOptions[q.id] ? 'Hide' : 'Edit'} Local</button>
                                              </>
                                            ) : (
                                              <button
                                                type="button"
                                                className="text-[10px] px-2 py-0.5 border rounded border-gray-300 text-gray-600 hover:bg-gray-50"
                                                onClick={() => toggleCustomOptionsForGroup(section, q, true)}
                                              >Customize opts</button>
                                            )}
                                            {q.metadata?.customOptionsGroup && openLocalOptions[q.id] && (
                                              <div className="w-full mt-2 bg-white border rounded p-2 text-[11px] space-y-1">
                                                {(q.options || []).map((opt: any) => {
                                                  const letter = opt.option_letter || opt.letter;
                                                  return (
                                                    <div key={opt.id || letter} className="flex items-center gap-2">
                                                      <span className="w-5 text-gray-600 font-medium">{letter}</span>
                                                      <input
                                                        defaultValue={opt.option_text || opt.text || ''}
                                                        placeholder={`Option ${letter}`}
                                                        className="flex-1 border rounded px-2 py-1"
                                                        onBlur={async (e) => {
                                                          const value = e.target.value;
                                                          if ((opt.option_text || opt.text || '') === value) return;
                                                          await updateOption.mutateAsync({ optionId: opt.id, data: { optionText: value }, questionId: q.id });
                                                        }}
                                                      />
                                                      <button
                                                        type="button"
                                                        className="text-[10px] px-1.5 py-0.5 border rounded border-red-300 text-red-600 hover:bg-red-50"
                                                        title="Remove this option"
                                                        onClick={async () => {
                                                          if (!window.confirm(`Remove option ${letter}?`)) return;
                                                          await deleteOption.mutateAsync({ optionId: opt.id, questionId: q.id });
                                                          if (q.correctAnswer) {
                                                            if (q.metadata?.allowMultiSelect) {
                                                              const parts = (q.correctAnswer || '').split('|').filter(Boolean);
                                                              if (parts.includes(letter)) {
                                                                const next = parts.filter((p: string) => p !== letter).join('|');
                                                                await updateQuestion.mutateAsync({ questionId: q.id, data: { correctAnswer: next } });
                                                              }
                                                            } else if (q.correctAnswer === letter) {
                                                              await updateQuestion.mutateAsync({ questionId: q.id, data: { correctAnswer: '' } });
                                                            }
                                                          }
                                                        }}
                                                      >Del</button>
                                                    </div>
                                                  );
                                                })}
                                                <button
                                                  type="button"
                                                  className="text-[10px] px-2 py-0.5 border rounded border-amber-300 text-amber-700 hover:bg-amber-50"
                                                  onClick={async () => {
                                                    const letters = (q.options || []).map((o: any) => o.option_letter || o.letter).filter(Boolean);
                                                    const nextLetter = computeNextLetter(letters);
                                                    await createOption.mutateAsync({
                                                      questionId: q.id,
                                                      optionText: `Option ${nextLetter}`,
                                                      optionLetter: nextLetter,
                                                      optionOrder: (q.options?.length || 0) + 1,
                                                    });
                                                  }}
                                                >Add Opt</button>
                                                <div className="text-[10px] text-gray-500">These options apply only to Question {q.questionNumber}.</div>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                if (tm.type === 'multi_select') {
                  return (
                    <div key={`block-${tm.type}`} className="mb-4 border rounded">
                      <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium text-gray-700 flex items-center justify-between">
                        <span>Multi-Select (Choose TWO)</span>
                      </div>
                      <div className="p-3">
                        <div className="mb-3 text-xs text-gray-500">Correct answer expects exactly two option letters separated by pipe (e.g. A|C) or a JSON array ["A","C"].</div>
                        {sectionWithFiltered.questions.filter((q: any) => q.questionType === 'multi_select').sort((a: any,b: any)=>getNum(a)-getNum(b)).map((q: any, i: number) => (
                          <div key={`ms-row-${q.id}`} className="flex items-start gap-2 mb-2">
                            <div className="w-10 text-xs text-gray-500 pt-2">Q{q.questionNumber || q.order || i + 1}</div>
                            <div className="flex-1 space-y-2">
                              <input defaultValue={q.questionText || ''} placeholder="Question stem (18–23 Which TWO...)" onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } })} className="w-full rounded-md border-gray-300 text-sm" />
                              {(q.options || []).map((opt: any, idx: number) => (
                                <div key={opt.id || idx} className="flex items-center gap-2">
                                  <span className="w-6 text-xs text-gray-500">{opt.option_letter || opt.letter || String.fromCharCode(65+idx)}</span>
                                  <input defaultValue={opt.option_text || opt.text || ''} placeholder={`Option ${opt.option_letter || opt.letter || String.fromCharCode(65+idx)}`} onBlur={async (e) => {
                                    const val = e.target.value;
                                    if (!opt.id) {
                                      await createOption.mutateAsync({ questionId: q.id, optionText: val, optionLetter: (opt.option_letter||opt.letter||String.fromCharCode(65+idx)), optionOrder: idx+1 });
                                    } else if (val !== (opt.option_text || opt.text)) {
                                      await updateOption.mutateAsync({ optionId: opt.id, data: { optionText: val }, questionId: q.id });
                                    }
                                  }} className="flex-1 rounded-md border-gray-300 text-sm" />
                                </div>
                              ))}
                              <button type="button" className="text-xs px-2 py-1 border rounded" onClick={async () => {
                                const nextLetter = computeNextLetter((q.options||[]).map((o:any)=>o.option_letter||o.letter).filter(Boolean));
                                await createOption.mutateAsync({ questionId: q.id, optionText: '', optionLetter: nextLetter, optionOrder: (q.options?.length||0)+1 });
                              }}>Add Option</button>
                              <div className="flex items-center gap-2">
                                <input defaultValue={Array.isArray(q.correctAnswer)? (q.correctAnswer as string[]).join('|') : (q.correctAnswer||'')} placeholder="Correct letters e.g. A|C" onBlur={(e)=> updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: e.target.value } })} className="w-40 rounded-md border-gray-300 text-sm" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                if (tm.type === 'true_false') {
                  return (
                    <div key={`block-${tm.type}`} className="mb-4 border rounded">
                      <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium text-gray-700 flex items-center justify-between">
                        <span>True / False / Not Given</span>
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          <input type="checkbox" className="rounded border-gray-300" checked={!!showAdvanced[section.id]} onChange={(e) => setShowAdvanced(prev => ({ ...prev, [section.id]: e.target.checked }))} />
                          Show advanced list
                        </label>
                      </div>
                      <div className="p-3 space-y-2">
                        <textarea
                          placeholder="Group instruction (shown once to students)"
                          defaultValue={(() => { const q0 = section.questions.find((q: any)=>q.questionType==='true_false'); return q0?.metadata?.groupInstruction || ''; })()}
                          onBlur={(e) => {
                            const val = e.target.value;
                            section.questions.filter((q: any)=>q.questionType==='true_false').forEach((q: any) => {
                              const meta = { ...(q.metadata || {}), groupInstruction: val };
                              updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } });
                            });
                          }}
                          className="w-full rounded border border-gray-300 text-xs p-2"
                          rows={2}
                        />
                        {sectionWithFiltered.questions.filter((q: any) => q.questionType === 'true_false').sort((a: any,b: any)=>getNum(a)-getNum(b)).map((q: any, i: number) => (
                          <div key={`tf-row-${q.id}`} className="flex items-center gap-2">
                            <div className="w-10 text-xs text-gray-500">Q{q.questionNumber || q.order || i + 1}</div>
                            <input defaultValue={q.questionText || ''} placeholder="Question text" onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } })} className="flex-1 rounded-md border-gray-300 text-sm" />
                            <div className="flex items-center gap-1">
                              {['True','False','Not Given'].map((val) => (
                                <button key={`${q.id}-${val}`} onClick={() => updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: val } })} className={`px-2 py-1 rounded border text-xs ${ (q.correctAnswer || '') === val ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'}`}>{val}</button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                if (tm.type === 'fill_blank') {
                  return (
                    <div key={`block-${tm.type}`} className="mb-4 border rounded">
                      <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium text-gray-700 flex items-center justify-between">
                        <span>Fill in the Blank</span>
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          <input type="checkbox" className="rounded border-gray-300" checked={!!showAdvanced[section.id]} onChange={(e) => setShowAdvanced(prev => ({ ...prev, [section.id]: e.target.checked }))} />
                          Show advanced list
                        </label>
                      </div>
                      <div className="p-3 space-y-2">
                        <div className="text-xs text-gray-500">Use pipe (|) to separate multiple acceptable answers (e.g. <code>colour|color</code>) or enter a JSON array (e.g. ["cat","dog"]). Comparison is case-insensitive.</div>
                        <div className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded p-2">
                          For multiple blanks in one sentence just type underscores (___) or tokens like {`{answer1}`} {`{answer2}`} in the question text. Provide answers for each blank in order using semicolons to separate blanks and pipe (|) for alternatives. Example text: The colours are ___ , ___ and ___ . Example answers: <code>red|crimson;white;blue|azure</code>. (Optional advanced: JSON array of arrays e.g. <code>[["red","crimson"],["white"],["blue","azure"]]</code>.)
                        </div>
                        <textarea
                          placeholder="Group instruction (shown once to students)"
                          defaultValue={(() => { const q0 = section.questions.find((q: any)=>q.questionType==='fill_blank'); return q0?.metadata?.groupInstruction || ''; })()}
                          onBlur={(e) => {
                            const val = e.target.value;
                            section.questions.filter((q: any)=>q.questionType==='fill_blank').forEach((q: any) => {
                              const meta = { ...(q.metadata || {}), groupInstruction: val };
                              updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } });
                            });
                          }}
                          className="w-full rounded border border-gray-300 text-xs p-2"
                          rows={2}
                        />
                        <div className="flex justify-end mb-1">
                          <button type="button" className="text-xs px-2 py-1 border rounded" onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'fill_blank', metadata: withPartMeta(section) })}>+ Add Blank</button>
                        </div>
                        {sectionWithFiltered.questions.filter((q: any) => q.questionType === 'fill_blank').sort((a: any,b: any)=>getNum(a)-getNum(b)).map((q: any, i: number) => (
                          <div key={`fb-row-${q.id}`} className="flex items-center gap-2 group">
                            <div className="w-10 text-xs text-gray-500">Q{q.questionNumber || q.order || i + 1}</div>
                            <input defaultValue={q.questionText || ''} placeholder="Question text" onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } })} className="flex-1 rounded-md border-gray-300 text-sm" />
                            <input defaultValue={q.correctAnswer || ''} placeholder="Answers e.g. red|crimson;white;blue|azure" onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: e.target.value } })} className="w-72 rounded-md border-gray-300 text-sm" />
                            {/* Unified checkbox: Multiple blanks act as single question (different answers).
                                Legacy support: pre-check if previous singleNumber or conversation flags were set. */}
                            <label className="flex items-center gap-1 text-[10px] text-gray-600 whitespace-nowrap pr-1" title="When enabled, multiple blanks in this item are treated as one question number (student can input different answers per blank). Replaces old 'Single #' and 'Conversation' options.">
                              <input
                                type="checkbox"
                                className="rounded border-gray-300"
                                defaultChecked={!!(q.metadata?.combineBlanks || q.metadata?.singleNumber || q.metadata?.conversation)}
                                onChange={(e) => {
                                  const meta: any = { ...(q.metadata || {}) };
                                  if (e.target.checked) {
                                    meta.combineBlanks = true;
                                    // Preserve backward compatibility flags if present (do not delete), but new UI only toggles combineBlanks.
                                  } else {
                                    delete meta.combineBlanks;
                                  }
                                  updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } });
                                }}
                              />
                              Multiple blanks as single
                            </label>
                            <button type="button" className="opacity-0 group-hover:opacity-100 transition text-xs text-red-600 px-2 py-1 border rounded" onClick={() => { if (window.confirm('Delete this question?')) deleteQuestion.mutate({ questionId: q.id }); }}>Delete</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                if (tm.type === 'drag_drop') {
                  // Drag & Drop grouping: anchor questions (no groupMemberOf) manage options; members inherit via metadata.groupMemberOf
                  const ddQuestions = sectionWithFiltered.questions.filter((q:any)=> q.questionType==='drag_drop');
                  const anchors = ddQuestions.filter((q:any)=> !q.metadata?.groupMemberOf);
                  const getMembers = (anchorId:string) => ddQuestions.filter((m:any)=> m.metadata?.groupMemberOf === anchorId);
                  const computeNextLetterLocal = (anchor:any) => {
                    const used = (anchor.options||[]).map((o:any)=> o.option_letter||o.letter).filter(Boolean);
                    return computeNextLetter(used);
                  };
                  return (
                    <div key={`block-${tm.type}`} className="mb-4 border rounded">
                      <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium text-gray-700 flex items-center justify-between">
                        <span>Drag & Drop Groups</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="text-xs px-2 py-1 border rounded border-gray-300 text-gray-600 hover:bg-gray-100"
                            onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'drag_drop', metadata: withPartMeta(section, { layout: 'rows' }), questionText: 'Drag & Drop Group Instruction' })}
                          >+ Add Drag-Drop Group</button>
                          <label className="flex items-center gap-2 text-xs text-gray-600">
                            <input type="checkbox" className="rounded border-gray-300" checked={!!showAdvanced[section.id]} onChange={(e) => setShowAdvanced(prev => ({ ...prev, [section.id]: e.target.checked }))} />
                            Show advanced list
                          </label>
                        </div>
                      </div>
                      <div className="p-3 space-y-6">
                        {anchors.length === 0 && (
                          <div className="text-xs text-gray-500 italic">No drag & drop groups yet. Click "+ Add Drag-Drop Group".</div>
                        )}
                        {anchors.sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0)).map((anchor:any, ai:number) => {
                          const members = getMembers(anchor.id).sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0));
                          const layout = anchor.metadata?.layout || 'rows';
                          const options = anchor.options || [];
                          return (
                            <div key={anchor.id} className="border rounded-lg">
                              <div className="px-3 py-2 border-b bg-white flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                                  <span>Group #{anchor.questionNumber || ai + 1}</span>
                                  {anchor.metadata?.groupRangeEnd && <span className="text-[11px] px-2 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700">Q{anchor.questionNumber}–{anchor.metadata.groupRangeEnd}</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                  <select
                                    defaultValue={layout}
                                    className="text-xs border rounded px-2 py-1"
                                    onChange={(e)=> {
                                      const meta = { ...(anchor.metadata||{}), layout: e.target.value };
                                      updateQuestion.mutate({ questionId: anchor.id, data: { metadata: meta } });
                                    }}
                                  >
                                    <option value="rows">Rows</option>
                                    <option value="map">Map</option>
                                  </select>
                                  <button
                                    type="button"
                                    className="text-[10px] px-2 py-1 border rounded border-red-300 text-red-600 hover:bg-red-50"
                                    onClick={() => {
                                      if (!window.confirm('Delete entire drag & drop group (anchor + members)?')) return;
                                      // Delete members then anchor
                                      members.forEach((m:any)=> deleteQuestion.mutate({ questionId: m.id }));
                                      deleteQuestion.mutate({ questionId: anchor.id });
                                    }}
                                  >Delete Group</button>
                                </div>
                              </div>
                              <div className="p-3 space-y-4">
                                <div>
                                  <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Group Instruction</label>
                                  <textarea
                                    defaultValue={anchor.questionText || ''}
                                    rows={2}
                                    className="w-full border rounded text-sm p-2"
                                    onBlur={(e)=> updateQuestion.mutate({ questionId: anchor.id, data: { questionText: e.target.value } })}
                                  />
                                </div>
                                {layout === 'map' && (
                                  <div className="space-y-2">
                                    <label className="block text-[11px] uppercase tracking-wide text-gray-500">Map Image URL</label>
                                    <input
                                      defaultValue={anchor.metadata?.mapImageUrl || ''}
                                      placeholder="https://...image.png"
                                      onBlur={(e)=> {
                                        const meta = { ...(anchor.metadata||{}), mapImageUrl: e.target.value };
                                        updateQuestion.mutate({ questionId: anchor.id, data: { metadata: meta } });
                                      }}
                                      className="w-full border rounded text-sm px-2 py-1"
                                    />
                                    <div className="text-[10px] text-gray-500">Provide an image used for map / diagram labelling. Configure blank positions per item below (X/Y %).</div>
                                  </div>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                                  <div className="md:col-span-2">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs text-gray-600">Tokens / Answers</span>
                                      <button type="button" className="text-[10px] px-2 py-0.5 border rounded border-blue-300 text-blue-600" onClick={() => {
                                        const nextLetter = computeNextLetterLocal(anchor);
                                        createOption.mutate({ questionId: anchor.id, optionText: '', optionLetter: nextLetter, optionOrder: (options.length||0)+1 });
                                      }}>Add</button>
                                    </div>
                                    <div className="space-y-2">
                                      {options.sort((a:any,b:any)=> (a.option_order||0)-(b.option_order||0)).map((opt:any, oi:number) => {
                                        const letter = opt.option_letter || opt.letter || String.fromCharCode(65+oi);
                                        return (
                                          <div key={opt.id || letter} className="flex items-center gap-2 group">
                                            <span className="w-6 text-xs text-gray-500">{letter}</span>
                                            <input
                                              defaultValue={opt.option_text || opt.text || ''}
                                              placeholder={`Token ${letter}`}
                                              className="flex-1 border rounded text-sm px-2 py-1"
                                              onBlur={(e)=> {
                                                const val = e.target.value;
                                                if (!opt.id) {
                                                  createOption.mutate({ questionId: anchor.id, optionText: val, optionLetter: letter, optionOrder: oi+1 });
                                                } else if (val !== (opt.option_text||opt.text||'')) {
                                                  updateOption.mutate({ optionId: opt.id, data: { optionText: val }, questionId: anchor.id });
                                                }
                                              }}
                                            />
                                            <button type="button" className="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 border rounded border-red-300 text-red-600" onClick={()=> {
                                              if (!window.confirm('Delete this token?')) return;
                                              if (opt.id) deleteOption.mutate({ optionId: opt.id, questionId: anchor.id });
                                            }}>Del</button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <div className="md:col-span-3">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs text-gray-600">Items (questions)</span>
                                      <button type="button" className="text-[10px] px-2 py-0.5 border rounded border-green-300 text-green-700" onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'drag_drop', metadata: withPartMeta(section, { groupMemberOf: anchor.id }), questionText: 'New item' })}>Add Item</button>
                                    </div>
                                    <div className="space-y-2">
                                      {/* Anchor item row (so numbering starts at anchor) */}
                                      <div className="flex flex-col gap-1 border rounded p-2 bg-gray-50">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[11px] text-gray-500">Q{anchor.questionNumber || ''}</span>
                                          <input
                                            defaultValue={anchor.metadata?.itemLabel || ''}
                                            placeholder="Row label / prompt (Q anchor)"
                                            className="flex-1 border rounded text-sm px-2 py-1"
                                            onBlur={(e)=> {
                                              const meta = { ...(anchor.metadata||{}), itemLabel: e.target.value };
                                              updateQuestion.mutate({ questionId: anchor.id, data: { metadata: meta } });
                                            }}
                                          />
                                          <select
                                            defaultValue={anchor.correctAnswer || ''}
                                            className="text-xs border rounded px-2 py-1"
                                            onChange={(e)=> updateQuestion.mutate({ questionId: anchor.id, data: { correctAnswer: e.target.value } })}
                                          >
                                            <option value="">--</option>
                                            {options.map((o:any, oi:number)=> {
                                              const letter = o.option_letter || o.letter || String.fromCharCode(65+oi);
                                              return <option key={letter} value={letter}>{letter}</option>;
                                            })}
                                          </select>
                                          <button type="button" className="text-[10px] px-1.5 py-0.5 border rounded border-gray-300 text-gray-600" onClick={()=> updateQuestion.mutate({ questionId: anchor.id, data: { correctAnswer: '' } })}>Clear</button>
                                        </div>
                                      </div>
                                      {members.map((m:any)=> {
                                        const correct = m.correctAnswer || '';
                                        return (
                                          <div key={m.id} className="flex flex-col gap-1 border rounded p-2">
                                            <div className="flex items-center gap-2">
                                              <span className="text-[11px] text-gray-500">Q{m.questionNumber || ''}</span>
                                              <input
                                                defaultValue={m.questionText || ''}
                                                placeholder="Row label / prompt"
                                                className="flex-1 border rounded text-sm px-2 py-1"
                                                onBlur={(e)=> updateQuestion.mutate({ questionId: m.id, data: { questionText: e.target.value } })}
                                              />
                                              <select
                                                defaultValue={correct}
                                                className="text-xs border rounded px-2 py-1"
                                                onChange={(e)=> updateQuestion.mutate({ questionId: m.id, data: { correctAnswer: e.target.value } })}
                                              >
                                                <option value="">--</option>
                                                {options.map((o:any, oi:number)=> {
                                                  const letter = o.option_letter || o.letter || String.fromCharCode(65+oi);
                                                  return <option key={letter} value={letter}>{letter}</option>;
                                                })}
                                              </select>
                                              <button type="button" className="text-[10px] px-1.5 py-0.5 border rounded border-red-300 text-red-600" onClick={()=> { if (window.confirm('Delete this item?')) deleteQuestion.mutate({ questionId: m.id }); }}>Del</button>
                                            </div>
                                            {layout === 'map' && (
                                              <div className="flex items-center gap-2 text-[11px] text-gray-600">
                                                <label>X% <input type="number" min={0} max={100} defaultValue={m.metadata?.x || ''} className="w-16 border rounded px-1 py-0.5" onBlur={(e)=> {
                                                  const meta = { ...(m.metadata||{}), x: Number(e.target.value)||0 };
                                                  updateQuestion.mutate({ questionId: m.id, data: { metadata: meta } });
                                                }} /></label>
                                                <label>Y% <input type="number" min={0} max={100} defaultValue={m.metadata?.y || ''} className="w-16 border rounded px-1 py-0.5" onBlur={(e)=> {
                                                  const meta = { ...(m.metadata||{}), y: Number(e.target.value)||0 };
                                                  updateQuestion.mutate({ questionId: m.id, data: { metadata: meta } });
                                                }} /></label>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                      {members.length === 0 && (
                                        <div className="text-[11px] text-gray-500 italic">No items yet. Add one to begin.</div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                return null;
              });
            })()}

            {/* Individual questions list (advanced) */}
            {showAdvanced[section.id] && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <div className="flex gap-2 mb-2">
                  <select id={`add-type-${section.id}`} className="border rounded text-xs px-2 py-1">
                    <option value="multiple_choice">Multiple Choice</option>
                    <option value="multi_select">Multi-Select</option>
                    <option value="true_false">True/False/NG</option>
                    <option value="fill_blank">Fill Blank</option>
                    <option value="matching">Matching</option>
                    <option value="drag_drop">Drag & Drop</option>
                    <option value="essay">Essay</option>
                    <option value="writing_task1">Writing Task 1</option>
                    <option value="simple_table">Simple Table</option>
                  </select>
                  <button className="text-xs px-2 py-1 border rounded" onClick={() => {
                    const sel = (document.getElementById(`add-type-${section.id}`) as HTMLSelectElement).value;
                    createQuestion.mutate({ sectionId: section.id, questionType: sel, metadata: withPartMeta(section) });
                  }}>+ Add Question</button>
                </div>
              </div>
              {(sectionWithFiltered.questions || []).filter((q: any) => q.questionType !== 'matching').map((q: any) => (
                <div
                  key={q.id}
                  className="border border-gray-200 rounded-lg p-4 group"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const letter = e.dataTransfer.getData('text/letter');
                    if (letter) updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: letter } });
                  }}
                >
                  <div className="flex justify-end -mt-2 -mr-2 mb-1">
                    <button className="opacity-0 group-hover:opacity-100 transition text-[10px] px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200" onClick={() => { if (window.confirm('Delete this question?')) deleteQuestion.mutate({ questionId: q.id }); }}>Delete</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-start">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full border ${
                        (questionStatus[q.id] || 'idle') === 'idle' ? 'bg-gray-300 border-gray-300' :
                        questionStatus[q.id] === 'dirty' ? 'bg-blue-400 border-blue-400' :
                        questionStatus[q.id] === 'saving' ? 'bg-yellow-400 border-yellow-400' :
                        questionStatus[q.id] === 'saved' ? 'bg-green-500 border-green-500' : 'bg-red-500 border-red-500'
                      }`} title={`Status: ${questionStatus[q.id] || 'idle'}`}></span>
                      <span className="text-xs text-gray-500 w-6">#{q.questionNumber || q.order || ''}</span>
                      {FULL_MOCK && (section.sectionType==='listening' || section.sectionType==='reading') && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700">
                          {section.sectionType==='listening' ? `Part ${q.metadata?.listeningPart || 1}` : `Passage ${q.metadata?.readingPart || 1}`}
                        </span>
                      )}
                      <select defaultValue={q.questionType} onChange={(e) => { setStatus(q.id, 'dirty'); updateQuestion.mutate({ questionId: q.id, data: { questionType: e.target.value } }); setStatus(q.id, 'saving'); }} className="rounded-md border-gray-300">
                      <option value="multiple_choice">Multiple Choice</option>
                      <option value="multi_select">Multi-Select (Two)</option>
                      <option value="drag_drop">Drag & Drop</option>
                      <option value="multi_select">Multi-Select (Two)</option>
                      <option value="true_false">True/False/NG</option>
                      <option value="fill_blank">Fill in the Blank</option>
                      <option value="matching">Heading/Paragraph Matching</option>
                      <option value="essay">Essay (Task 2)</option>
                      <option value="writing_task1">Writing Task 1</option>
                      <option value="short_answer">Short Answer</option>
                      <option value="speaking_task">Speaking</option>
                      <option value="simple_table">Simple Table</option>
                    </select>
                    </div>
                    <input defaultValue={q.questionText || ''} placeholder="Question text" onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } }); }} className="md:col-span-3 rounded-md border-gray-300" />
                    <input type="number" step="0.5" defaultValue={q.points || 1} onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { points: Number(e.target.value) } }); }} className="rounded-md border-gray-300" />
                    <input type="number" placeholder="Time (s)" defaultValue={q.timeLimitSeconds || ''} onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { timeLimitSeconds: Number(e.target.value) } }); }} className="rounded-md border-gray-300" />
                    <input placeholder="Explanation (optional)" defaultValue={q.explanation || ''} onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { explanation: e.target.value } }); }} className="md:col-span-6 rounded-md border-gray-300" />
                    {(q.questionType === 'essay') && (
                      <div className="md:col-span-6 bg-indigo-50 border border-indigo-200 rounded p-3 space-y-2">
                        <div className="text-xs font-semibold text-indigo-700">Essay Settings</div>
                        <div className="flex flex-wrap gap-4">
                          <label className="text-xs text-indigo-800 flex flex-col gap-1">
                            Writing Part
                            <select
                              defaultValue={String(q.metadata?.writingPart || 2)}
                              onChange={(e)=> { setStatus(q.id,'saving'); updateQuestion.mutate({ questionId: q.id, data: { metadata: { ...(q.metadata||{}), writingPart: Number(e.target.value) } } }); }}
                              className="border-indigo-300 rounded"
                            >
                              <option value="1">Task 1</option>
                              <option value="2">Task 2</option>
                            </select>
                          </label>
                          <label className="text-xs text-indigo-800 flex flex-col gap-1">
                            Image URL (optional)
                            <input
                              defaultValue={q.imageUrl || ''}
                              placeholder="/uploads/images/abc.png or https://..."
                              onBlur={(e)=> { setStatus(q.id,'saving'); updateQuestion.mutate({ questionId: q.id, data: { imageUrl: e.target.value } }); }}
                              className="border-indigo-300 rounded px-2 py-1 w-72"
                            />
                          </label>
                          <label className="text-xs text-indigo-800 flex flex-col gap-1">
                            Upload Image
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                              onChange={async (e)=> {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                try {
                                  setStatus(q.id, 'saving');
                                  const res = await apiService.upload<{ imageUrl: string; absoluteUrl: string }>(`/admin/questions/${q.id}/image`, file);
                                  const payload: any = (res?.data as any) || res;
                                  const imageUrl = payload?.imageUrl || payload?.data?.imageUrl || '';
                                  updateQuestion.mutate({ questionId: q.id, data: { imageUrl } });
                                  toast.success('Image uploaded');
                                } catch (err) {
                                  toast.error('Upload failed');
                                  setStatus(q.id, 'error');
                                }
                              }}
                              className="border-indigo-300 rounded px-2 py-1 w-64"
                            />
                          </label>
                        </div>
                        {q.imageUrl && (
                          <div className="flex items-center gap-3">
                            <img
                              src={q.imageUrl.startsWith('http') ? q.imageUrl : `${apiOrigin}${q.imageUrl}`}
                              alt="Essay"
                              className="max-h-28 rounded border"
                            />
                            <a href={q.imageUrl.startsWith('http') ? q.imageUrl : `${apiOrigin}${q.imageUrl}`} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">Open image</a>
                          </div>
                        )}
                        <textarea defaultValue={q.metadata?.guidance || ''} placeholder="Guidance / prompt (optional)" onBlur={e=> { setStatus(q.id,'saving'); updateQuestion.mutate({ questionId: q.id, data: { metadata: { ...(q.metadata||{}), guidance: e.target.value } } }); }} className="w-full border border-indigo-300 rounded p-2 text-xs" rows={3} />
                      </div>
                    )}
                    {(q.questionType === 'writing_task1') && (
                      <div className="md:col-span-6 bg-blue-50 border border-blue-200 rounded p-3 space-y-2">
                        <div className="text-xs font-semibold text-blue-700">Writing Task 1 Settings</div>
                        <div className="flex flex-wrap gap-4">
                          <label className="text-xs text-blue-800 flex flex-col gap-1">
                            Variant
                            <select defaultValue={q.metadata?.variant || 'academic_report'} onChange={e=> { setStatus(q.id,'saving'); updateQuestion.mutate({ questionId: q.id, data: { metadata: { ...(q.metadata||{}), variant: e.target.value } } }); }} className="border-blue-300 rounded">
                              <option value="academic_report">Academic Report</option>
                              <option value="gt_letter">GT Letter</option>
                            </select>
                          </label>
                          <label className="text-xs text-blue-800 flex flex-col gap-1">
                            Min Words
                            <input type="number" defaultValue={q.metadata?.minWords || 150} onBlur={e=> { setStatus(q.id,'saving'); updateQuestion.mutate({ questionId: q.id, data: { metadata: { ...(q.metadata||{}), minWords: Number(e.target.value)||150 } } }); }} className="border-blue-300 rounded px-2 py-1 w-24" />
                          </label>
                          <label className="text-xs text-blue-800 flex flex-col gap-1">
                            Max Words
                            <input type="number" defaultValue={q.metadata?.maxWords || 220} onBlur={e=> { setStatus(q.id,'saving'); updateQuestion.mutate({ questionId: q.id, data: { metadata: { ...(q.metadata||{}), maxWords: Number(e.target.value)||220 } } }); }} className="border-blue-300 rounded px-2 py-1 w-24" />
                          </label>
                        </div>
                        <textarea defaultValue={q.metadata?.guidance || ''} placeholder="Guidance / prompt (optional)" onBlur={e=> { setStatus(q.id,'saving'); updateQuestion.mutate({ questionId: q.id, data: { metadata: { ...(q.metadata||{}), guidance: e.target.value } } }); }} className="w-full border border-blue-300 rounded p-2 text-xs" rows={3} />
                      </div>
                    )}
                    {(q.questionType === 'short_answer') && (
                      <div className="md:col-span-6 bg-amber-50 border border-amber-200 rounded p-3 space-y-2">
                        <div className="text-xs font-semibold text-amber-700">Short Answer Settings</div>
                        <div className="text-[10px] text-amber-700 bg-amber-100 border border-amber-200 rounded px-2 py-1">Deprecated: new Short Answer questions cannot be created. Existing ones remain editable or can be deleted.</div>
                        <div className="flex gap-4">
                          <label className="text-xs text-amber-800 flex flex-col gap-1">
                            Max Words
                            <input type="number" defaultValue={q.metadata?.maxWords || 3} onBlur={e=> { setStatus(q.id,'saving'); updateQuestion.mutate({ questionId: q.id, data: { metadata: { ...(q.metadata||{}), maxWords: Number(e.target.value)||3 } } }); }} className="border-amber-300 rounded px-2 py-1 w-24" />
                          </label>
                        </div>
                        <textarea defaultValue={(q.metadata?.acceptedAnswers||[]).join('\n')} placeholder="Accepted answers (one per line)" onBlur={e=> { const arr = e.target.value.split(/\r?\n/).map(l=>l.trim()).filter(Boolean); setStatus(q.id,'saving'); updateQuestion.mutate({ questionId: q.id, data: { metadata: { ...(q.metadata||{}), acceptedAnswers: arr } , correctAnswer: arr[0] || '' } }); }} className="w-full border border-amber-300 rounded p-2 text-xs" rows={3} />
                        <p className="text-[11px] text-amber-700">Answers auto-graded. Student response limited to 1-3 words.</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>
        );
      })}
      </div>
  </div>
  <ConfirmDialog
      open={confirmState.open}
      title={confirmState.title}
      description={confirmState.description}
      tone={confirmState.tone}
      confirmText={confirmState.confirmText}
      onCancel={closeConfirm}
      onConfirm={runConfirm}
    />
  </>
  );
};

export default AdminExamEdit;
