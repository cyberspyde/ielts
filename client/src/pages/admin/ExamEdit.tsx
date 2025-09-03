import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { apiService } from '../../services/api';
// Simplified: temporarily hide complex bulk importers for clarity

const AdminExamEdit: React.FC = () => {
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

  const updateQuestion = useMutation({
    mutationFn: async ({ questionId, data }: { questionId: string; data: any }) => apiService.put(`/admin/questions/${questionId}`, data),
    onSuccess: (_res, vars) => { markSavedFor(vars.questionId); queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); },
    onError: (e: any, vars) => { setStatus(vars.questionId, 'error'); toast.error(e.message || 'Failed to update question'); }
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
  const [sharedOptionLetters, setSharedOptionLetters] = useState<Record<string, string[]>>({});

  // Initialize letters from first MCQ question options if not already set
  useEffect(() => {
    if (!exam) return;
    const next: Record<string, string[]> = { ...sharedOptionLetters };
    let changed = false;
    exam.sections?.forEach((section: any) => {
      if (!next[section.id]) {
        const firstMcq = (section.questions || []).find((q: any) => q.questionType === 'multiple_choice');
        if (firstMcq) {
          const letters = (firstMcq.options || []).map((o: any) => o.option_letter || o.letter).filter(Boolean);
          if (letters.length) { next[section.id] = letters; changed = true; }
        }
      }
    });
    if (changed) setSharedOptionLetters(next);
  }, [exam]);

  const computeNextLetter = (used: string[]): string => {
    const A = 'A'.charCodeAt(0);
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(A + i);
      if (!used.includes(letter)) return letter;
    }
    return String.fromCharCode(A + used.length); // fallback (should not exceed Z realistically)
  };

  const addSharedOption = async (section: any) => {
    const current = sharedOptionLetters[section.id] || (['A','B','C','D'].slice(0, (section.questions?.[0]?.options || []).length) || []);
    const nextLetter = computeNextLetter(current);
    // Create this option for every MCQ question in section
    const mcqs = section.questions.filter((q: any) => q.questionType === 'multiple_choice');
    for (const q of mcqs) {
      await createOption.mutateAsync({ questionId: q.id, optionText: '', optionLetter: nextLetter, optionOrder: (q.options?.length || 0) + 1 });
    }
    setSharedOptionLetters(prev => ({ ...prev, [section.id]: [...current, nextLetter] }));
  };

  const removeSharedOption = async (section: any, letter: string) => {
    if (!window.confirm(`Remove option ${letter} from all MCQ questions in this section?`)) return;
    const mcqs = section.questions.filter((q: any) => q.questionType === 'multiple_choice');
    for (const q of mcqs) {
      const opt = (q.options || []).find((o: any) => (o.option_letter || o.letter) === letter);
      if (opt) {
        await deleteOption.mutateAsync({ optionId: opt.id, questionId: q.id });
      }
      if ((q.correctAnswer || '') === letter) {
        await updateQuestion.mutateAsync({ questionId: q.id, data: { correctAnswer: '' } });
      }
    }
    setSharedOptionLetters(prev => ({ ...prev, [section.id]: (prev[section.id] || []).filter(l => l !== letter) }));
  };

  if (isLoading || !exam) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
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
              <label className="block text-sm text-gray-600 mb-1">Duration (minutes)</label>
              <input type="number" defaultValue={exam.durationMinutes} onBlur={(e) => updateExam.mutate({ durationMinutes: Number(e.target.value) })} className="w-full rounded-md border-gray-300" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Passing Score</label>
              <input type="number" step="0.5" defaultValue={exam.passingScore} onBlur={(e) => updateExam.mutate({ passingScore: Number(e.target.value) })} className="w-full rounded-md border-gray-300" />
            </div>
            <div className="md:col-span-3">
              <label className="block text-sm text-gray-600 mb-1">Description</label>
              <textarea defaultValue={exam.description} onBlur={(e) => updateExam.mutate({ description: e.target.value })} className="w-full rounded-md border-gray-300" rows={3} />
            </div>
          </div>
        </div>

        {/* Sections & Questions */}
        {exam.sections?.map((section: any) => (
          <div key={section.id} className="bg-white rounded-lg border p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-600 mb-1">Section Title</label>
                <input defaultValue={section.title} onBlur={(e) => updateSection.mutate({ sectionId: section.id, data: { title: e.target.value } })} className="w-full rounded-md border-gray-300" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Duration (min)</label>
                <input type="number" defaultValue={section.durationMinutes} onBlur={(e) => updateSection.mutate({ sectionId: section.id, data: { durationMinutes: Number(e.target.value) } })} className="w-full rounded-md border-gray-300" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Max Score</label>
                <input type="number" step="0.5" defaultValue={section.maxScore} onBlur={(e) => updateSection.mutate({ sectionId: section.id, data: { maxScore: Number(e.target.value) } })} className="w-full rounded-md border-gray-300" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Order</label>
                <input type="number" defaultValue={section.sectionOrder} onBlur={(e) => updateSection.mutate({ sectionId: section.id, data: { sectionOrder: Number(e.target.value) } })} className="w-full rounded-md border-gray-300" />
              </div>
              {section.sectionType === 'listening' && (
                <div className="md:col-span-5">
                  <label className="block text-sm text-gray-600 mb-1">Audio URL</label>
                  <input defaultValue={section.audioUrl || ''} onBlur={(e) => updateSection.mutate({ sectionId: section.id, data: { audioUrl: e.target.value } })} className="w-full rounded-md border-gray-300" />
                </div>
              )}
              {section.sectionType === 'reading' && (
                <div className="md:col-span-5">
                  <label className="block text-sm text-gray-600 mb-1">Passage Text</label>
                  <textarea defaultValue={section.passageText || ''} onBlur={(e) => updateSection.mutate({ sectionId: section.id, data: { passageText: e.target.value } })} className="w-full rounded-md border-gray-300" rows={4} />
                </div>
              )}
            </div>

            {/* Import Headings for matching */}
            {/* Headings import hidden to reduce complexity; manage in create flow */}

            {/* Dynamic grouped blocks sorted by lowest question number per type */}
            {(() => {
              const qs = section.questions || [];
              const types: string[] = Array.from(new Set(qs.map((q: any) => q.questionType))) as string[];
              const getNum = (q: any) => q.questionNumber || q.order || 999999;
              const typeMeta = types
                .filter((t: string) => ['matching','multiple_choice','multi_select','true_false','fill_blank'].includes(t))
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
                            {section.questions.filter((q: any) => q.questionType === 'matching').sort((a: any,b: any) => getNum(a)-getNum(b)).map((q: any, idx: number) => (
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
                                <div className="w-10 text-xs text-gray-500">Q{q.questionNumber || q.order || idx + 1}</div>
                                <input
                                  defaultValue={q.questionText || ''}
                                  placeholder={`Question text for paragraph ${q.questionNumber || q.order || idx + 1}`}
                                  onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } })}
                                  className="flex-1 rounded-md border-gray-300 text-sm"
                                />
                                <div className="flex items-center gap-2">
                                  <div className="w-16 text-center px-2 py-1 rounded border bg-white">{q.correctAnswer || '-'}</div>
                                  <button className="px-2 py-1 text-xs border rounded" onClick={() => updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: '' } })}>Clear</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                if (tm.type === 'multiple_choice') {
                  return (
                    <div key={`block-${tm.type}`} className="mb-4 border rounded">
                      <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium text-gray-700 flex items-center justify-between">
                        <span>Multiple Choice</span>
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          <input type="checkbox" className="rounded border-gray-300" checked={!!showAdvanced[section.id]} onChange={(e) => setShowAdvanced(prev => ({ ...prev, [section.id]: e.target.checked }))} />
                          Show advanced list
                        </label>
                      </div>
                      <div className="p-3">
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
                          <div className="md:col-span-4">
                            <div className="text-xs text-gray-600 mb-1">Shared options</div>
                            <div className="space-y-2">
                              {(sharedOptionLetters[section.id] || (() => { const first = section.questions.find((q: any) => q.questionType==='multiple_choice'); return (first?.options || []).map((o: any) => o.option_letter || o.letter).filter(Boolean); })()).map((letter: string, idx: number) => (
                                <div key={`mc-${letter}`} className="flex items-center gap-2 group">
                                  <span className="w-6 text-sm text-gray-600">{letter}</span>
                                  <input className="flex-1 rounded-md border-gray-300 text-sm" placeholder={`Option ${letter}`} defaultValue={(() => { const firstQ = section.questions.find((q: any) => q.questionType==='multiple_choice'); const opt = firstQ?.options?.find((o: any) => (o.option_letter||o.letter)===letter); return opt?.option_text || opt?.text || ''; })()} onBlur={(e) => {
                                    const value = e.target.value;
                                    const mcQs = section.questions.filter((q: any) => q.questionType === 'multiple_choice');
                                    mcQs.forEach(async (q: any) => {
                                      const existing = (q.options || []).find((o: any) => (o.option_letter || o.letter) === letter);
                                      if (existing) {
                                        if (value !== (existing.option_text || existing.text)) {
                                          await updateOption.mutateAsync({ optionId: existing.id, data: { optionText: value }, questionId: q.id });
                                        }
                                      } else {
                                        await createOption.mutateAsync({ questionId: q.id, optionText: value, optionLetter: letter, optionOrder: idx + 1 });
                                      }
                                    });
                                  }} />
                                  <button type="button" onClick={() => removeSharedOption(section, letter)} className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 border rounded text-red-600 border-red-300 hover:bg-red-50">Del</button>
                                </div>
                              ))}
                              <button type="button" onClick={() => addSharedOption(section)} className="px-2 py-1 text-xs border rounded text-blue-600 border-blue-300 hover:bg-blue-50">Add option</button>
                            </div>
                          </div>
                          <div className="md:col-span-8">
                            <div className="text-xs text-gray-600 mb-1">Questions and correct answers</div>
                            <div className="space-y-2">
                              {section.questions.filter((q: any) => q.questionType === 'multiple_choice').sort((a: any,b: any)=>getNum(a)-getNum(b)).map((q: any, i: number) => (
                                <div key={`mc-row-${q.id}`} className="flex items-center gap-2">
                                  <div className="w-10 text-xs text-gray-500">Q{q.questionNumber || q.order || i + 1}</div>
                                  <input defaultValue={q.questionText || ''} placeholder="Question text" onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } })} className="flex-1 rounded-md border-gray-300 text-sm" />
                                  <div className="flex items-center gap-1">
                                    {(sharedOptionLetters[section.id] || (() => { const first = section.questions.find((qq: any)=>qq.questionType==='multiple_choice'); return (first?.options || []).map((o: any)=> o.option_letter || o.letter).filter(Boolean); })()).map((letter: string) => (
                                      <button key={`${q.id}-${letter}`} onClick={() => updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: letter } })} className={`px-2 py-1 rounded border text-xs ${ (q.correctAnswer || '') === letter ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'}`}>{letter}</button>
                                    ))}
                                  </div>
                                </div>
                              ))}
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
                        {section.questions.filter((q: any) => q.questionType === 'multi_select').sort((a: any,b: any)=>getNum(a)-getNum(b)).map((q: any, i: number) => (
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
                        {section.questions.filter((q: any) => q.questionType === 'true_false').sort((a: any,b: any)=>getNum(a)-getNum(b)).map((q: any, i: number) => (
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
                        {section.questions.filter((q: any) => q.questionType === 'fill_blank').sort((a: any,b: any)=>getNum(a)-getNum(b)).map((q: any, i: number) => (
                          <div key={`fb-row-${q.id}`} className="flex items-center gap-2">
                            <div className="w-10 text-xs text-gray-500">Q{q.questionNumber || q.order || i + 1}</div>
                            <input defaultValue={q.questionText || ''} placeholder="Question text" onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } })} className="flex-1 rounded-md border-gray-300 text-sm" />
                            <input defaultValue={q.correctAnswer || ''} placeholder="Answer(s) e.g. colour|color" onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: e.target.value } })} className="w-60 rounded-md border-gray-300 text-sm" />
                          </div>
                        ))}
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
              {(section.questions || []).filter((q: any) => q.questionType !== 'matching').map((q: any) => (
                <div
                  key={q.id}
                  className="border border-gray-200 rounded-lg p-4"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const letter = e.dataTransfer.getData('text/letter');
                    if (letter) updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: letter } });
                  }}
                >
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-start">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full border ${
                        (questionStatus[q.id] || 'idle') === 'idle' ? 'bg-gray-300 border-gray-300' :
                        questionStatus[q.id] === 'dirty' ? 'bg-blue-400 border-blue-400' :
                        questionStatus[q.id] === 'saving' ? 'bg-yellow-400 border-yellow-400' :
                        questionStatus[q.id] === 'saved' ? 'bg-green-500 border-green-500' : 'bg-red-500 border-red-500'
                      }`} title={`Status: ${questionStatus[q.id] || 'idle'}`}></span>
                      <span className="text-xs text-gray-500 w-6">#{q.questionNumber || q.order || ''}</span>
                      <select defaultValue={q.questionType} onChange={(e) => { setStatus(q.id, 'dirty'); updateQuestion.mutate({ questionId: q.id, data: { questionType: e.target.value } }); setStatus(q.id, 'saving'); }} className="rounded-md border-gray-300">
                      <option value="multiple_choice">Multiple Choice</option>
                      <option value="multi_select">Multi-Select (Two)</option>
                      <option value="drag_drop">Drag & Drop</option>
                      <option value="multi_select">Multi-Select (Two)</option>
                      <option value="true_false">True/False/NG</option>
                      <option value="fill_blank">Fill in the Blank</option>
                      <option value="matching">Heading/Paragraph Matching</option>
                      <option value="essay">Essay</option>
                      <option value="speaking_task">Speaking</option>
                    </select>
                    </div>
                    <input defaultValue={q.questionText || ''} placeholder="Question text" onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } }); }} className="md:col-span-3 rounded-md border-gray-300" />
                    <input type="number" step="0.5" defaultValue={q.points || 1} onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { points: Number(e.target.value) } }); }} className="rounded-md border-gray-300" />
                    <input type="number" placeholder="Time (s)" defaultValue={q.timeLimitSeconds || ''} onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { timeLimitSeconds: Number(e.target.value) } }); }} className="rounded-md border-gray-300" />
                    <input placeholder="Explanation (optional)" defaultValue={q.explanation || ''} onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { explanation: e.target.value } }); }} className="md:col-span-6 rounded-md border-gray-300" />
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminExamEdit;


