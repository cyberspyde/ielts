import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

import { apiService } from '../../services/api';
// Matching builder moved to Edit page

type ExamPayload = {
  title: string;
  description?: string;
  examType: 'academic' | 'general_training';
  durationMinutes: number;
  passingScore?: number;
  maxAttempts?: number;
  instructions?: string;
};

type SectionDraft = {
  sectionType: 'listening' | 'reading' | 'writing' | 'speaking';
  title: string;
  description?: string;
  maxScore: number;
  sectionOrder: number;
  instructions?: string;
  passageText?: string;
  // Per-section default groups to create (can be empty => none)
  defaultGroups?: QuestionGroup[];
};

type QuestionGroup = {
  questionType: 'multiple_choice' | 'true_false' | 'fill_blank' | 'matching' | 'short_answer' | 'essay' | 'speaking' | 'drag_drop' | 'speaking_task';
  start: number | '';
  end: number | '';
  points?: number | '';
  questionText?: string;
  options?: Array<{ letter?: string; text?: string } | string>;
  correctAnswers?: Array<string>;
};

const AdminExamCreate: React.FC = () => {
  const navigate = useNavigate();

  // Step 1: exam meta
  const [meta, setMeta] = useState<ExamPayload>({
    title: '',
    description: '',
    examType: 'academic',
    durationMinutes: 180,
    passingScore: 6.5,
    maxAttempts: 3,
    instructions: ''
  });

  // Step 2: sections preset (toggleable)
  const [sections, setSections] = useState<SectionDraft[]>([
    { sectionType: 'reading', title: 'Reading', maxScore: 9, sectionOrder: 1, defaultGroups: [] },
    { sectionType: 'listening', title: 'Listening', maxScore: 9, sectionOrder: 2, defaultGroups: [] },
    { sectionType: 'writing', title: 'Writing', maxScore: 9, sectionOrder: 3, defaultGroups: [] },
  ]);

  // Per-section default groups are configured inline in each section


  const createExamMutation = useMutation({
    mutationFn: async () => {
      // 1) Create exam
      const examRes = await apiService.post<{ examId: string }>('/admin/exams', meta);
      if (!examRes.success || !examRes.data) throw new Error(examRes.message || 'Failed to create exam');
      const examId = (examRes.data as any).examId as string;

      // 2) Create sections
      const sectionsPayload = sections.map((s) => {
        const effectiveTitle = (s.title || '').trim().length >= 2
          ? s.title.trim()
          : s.sectionType.charAt(0).toUpperCase() + s.sectionType.slice(1);
        return { ...s, title: effectiveTitle } as any;
      });
      const sectionsRes = await apiService.post<{ sections: Array<{ id: string; sectionType: string; title: string }> }>(
        `/admin/exams/${examId}/sections`,
        { sections: sectionsPayload }
      );
      if (!sectionsRes.success || !sectionsRes.data) throw new Error(sectionsRes.message || 'Failed to create sections');

      // Pick IDs for listening/reading/writing/speaking
      const createdSections = (sectionsRes.data as any).sections as Array<any>;
      // No pre-picking; iterate alongside drafts

      // 3) Bulk questions per section (optional / if groups provided)
      for (let i = 0; i < createdSections.length && i < sections.length; i++) {
        const draft = sections[i];
        const groups = (draft.defaultGroups || [])
          .map(g => ({
            ...g,
            start: typeof g.start === 'string' ? Number(g.start) : g.start,
            end: typeof g.end === 'string' ? Number(g.end) : g.end,
            points: typeof g.points === 'string' ? Number(g.points) : (g.points ?? 1),
          }))
          .filter(g => Number.isFinite(g.start) && Number.isFinite(g.end) && (g.end as number) >= (g.start as number));
        if (groups.length) {
          await apiService.post(`/admin/exams/${examId}/questions/bulk`, {
            sectionId: createdSections[i].id,
            groups,
          });
        }
      }

      return examId;
    },
  onSuccess: () => {
      toast.success('Exam created successfully');
      navigate('/admin/exams');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to create exam');
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createExamMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Create IELTS Exam</h1>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Exam Meta */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Exam Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input className="w-full rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select className="w-full rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500" value={meta.examType} onChange={(e) => setMeta({ ...meta, examType: e.target.value as any })}>
                  <option value="academic">Academic</option>
                  <option value="general_training">General Training</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration (minutes)</label>
                <input type="number" min={1} className="w-full rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500" value={meta.durationMinutes} onChange={(e) => setMeta({ ...meta, durationMinutes: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Passing Score</label>
                <input type="number" step="0.5" className="w-full rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500" value={meta.passingScore} onChange={(e) => setMeta({ ...meta, passingScore: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Attempts</label>
                <input type="number" min={1} className="w-full rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500" value={meta.maxAttempts} onChange={(e) => setMeta({ ...meta, maxAttempts: Number(e.target.value) })} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea className="w-full rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500" rows={3} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })}></textarea>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
                <textarea className="w-full rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500" rows={3} value={meta.instructions} onChange={(e) => setMeta({ ...meta, instructions: e.target.value })}></textarea>
              </div>
            </div>
          </div>

          {/* Sections */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Sections</h2>
            <div className="space-y-4">
              {sections.map((s, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-7 gap-4">
                  <button type="button" onClick={() => setSections(prev => prev.filter((_, i) => i !== idx))} className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">Remove</button>
                  <select className="rounded-md border-gray-300" value={s.sectionType} onChange={(e) => {
                    const next = [...sections];
                    const newType = e.target.value as any;
                    next[idx] = { ...s, sectionType: newType };
                    setSections(next);
                  }}>
                    <option value="listening">Listening</option>
                    <option value="reading">Reading</option>
                    <option value="writing">Writing</option>
                    <option value="speaking">Speaking</option>
                  </select>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Section Title</label>
                    <input className="rounded-md border-gray-300 w-full" placeholder="Title" value={s.title} onChange={(e) => {
                      const next = [...sections];
                      next[idx] = { ...s, title: e.target.value };
                      setSections(next);
                    }} />
                  </div>
                  {/* Per-section duration removed (global exam duration applies) */}
                  <div className="rounded-md border-gray-300">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Max Score</label>
                    <input type="number" step="0.5" placeholder="Max Score" value={s.maxScore} onChange={(e) => {
                      const next = [...sections];
                      next[idx] = { ...s, maxScore: Number(e.target.value) };
                      setSections(next);
                    }} />
                  </div>
                  <div className="rounded-md border-gray-300">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Order</label>
                    <input type="number" placeholder="Order" value={s.sectionOrder} onChange={(e) => {
                      const next = [...sections];
                      next[idx] = { ...s, sectionOrder: Number(e.target.value) };
                      setSections(next);
                    }} />
                  </div>
                  {/* Listening audio now set at exam level; section audio input removed */}
                  {s.sectionType === 'reading' && (
                    <div className="rounded-md border-gray-300 md:col-span-2">
                      <label className="block text-xs font-medium text-gray-700 mb-1">Passage text</label>
                      <textarea placeholder="Passage text" rows={2} value={s.passageText || ''} onChange={(e) => { const next = [...sections]; next[idx] = { ...s, passageText: e.target.value }; setSections(next); }} />
                    </div>
                  )}
                  {/* Default groups editor below replaces the single toggle */}
                  <div className="rounded-md border-gray-300 md:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Section instructions (optional)</label>
                    <textarea placeholder="Section instructions (optional)" rows={2} value={s.instructions || ''} onChange={(e) => { const next = [...sections]; next[idx] = { ...s, instructions: e.target.value }; setSections(next); }} />
                  </div>
                  {/* Per-section default groups */}
                  <div className="md:col-span-7 border rounded p-3">
                    <div className="text-sm font-medium text-gray-800 mb-2">Default questions for this section (optional)</div>
                    <div className="space-y-3">
                      {(s.defaultGroups || []).map((g, gi) => (
                        <div key={gi} className="grid grid-cols-1 md:grid-cols-12 gap-x-6 gap-y-3 items-start">
                          <div className="md:col-span-3">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                            <select className="rounded-md border-gray-300" value={g.questionType} onChange={(e) => {
                              const next = [...sections];
                              const groups = [...(s.defaultGroups || [])];
                              groups[gi] = { ...g, questionType: e.target.value as any };
                              next[idx] = { ...s, defaultGroups: groups };
                              setSections(next);
                            }}>
                              <option value="multiple_choice">Multiple Choice</option>
                              <option value="true_false">True/False/NG</option>
                              <option value="fill_blank">Fill in the Blank</option>
                              <option value="short_answer">Short Answer</option>
                              <option value="drag_drop">Drag & Drop</option>
                              <option value="matching">Heading Matching</option>
                              <option value="essay">Essay</option>
                              <option value="speaking_task">Speaking</option>
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Start</label>
                            <input type="number" className="rounded-md border-gray-300 w-full" placeholder="Start" value={g.start as any} onChange={(e) => {
                              const next = [...sections];
                              const groups = [...(s.defaultGroups || [])];
                              const val = e.target.value;
                              groups[gi] = { ...g, start: val === '' ? '' : Number(val) };
                              next[idx] = { ...s, defaultGroups: groups };
                              setSections(next);
                            }} />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-700 mb-1">End</label>
                            <input type="number" className="rounded-md border-gray-300 w-full" placeholder="End" value={g.end as any} onChange={(e) => {
                              const next = [...sections];
                              const groups = [...(s.defaultGroups || [])];
                              const val = e.target.value;
                              groups[gi] = { ...g, end: val === '' ? '' : Number(val) };
                              next[idx] = { ...s, defaultGroups: groups };
                              setSections(next);
                            }} />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Points</label>
                            <input type="number" step="0.5" className="rounded-md border-gray-300 w-full" placeholder="Points" value={(g.points as any) ?? ''} onChange={(e) => {
                              const next = [...sections];
                              const groups = [...(s.defaultGroups || [])];
                              const val = e.target.value;
                              groups[gi] = { ...g, points: val === '' ? '' : Number(val) };
                              next[idx] = { ...s, defaultGroups: groups };
                              setSections(next);
                            }} />
                          </div>
                          <div className="md:col-span-3">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Default question text (optional)</label>
                            <input className="rounded-md border-gray-300 w-full" placeholder="Default question text (optional)" value={g.questionText || ''} onChange={(e) => {
                              const next = [...sections];
                              const groups = [...(s.defaultGroups || [])];
                              groups[gi] = { ...g, questionText: e.target.value };
                              next[idx] = { ...s, defaultGroups: groups };
                              setSections(next);
                            }} />
                          </div>
                          <button type="button" onClick={() => {
                            const next = [...sections];
                            const groups = (s.defaultGroups || []).filter((_, i) => i !== gi);
                            next[idx] = { ...s, defaultGroups: groups };
                            setSections(next);
                          }} className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded">Remove</button>
                        </div>
                      ))}
                      <button type="button" onClick={() => {
                        const next = [...sections];
                        const groups = [...(s.defaultGroups || [])];
                        groups.push({ questionType: 'multiple_choice', start: 1, end: 1, points: 1 });
                        next[idx] = { ...s, defaultGroups: groups };
                        setSections(next);
                      }} className="px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded hover:bg-blue-50">Add group</button>
                    </div>
                  </div>
                </div>
              ))}
              <div>
                <button type="button" onClick={() => setSections(prev => [...prev, { sectionType: 'reading', title: 'New Section', maxScore: 9, sectionOrder: prev.length + 1, defaultGroups: [] }])} className="px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded hover:bg-blue-50">Add Section</button>
              </div>
            </div>
          </div>

          {/* Global bulk cards removed from creation. Configure default groups per section above. */}

          <div className="flex justify-end gap-3">
            <button type="button" className="px-4 py-2 rounded-md border border-gray-300 bg-white text-gray-700" onClick={() => navigate('/admin/exams')}>Cancel</button>
            <button type="submit" disabled={createExamMutation.isPending} className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {createExamMutation.isPending ? 'Creating…' : 'Create Exam'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminExamCreate;


