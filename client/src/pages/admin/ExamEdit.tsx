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
  const answerPlaceholderFor = (type: string) => {
    switch (type) {
      case 'multiple_choice':
        return 'Enter exact option text (or letter) that is correct';
      case 'drag_drop':
        return 'Enter exact option text (or letter) that is correct';
      case 'true_false':
        return 'Enter True, False, or Not Given';
      case 'fill_blank':
        return 'Enter expected text/number (comparison is case-insensitive)';
      case 'matching':
        return 'Enter exact option (e.g., A or the matching text)';
      case 'essay':
        return 'Optional rubric/keywords (not auto-graded)';
      default:
        return 'Enter correct answer';
    }
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
  const [selectedMatchQuestions, setSelectedMatchQuestions] = useState<Record<string, boolean>>({});

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

            {/* Matching bank (if section has matching) */}
            {section.questions?.some((q: any) => q.questionType === 'matching') && (
              <div className="mb-4">
                <div className="text-sm font-medium text-gray-700 mb-2">Headings Bank</div>
                {/* Seed + add */}
                <div className="flex items-center gap-2 flex-wrap mb-2">
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
                {/* Editable list */}
                <div className="space-y-2 mb-2">
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
                {/* Draggable chips */}
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {(section.headingBank?.options || []).map((opt: any, idx: number) => {
                    const letter = opt.letter || '';
                    const active = pendingHeading === letter;
                    return (
                      <button key={`chip-${idx}`} draggable onDragStart={(e) => { e.dataTransfer.setData('text/letter', letter); }} onClick={() => setPendingHeading(active ? null : letter)} className={`px-2.5 py-1 rounded border text-sm ${active ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'}`}>{letter}</button>
                    );
                  })}
                  <span className="text-xs text-gray-500">Drag a letter onto a question or click then Assign selected.</span>
                </div>
                {/* Bulk map UI */}
                <div className="mt-2 flex items-center gap-2">
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-sm text-gray-700">Bulk map:</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {section.questions.filter((q: any) => q.questionType === 'matching').map((q: any) => {
                        const isSel = !!selectedMatchQuestions[q.id];
                        return (
                          <button key={q.id} onClick={() => setSelectedMatchQuestions(prev => ({ ...prev, [q.id]: !prev[q.id] }))} className={`px-2 py-1 rounded border text-xs ${isSel ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'}`}>Q{q.questionNumber || q.order || '?'}{q.correctAnswer ? `(${q.correctAnswer})` : ''}</button>
                        );
                      })}
                    </div>
                    <button
                      disabled={!pendingHeading || !Object.values(selectedMatchQuestions).some(Boolean)}
                      onClick={async () => {
                        const ids = Object.entries(selectedMatchQuestions).filter(([_, v]) => v).map(([id]) => id);
                        for (const id of ids) {
                          await updateQuestion.mutateAsync({ questionId: id, data: { correctAnswer: pendingHeading } });
                        }
                        setSelectedMatchQuestions({});
                        toast.success(`Assigned ${pendingHeading} to ${ids.length} question(s)`);
                      }}
                      className="px-3 py-2 text-sm rounded border border-blue-200 text-blue-700 disabled:opacity-50"
                    >
                      Assign to selected
                    </button>
                    <button onClick={() => setSelectedMatchQuestions({})} className="px-3 py-2 text-sm rounded border">Clear</button>
                  </div>
                </div>

                {/* Quick mapping matrix */}
                <div className="mt-4 border rounded">
                  <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium text-gray-700">Quick mapping</div>
                  <div className="p-3 space-y-2">
                    {section.questions.filter((q: any) => q.questionType === 'matching').map((q: any, idx: number) => (
                      <div key={q.id} className="flex items-center gap-3">
                        <div className="w-10 text-xs text-gray-500">Q{q.questionNumber || q.order || idx + 1}</div>
                        <div className="flex-1 truncate text-sm text-gray-900" title={q.questionText}>{q.questionText || `Paragraph ${q.questionNumber || q.order || idx + 1}`}</div>
                        <div className="flex items-center gap-1 flex-wrap">
                          {(section.questions.find((qq: any) => qq.questionType === 'matching')?.options || []).map((opt: any, i2: number) => (
                            <button
                              key={`${q.id}-${opt.id || i2}`}
                              onClick={() => updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: opt.letter || opt.option_letter || '' } })}
                              className={`px-2 py-1 rounded border text-xs ${ (q.correctAnswer || '') === (opt.letter || opt.option_letter) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700' }`}
                            >
                              {opt.letter || opt.option_letter || ''}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Bulk Questions Import */}
            {/* Bulk import hidden for now to keep editing UI simple */}

            {/* Questions */}
            <div className="space-y-3">
              {(section.questions || []).map((q: any) => (
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
                      <option value="drag_drop">Drag & Drop</option>
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

                  {/* Options for multiple choice/matching/drag_drop */}
                  {(q.questionType === 'multiple_choice' || q.questionType === 'drag_drop' || (q.questionType === 'matching' && !(section.headingBank?.options?.length))) && (
                    <div className="mt-3 space-y-2">
                      {q.questionType === 'matching' && (
                        <div className="flex items-center gap-2">
                          <button
                            className="px-3 py-2 text-sm border rounded"
                            onClick={() => {
                              const letters = ['A','B','C','D','E','F','G'];
                              letters.forEach((letter, idx) => {
                                createOption.mutate({ questionId: q.id, optionText: '', optionLetter: letter, optionOrder: (q.options?.length || 0) + idx + 1 });
                              });
                            }}
                          >
                            Seed A–G
                          </button>
                          <button
                            className="px-3 py-2 text-sm border rounded"
                            onClick={() => {
                              const romans = ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi'];
                              romans.forEach((letter, idx) => {
                                createOption.mutate({ questionId: q.id, optionText: '', optionLetter: letter, optionOrder: (q.options?.length || 0) + idx + 1 });
                              });
                            }}
                          >
                            Seed i–xi
                          </button>
                          <span className="text-xs text-gray-500">Create lettered headings to fill texts for.</span>
                        </div>
                      )}
                      {(q.options || []).map((opt: any, idx: number) => (
                        <div key={opt.id || idx} className="grid grid-cols-1 md:grid-cols-7 gap-2 items-center">
                          {/* Letter for matching */}
                          {q.questionType === 'matching' && (
                            <input defaultValue={opt.letter || opt.option_letter || ''} placeholder="Letter" onChange={() => setStatus(q.id,'dirty')} onBlur={(e) => { setStatus(q.id,'saving'); updateOption.mutate({ optionId: opt.id, data: { optionLetter: e.target.value }, questionId: q.id }); }} className="rounded-md border-gray-300 w-20" />
                          )}
                          <input defaultValue={opt.text || opt.option_text} placeholder={`Heading ${idx + 1}`} onChange={() => setStatus(q.id,'dirty')} onBlur={(e) => { setStatus(q.id,'saving'); updateOption.mutate({ optionId: opt.id, data: { optionText: e.target.value }, questionId: q.id }); }} className={`${q.questionType === 'matching' ? 'md:col-span-4' : 'md:col-span-5'} rounded-md border-gray-300`} />
                          <input defaultValue={opt.option_order || idx + 1} type="number" min={1} onChange={() => setStatus(q.id,'dirty')} onBlur={(e) => { setStatus(q.id,'saving'); updateOption.mutate({ optionId: opt.id, data: { optionOrder: Number(e.target.value) }, questionId: q.id }); }} className="rounded-md border-gray-300" />
                          <button onClick={() => { setStatus(q.id,'saving'); deleteOption.mutate({ optionId: opt.id, questionId: q.id }); }} className="px-3 py-2 text-red-600 border border-red-200 rounded">Delete</button>
                        </div>
                      ))}
                      <div>
                        <button onClick={() => { setStatus(q.id,'saving'); createOption.mutate({ questionId: q.id, optionText: '' }); }} className="px-3 py-2 text-gray-700 border rounded">Add Option</button>
                      </div>
                    </div>
                  )}

                  {/* Correct answer setter */}
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-center">
                    <label className="text-sm text-gray-600">Correct Answer</label>
                    <input
                      defaultValue={q.correctAnswer || ''}
                      onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: e.target.value } })}
                      placeholder={answerPlaceholderFor(q.questionType)}
                      className="md:col-span-4 rounded-md border-gray-300"
                    />
                  </div>
                  {q.questionType === 'matching' && ((section.headingBank?.options?.length || (q.options || []).length) > 0) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {((section.headingBank?.options) || (q.options || [])).map((opt: any, i: number) => (
                        <button key={opt.id || i} onClick={() => updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: (opt.letter || opt.option_letter || '') } })} className={`px-2 py-1 rounded border ${ (q.correctAnswer || '') === (opt.letter || opt.option_letter) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700' }`}>
                          {opt.letter || opt.option_letter || '?'}
                        </button>
                      ))}
                      {/* Assign from bank */}
                      {pendingHeading && (
                        <button onClick={() => { updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: pendingHeading } }); }} className="px-2 py-1 rounded border border-blue-200 text-blue-700">Assign selected ({pendingHeading})</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminExamEdit;


