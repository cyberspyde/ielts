import React, { useEffect, useState } from 'react';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
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
    mutationFn: async (data: { sectionType: string; title: string; durationMinutes: number; maxScore: number; sectionOrder: number }) => apiService.post(`/admin/exams/${examId}/sections`, { sections: [data] }),
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
  const [newSection, setNewSection] = useState<{ sectionType: string; title: string; durationMinutes: number; maxScore: number }>({ sectionType: 'reading', title: '', durationMinutes: 30, maxScore: 9 });
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

  const deleteQuestion = useMutation({
    mutationFn: async ({ questionId }: { questionId: string }) => apiService.delete(`/admin/questions/${questionId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] }); toast.success('Question deleted'); },
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
  const [sharedOptionLetters, setSharedOptionLetters] = useState<Record<string, string[]>>({});
  // Audio upload (per listening section)
  const [audioFiles, setAudioFiles] = useState<Record<string, File | null>>({});
  const [audioProgress, setAudioProgress] = useState<Record<string, number>>({});

  const uploadAudio = useMutation({
    mutationFn: async ({ sectionId, file }: { sectionId: string; file: File }) => {
      return apiService.upload<{ audioUrl: string }>(`/admin/sections/${sectionId}/audio`, file, (p) => {
        setAudioProgress(prev => ({ ...prev, [sectionId]: p }));
      });
    },
    onSuccess: (_res, vars) => {
      toast.success('Audio uploaded');
      setAudioFiles(prev => ({ ...prev, [vars.sectionId]: null }));
      setAudioProgress(prev => ({ ...prev, [vars.sectionId]: 0 }));
      queryClient.invalidateQueries({ queryKey: ['admin-exam', examId] });
    },
    onError: (e: any, vars) => {
      toast.error(e?.message || 'Upload failed');
      setAudioProgress(prev => ({ ...prev, [vars.sectionId]: 0 }));
    }
  });

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

  // --- Custom MCQ group option helpers ---
  const mcqGroupMembers = (section: any, anchorId: string) => section.questions.filter((qq: any) => qq.questionType === 'multiple_choice' && (qq.id === anchorId || qq.metadata?.groupMemberOf === anchorId));
  const toggleCustomOptionsForGroup = async (section: any, anchor: any, enable: boolean) => {
    const members = mcqGroupMembers(section, anchor.id);
    // Determine shared baseline options (letters + text) from first non-custom MCQ or anchor itself
    const baselineQ = section.questions.find((q:any)=> q.questionType==='multiple_choice' && !q.metadata?.customOptionsGroup) || anchor;
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
    openConfirm({
      title: 'Remove Shared Option',
      description: <>Remove option <strong>{letter}</strong> from all MCQ questions in this section? This action cannot be undone.</>,
      tone: 'warning',
      confirmText: 'Remove',
      onConfirm: async () => {
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

        {/* Add Section */}
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
            <div>
              <label className="block text-xs text-gray-600 mb-1">Duration (min)</label>
              <input type="number" className="rounded-md border-gray-300 w-full" value={newSection.durationMinutes} onChange={(e)=> setNewSection(s => ({ ...s, durationMinutes: Number(e.target.value)||0 }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Max Score</label>
              <input type="number" step="0.5" className="rounded-md border-gray-300 w-full" value={newSection.maxScore} onChange={(e)=> setNewSection(s => ({ ...s, maxScore: Number(e.target.value)||0 }))} />
            </div>
            <div>
              <button type="button" className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm disabled:opacity-50" disabled={createSection.isPending} onClick={() => {
                const data = { sectionType: newSection.sectionType, title: newSection.title || newSection.sectionType.charAt(0).toUpperCase()+newSection.sectionType.slice(1), durationMinutes: newSection.durationMinutes || 30, maxScore: newSection.maxScore || 9, sectionOrder: nextSectionOrder() };
                createSection.mutate(data);
              }}>{createSection.isPending ? 'Adding...' : 'Add Section'}</button>
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
              <div className="flex items-end">
                <button type="button" className="mt-5 px-3 py-1.5 text-xs rounded-md border border-red-300 text-red-600 hover:bg-red-50" onClick={() => openConfirm({ title: 'Delete Section', tone: 'danger', description: <>Delete section <strong>{section.title}</strong> and all its questions?</>, confirmText: 'Delete', onConfirm: () => deleteSection.mutate({ sectionId: section.id }) })}>Delete Section</button>
              </div>
              {section.sectionType === 'listening' && (
                <div className="md:col-span-5">
                  <label className="block text-sm text-gray-600 mb-1">Listening Audio</label>
                  {/* Existing URL (manual override) */}
                  <div className="space-y-2">
                    {section.audioUrl && (
                      <div className="p-2 border rounded bg-gray-50 space-y-2">
                        <div className="flex items-center justify-between text-xs text-gray-600">
                          <span>Current file</span>
                          <button
                            type="button"
                            className="px-2 py-0.5 border rounded text-[11px] text-red-600 border-red-300 hover:bg-red-50"
                            onClick={() => updateSection.mutate({ sectionId: section.id, data: { audioUrl: '' } })}
                          >Remove</button>
                        </div>
                        <audio controls className="w-full">
                          <source src={section.audioUrl?.startsWith('http') ? section.audioUrl : `${apiOrigin}${section.audioUrl}`} />
                          Your browser does not support the audio element.
                        </audio>
                        <div className="text-[11px] break-all text-gray-500">{section.audioUrl}</div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs">
                      <input
                        type="file"
                        accept="audio/mpeg,audio/mp3,audio/wav,audio/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          setAudioFiles(prev => ({ ...prev, [section.id]: file }));
                        }}
                        className="flex-1 text-[11px]"
                      />
                      <button
                        type="button"
                        disabled={!audioFiles[section.id] || uploadAudio.status === 'pending'}
                        onClick={() => {
                          const f = audioFiles[section.id];
                          if (!f) return;
                          if (f.size > 26 * 1024 * 1024) { toast.error('File too large (max 25MB)'); return; }
                          uploadAudio.mutate({ sectionId: section.id, file: f });
                        }}
                        className={`px-3 py-1 rounded border text-xs ${(!audioFiles[section.id] || uploadAudio.status === 'pending') ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-500'}`}
                      >{uploadAudio.status === 'pending' && audioFiles[section.id] ? 'Uploading...' : (section.audioUrl ? 'Replace' : 'Upload')}</button>
                    </div>
                    {audioFiles[section.id] && (
                      <div className="text-[11px] text-gray-600 flex items-center justify-between">
                        <span>{audioFiles[section.id]?.name} ({((audioFiles[section.id]!.size/1024/1024).toFixed(2))} MB)</span>
                        {audioProgress[section.id] ? <span>{audioProgress[section.id]}%</span> : null}
                      </div>
                    )}
                    {audioProgress[section.id] && audioProgress[section.id] > 0 && (
                      <div className="h-2 bg-gray-200 rounded overflow-hidden">
                        <div className="h-full bg-blue-600 transition-all" style={{ width: `${audioProgress[section.id]}%` }}></div>
                      </div>
                    )}
                    <div className="pt-1">
                      <label className="block text-[11px] text-gray-500 mb-0.5">Or set external audio URL (optional)</label>
                      <input
                        placeholder="https://..."
                        defaultValue={section.audioUrl && section.audioUrl.startsWith('http') ? section.audioUrl : ''}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val) updateSection.mutate({ sectionId: section.id, data: { audioUrl: val } });
                        }}
                        className="w-full rounded-md border-gray-300 text-xs"
                      />
                      <div className="text-[10px] text-gray-400 mt-0.5">Accepts MP3/WAV up to 25MB. Upload stores a local copy; external URL overrides.</div>
                    </div>
                  </div>
                </div>
              )}
              {section.sectionType === 'reading' && (
                <div className="md:col-span-5">
                  <label className="block text-sm text-gray-600 mb-1">Passage Text</label>
                  <textarea defaultValue={section.passageText || ''} onBlur={(e) => updateSection.mutate({ sectionId: section.id, data: { passageText: e.target.value } })} className="w-full rounded-md border-gray-300" rows={4} />
                </div>
              )}
            </div>

            {/* Quick bulk question creator for this section */}
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
                        <option value="short_answer">Short Answer</option>
                        <option value="drag_drop">Drag & Drop</option>
                        <option value="matching">Heading Matching</option>
                        <option value="essay">Essay</option>
                        <option value="speaking_task">Speaking</option>
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
                        bulkCreateQuestions.mutate({ sectionId: section.id, groups: [{ questionType: rd.questionType, start, end, points, fillMissing: rd.fillMissing }] });
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

            {/* Import Headings for matching */}
            {/* Headings import hidden to reduce complexity; manage in create flow */}

            {/* Dynamic grouped blocks sorted by lowest question number per type */}
            {(() => {
              const qs = section.questions || [];
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
                          <button className="px-3 py-2 text-sm border rounded bg-blue-50 border-blue-300 text-blue-700" onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'matching' })}>+ Add Paragraph</button>
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
                              await createQuestion.mutateAsync({ sectionId: section.id, questionType: 'matching', metadata: { paragraphIndex: p.idx }, questionText: snippet ? `Paragraph ${p.idx}: ${snippet}` : `Paragraph ${p.idx}` });
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
                            {section.questions.filter((q: any)=>q.questionType==='matching').length === 0 && (
                              <div className="text-xs text-gray-500 italic">No paragraph questions yet. Click "+ Add Paragraph" to create them manually.</div>
                            )}
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
                            <div className="space-y-2">
                              {(sharedOptionLetters[section.id] || (() => { const first = section.questions.find((q: any) => q.questionType==='multiple_choice'); return (first?.options || []).map((o: any) => o.option_letter || o.letter).filter(Boolean); })()).map((letter: string, idx: number) => (
                                <div key={`mc-${letter}`} className="flex items-center gap-2 group">
                                  <span className="w-6 text-sm text-gray-600">{letter}</span>
                                  <input className="flex-1 rounded-md border-gray-300 text-sm" placeholder={`Option ${letter}`} defaultValue={(() => { const firstQ = section.questions.find((q: any) => q.questionType==='multiple_choice'); const opt = firstQ?.options?.find((o: any) => (o.option_letter||o.letter)===letter); return opt?.option_text || opt?.text || ''; })()} onBlur={(e) => {
                                    const value = e.target.value;
                                    // Only update MCQs that are NOT in a custom options group
                                    const mcQs = section.questions.filter((q: any) => q.questionType === 'multiple_choice' && !q.metadata?.customOptionsGroup);
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
                          )}
                          <div className={`md:col-span-8 ${hideSharedOptions[section.id] ? 'md:col-span-12' : ''}`}>
                            <div className="text-xs text-gray-600 mb-1">Questions and correct answers</div>
                            <div className="space-y-2">
                              {section.questions.filter((q: any) => q.questionType === 'multiple_choice').sort((a: any,b: any)=>getNum(a)-getNum(b)).map((q: any, i: number) => (
                                <div key={`mc-row-${q.id}`} className="flex items-center gap-2">
                                  <div className="w-10 text-xs text-gray-500">Q{q.questionNumber || q.order || i + 1}</div>
                                  <input defaultValue={q.questionText || ''} placeholder="Question text" onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } })} className="flex-1 rounded-md border-gray-300 text-sm" />
                                  {/* Hide selector buttons for group member questions; only anchors choose answers */}
                                  {!q.metadata?.groupMemberOf && (
                                    <div className="flex items-center gap-1">
                                      {(() => {
                                        const letters = q.metadata?.customOptionsGroup
                                          ? (q.options || []).map((o: any)=>o.option_letter || o.letter).filter(Boolean)
                                          : (sharedOptionLetters[section.id] || (() => { const first = section.questions.find((qq: any)=>qq.questionType==='multiple_choice' && !qq.metadata?.customOptionsGroup); return (first?.options || []).map((o: any)=> o.option_letter || o.letter).filter(Boolean); })());
                                        const groupSize = q.metadata?.groupRangeEnd ? (q.metadata.groupRangeEnd - (q.questionNumber || 0) + 1) : 1;
                                        const explicitMulti = !!q.metadata?.allowMultiSelect; // block toggle
                                        // Auto-enable multi-select for group anchors when group size > 1
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
                                                    next = next.filter(l => l !== letter);
                                                  } else if (next.length < maxSel) {
                                                    next.push(letter);
                                                  } else {
                                                    next[next.length - 1] = letter; // replace last
                                                  }
                                                  const answer = next.join('|');
                                                  await updateQuestion.mutateAsync({ questionId: q.id, data: { correctAnswer: answer } });
                                                  if (q.metadata?.groupRangeEnd) {
                                                    section.questions.filter((m:any)=> m.metadata?.groupMemberOf === q.id).forEach((m:any) => {
                                                      updateQuestion.mutate({ questionId: m.id, data: { correctAnswer: answer } });
                                                    });
                                                  }
                                                }}
                                                className={`px-2 py-1 rounded border text-xs ${ selected ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'}`}
                                              >{letter}</button>
                                            );
                                          }
                                          // single-select
                                          return (
                                            <button
                                              key={`${q.id}-${letter}`}
                                              onClick={async () => {
                                                const answer = letter;
                                                await updateQuestion.mutateAsync({ questionId: q.id, data: { correctAnswer: answer } });
                                                if (q.metadata?.groupRangeEnd) {
                                                  section.questions.filter((m:any)=> m.metadata?.groupMemberOf === q.id).forEach((m:any) => {
                                                    updateQuestion.mutate({ questionId: m.id, data: { correctAnswer: answer } });
                                                  });
                                                }
                                              }}
                                              className={`px-2 py-1 rounded border text-xs ${ (q.correctAnswer || '') === letter ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'}`}
                                            >{letter}</button>
                                          );
                                        });
                                      })()}
                                    </div>
                                  )}
                                  {/* Grouping controls */}
                                  <div className="flex flex-col items-start gap-1 ml-2">
                                    {(() => {
                                      const meta = q.metadata || {};
                                      // If this is a member of a group, show badge + clear option only on anchor? allow clearing by anchor only.
                                      if (meta.groupMemberOf) {
                                        const anchor = section.questions.find((qq:any)=>qq.id===meta.groupMemberOf);
                                        const anchorNum = anchor?.questionNumber || '?';
                                        return (
                                          <span className="text-[10px] px-2 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700" title={`Member of group starting at Q${anchorNum}`}>Member of Q{anchorNum}</span>
                                        );
                                      }
                                      // Anchor case
                                      if (meta.groupRangeEnd) {
                                        return (
                                          <div className="flex items-center gap-1 flex-wrap">
                                            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-600 text-white" title="Group anchor">Group Q{q.questionNumber}–{meta.groupRangeEnd}</span>
                                            {meta.customOptionsGroup ? (
                                              <>
                                                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-700" title="Group has custom options">Local opts</span>
                                                <button type="button" className="text-[10px] px-2 py-0.5 border rounded border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => toggleCustomOptionsForGroup(section, q, false)}>Shared opts</button>
                                                <button type="button" className="text-[10px] px-2 py-0.5 border rounded border-amber-300 text-amber-700 hover:bg-amber-50" onClick={async () => {
                                                  const letters = (q.options || []).map((o:any)=>o.option_letter||o.letter).filter(Boolean);
                                                  const nextLetter = computeNextLetter(letters);
                                                  const members = mcqGroupMembers(section, q.id);
                                                  for (const m of members) {
                                                    await createOption.mutateAsync({ questionId: m.id, optionText: `Option ${nextLetter}`, optionLetter: nextLetter, optionOrder: (m.options?.length||0)+1 });
                                                  }
                                                }}>Add Opt</button>
                                                <button type="button" className="text-[10px] px-2 py-0.5 border rounded border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => setOpenLocalOptions(prev => ({ ...prev, [q.id]: !prev[q.id] }))}>{openLocalOptions[q.id] ? 'Hide' : 'Edit'} Local</button>
                                              </>
                                            ) : (
                                              <button type="button" className="text-[10px] px-2 py-0.5 border rounded border-purple-300 text-purple-700 hover:bg-purple-50" onClick={() => toggleCustomOptionsForGroup(section, q, true)}>Customize opts</button>
                                            )}
                                            {meta.customOptionsGroup && openLocalOptions[q.id] && (
                                              <div className="w-full mt-2 bg-white border rounded p-2 text-[11px] space-y-1">
                                                {(q.options || []).map((opt:any) => {
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
                                                          // Update this option for every member in group to keep consistent
                                                          const members = mcqGroupMembers(section, q.id);
                                                          for (const m of members) {
                                                            const match = (m.options || []).find((o:any)=> (o.option_letter||o.letter) === letter);
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
                                                            const match = (m.options || []).find((o:any)=> (o.option_letter||o.letter) === letter);
                                                            if (match) {
                                                              await deleteOption.mutateAsync({ optionId: match.id, questionId: m.id });
                                                            }
                                                            // Clean up correctAnswer if it referenced this letter
                                                            if (m.correctAnswer) {
                                                              if (m.metadata?.allowMultiSelect) {
                                                                const parts = (m.correctAnswer || '').split('|').filter(Boolean);
                                                                if (parts.includes(letter)) {
                                                                  const next = parts.filter((p:string)=>p!==letter).join('|');
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
                                                const newMeta = { ...meta }; delete newMeta.groupRangeEnd; delete newMeta.customOptionsGroup; await updateQuestion.mutateAsync({ questionId: q.id, data: { metadata: newMeta } });
                                                section.questions.filter((qq:any)=>qq.metadata?.groupMemberOf === q.id).forEach(async (m:any) => {
                                                  const mMeta = { ...(m.metadata||{}) }; delete mMeta.groupMemberOf; delete mMeta.customOptionsGroup; await updateQuestion.mutateAsync({ questionId: m.id, data: { metadata: mMeta } });
                                                });
                                              }}
                                            >Clear</button>
                                          </div>
                                        );
                                      }
                                      // Provide create group action (only if subsequent consecutive questions of same type exist)
                                      return (
                                        <button
                                          type="button"
                                          className="text-[10px] px-2 py-0.5 border rounded border-gray-300 text-gray-600 hover:bg-gray-50"
                                          onClick={() => {
                                            const maxNum = Math.max(...section.questions.filter((qq:any)=>qq.questionType==='multiple_choice').map((qq:any)=>qq.questionNumber));
                                            const endStr = window.prompt(`Group range end question number (greater than ${q.questionNumber} and <= ${maxNum})`, String(q.questionNumber + 1));
                                            if (!endStr) return;
                                            const endNum = Number(endStr);
                                            if (isNaN(endNum) || endNum <= q.questionNumber || endNum > maxNum) { toast.error('Invalid end number'); return; }
                                            // Ensure all intermediate questions are same type and exist
                                            const members = section.questions.filter((qq:any)=> qq.questionType==='multiple_choice' && qq.questionNumber>q.questionNumber && qq.questionNumber<=endNum);
                                            if (members.length !== (endNum - q.questionNumber)) { toast.error('Missing questions in range'); return; }
                                            // Update anchor
                                            const anchorMeta = { ...(meta), groupRangeEnd: endNum };
                                            updateQuestion.mutate({ questionId: q.id, data: { metadata: anchorMeta } });
                                            // Update members
                                            members.forEach((m:any) => {
                                              const mMeta = { ...(m.metadata||{}), groupMemberOf: q.id };
                                              updateQuestion.mutate({ questionId: m.id, data: { metadata: mMeta } });
                                            });
                                          }}
                                        >Make Group</button>
                                      );
                                    })()}
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
                          <button type="button" className="text-xs px-2 py-1 border rounded" onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'fill_blank' })}>+ Add Blank</button>
                        </div>
                        {section.questions.filter((q: any) => q.questionType === 'fill_blank').sort((a: any,b: any)=>getNum(a)-getNum(b)).map((q: any, i: number) => (
                          <div key={`fb-row-${q.id}`} className="flex items-center gap-2 group">
                            <div className="w-10 text-xs text-gray-500">Q{q.questionNumber || q.order || i + 1}</div>
                            <input defaultValue={q.questionText || ''} placeholder="Question text" onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } })} className="flex-1 rounded-md border-gray-300 text-sm" />
                            <input defaultValue={q.correctAnswer || ''} placeholder="Answers e.g. red|crimson;white;blue|azure" onBlur={(e) => updateQuestion.mutate({ questionId: q.id, data: { correctAnswer: e.target.value } })} className="w-72 rounded-md border-gray-300 text-sm" />
                            <label className="flex items-center gap-1 text-[10px] text-gray-600 whitespace-nowrap pr-1">
                              <input
                                type="checkbox"
                                className="rounded border-gray-300"
                                defaultChecked={!!q.metadata?.singleNumber}
                                onChange={(e) => {
                                  const meta = { ...(q.metadata || {}) };
                                  if (e.target.checked) meta.singleNumber = true; else delete meta.singleNumber;
                                  updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } });
                                }}
                              />
                              Single #
                            </label>
                            <label className="flex items-center gap-1 text-[10px] text-gray-600 whitespace-nowrap pr-1" title="Treat this multi-blank as a conversation transcript (lighter line-height, speaker labels, no extra question header).">
                              <input
                                type="checkbox"
                                className="rounded border-gray-300"
                                defaultChecked={!!q.metadata?.conversation}
                                onChange={(e) => {
                                  const meta = { ...(q.metadata || {}) };
                                  if (e.target.checked) meta.conversation = true; else delete meta.conversation;
                                  updateQuestion.mutate({ questionId: q.id, data: { metadata: meta } });
                                }}
                              />
                              Conversation
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
                  const ddQuestions = section.questions.filter((q:any)=> q.questionType==='drag_drop');
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
                            onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'drag_drop', metadata: { layout: 'rows' }, questionText: 'Drag & Drop Group Instruction' })}
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
                                      <button type="button" className="text-[10px] px-2 py-0.5 border rounded border-green-300 text-green-700" onClick={() => createQuestion.mutate({ sectionId: section.id, questionType: 'drag_drop', metadata: { groupMemberOf: anchor.id }, questionText: 'New item' })}>Add Item</button>
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
                  </select>
                  <button className="text-xs px-2 py-1 border rounded" onClick={() => {
                    const sel = (document.getElementById(`add-type-${section.id}`) as HTMLSelectElement).value;
                    createQuestion.mutate({ sectionId: section.id, questionType: sel });
                  }}>+ Add Question</button>
                </div>
              </div>
              {(section.questions || []).filter((q: any) => q.questionType !== 'matching').map((q: any) => (
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
                      <option value="essay">Essay (Task 2)</option>
                      <option value="writing_task1">Writing Task 1</option>
                      <option value="short_answer">Short Answer</option>
                      <option value="speaking_task">Speaking</option>
                    </select>
                    </div>
                    <input defaultValue={q.questionText || ''} placeholder="Question text" onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { questionText: e.target.value } }); }} className="md:col-span-3 rounded-md border-gray-300" />
                    <input type="number" step="0.5" defaultValue={q.points || 1} onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { points: Number(e.target.value) } }); }} className="rounded-md border-gray-300" />
                    <input type="number" placeholder="Time (s)" defaultValue={q.timeLimitSeconds || ''} onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { timeLimitSeconds: Number(e.target.value) } }); }} className="rounded-md border-gray-300" />
                    <input placeholder="Explanation (optional)" defaultValue={q.explanation || ''} onChange={() => setStatus(q.id, 'dirty')} onBlur={(e) => { setStatus(q.id, 'saving'); updateQuestion.mutate({ questionId: q.id, data: { explanation: e.target.value } }); }} className="md:col-span-6 rounded-md border-gray-300" />
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
        ))}
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


