import React, { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

import { apiService } from '../../services/api';

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
  durationMinutes: number;
  maxScore: number;
  sectionOrder: number;
  instructions?: string;
  audioUrl?: string;
  passageText?: string;
};

type QuestionGroup = {
  questionType: 'multiple_choice' | 'true_false' | 'fill_blank' | 'matching' | 'short_answer' | 'essay' | 'speaking';
  start: number;
  end: number;
  points?: number;
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
    { sectionType: 'reading', title: 'Reading', durationMinutes: 60, maxScore: 9, sectionOrder: 1 },
    { sectionType: 'listening', title: 'Listening', durationMinutes: 30, maxScore: 9, sectionOrder: 2 },
    { sectionType: 'writing', title: 'Writing', durationMinutes: 60, maxScore: 9, sectionOrder: 3 },
  ]);

  // Step 3: bulk groups per section
  const [readingGroups, setReadingGroups] = useState<QuestionGroup[]>([
    { questionType: 'matching', start: 1, end: 8, points: 1, questionText: '' },
    { questionType: 'multiple_choice', start: 9, end: 13, points: 1, questionText: '' },
    { questionType: 'true_false', start: 14, end: 20, points: 1, questionText: '' },
    { questionType: 'fill_blank', start: 21, end: 22, points: 1, questionText: '' },
  ]);
  const [listeningGroups, setListeningGroups] = useState<QuestionGroup[]>([
    { questionType: 'multiple_choice', start: 1, end: 10, points: 1 },
  ]);
  const [writingGroups, setWritingGroups] = useState<QuestionGroup[]>([
    { questionType: 'essay', start: 1, end: 2, points: 0 },
  ]);

  const hasSection = useMemo(() => ({
    reading: sections.some(s => s.sectionType === 'reading'),
    listening: sections.some(s => s.sectionType === 'listening'),
    writing: sections.some(s => s.sectionType === 'writing'),
  }), [sections]);

  const createExamMutation = useMutation({
    mutationFn: async () => {
      // 1) Create exam
      const examRes = await apiService.post<{ examId: string }>('/admin/exams', meta);
      if (!examRes.success || !examRes.data) throw new Error(examRes.message || 'Failed to create exam');
      const examId = (examRes.data as any).examId as string;

      // 2) Create sections
      const sectionsRes = await apiService.post<{ sections: Array<{ id: string }> }>(
        `/admin/exams/${examId}/sections`,
        { sections }
      );
      if (!sectionsRes.success || !sectionsRes.data) throw new Error(sectionsRes.message || 'Failed to create sections');

      // Pick IDs for listening/reading/writing
      const listening = (sectionsRes.data as any).sections.find((s: any) => s.sectionType === 'listening');
      const reading = (sectionsRes.data as any).sections.find((s: any) => s.sectionType === 'reading');
      const writing = (sectionsRes.data as any).sections.find((s: any) => s.sectionType === 'writing');

      // 3) Bulk questions per section (optional / if groups provided)
      if (reading && readingGroups.length) {
        await apiService.post(`/admin/exams/${examId}/questions/bulk`, {
          sectionId: reading.id,
          groups: readingGroups,
        });
      }
      if (listening && listeningGroups.length) {
        await apiService.post(`/admin/exams/${examId}/questions/bulk`, {
          sectionId: listening.id,
          groups: listeningGroups,
        });
      }
      if (writing && writingGroups.length) {
        await apiService.post(`/admin/exams/${examId}/questions/bulk`, {
          sectionId: writing.id,
          groups: writingGroups,
        });
      }

      return examId;
    },
    onSuccess: (examId) => {
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
                <div key={idx} className="grid grid-cols-1 md:grid-cols-7 gap-3">
                  <button type="button" onClick={() => setSections(prev => prev.filter((_, i) => i !== idx))} className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">Remove</button>
                  <select className="rounded-md border-gray-300" value={s.sectionType} onChange={(e) => {
                    const next = [...sections];
                    next[idx] = { ...s, sectionType: e.target.value as any };
                    setSections(next);
                  }}>
                    <option value="listening">Listening</option>
                    <option value="reading">Reading</option>
                    <option value="writing">Writing</option>
                    <option value="speaking">Speaking</option>
                  </select>
                  <input className="rounded-md border-gray-300 md:col-span-2" placeholder="Title" value={s.title} onChange={(e) => {
                    const next = [...sections];
                    next[idx] = { ...s, title: e.target.value };
                    setSections(next);
                  }} />
                  <input type="number" className="rounded-md border-gray-300" placeholder="Duration" value={s.durationMinutes} onChange={(e) => {
                    const next = [...sections];
                    next[idx] = { ...s, durationMinutes: Number(e.target.value) };
                    setSections(next);
                  }} />
                  <input type="number" step="0.5" className="rounded-md border-gray-300" placeholder="Max Score" value={s.maxScore} onChange={(e) => {
                    const next = [...sections];
                    next[idx] = { ...s, maxScore: Number(e.target.value) };
                    setSections(next);
                  }} />
                  <input type="number" className="rounded-md border-gray-300" placeholder="Order" value={s.sectionOrder} onChange={(e) => {
                    const next = [...sections];
                    next[idx] = { ...s, sectionOrder: Number(e.target.value) };
                    setSections(next);
                  }} />
                  {s.sectionType === 'listening' && (
                    <input className="rounded-md border-gray-300 md:col-span-2" placeholder="Audio URL (optional)" value={s.audioUrl || ''} onChange={(e) => { const next = [...sections]; next[idx] = { ...s, audioUrl: e.target.value }; setSections(next); }} />
                  )}
                  {s.sectionType === 'reading' && (
                    <textarea className="rounded-md border-gray-300 md:col-span-2" placeholder="Passage text" rows={2} value={s.passageText || ''} onChange={(e) => { const next = [...sections]; next[idx] = { ...s, passageText: e.target.value }; setSections(next); }} />
                  )}
                  <textarea className="rounded-md border-gray-300 md:col-span-2" placeholder="Section instructions (optional)" rows={2} value={s.instructions || ''} onChange={(e) => { const next = [...sections]; next[idx] = { ...s, instructions: e.target.value }; setSections(next); }} />
                </div>
              ))}
              <div>
                <button type="button" onClick={() => setSections(prev => [...prev, { sectionType: 'reading', title: 'New Section', durationMinutes: 60, maxScore: 9, sectionOrder: prev.length + 1 }])} className="px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded hover:bg-blue-50">Add Section</button>
              </div>
            </div>
          </div>

          {/* Bulk Questions Presets */}
          {hasSection.reading && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Bulk Questions (Reading)</h2>
            <p className="text-sm text-gray-600 mb-4">Define ranges like 1-8 matching, 9-13 multiple choice, etc.</p>
            <div className="space-y-3">
              {readingGroups.map((g, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-6 gap-2">
                  <select className="rounded-md border-gray-300" value={g.questionType} onChange={(e) => {
                    const next = [...readingGroups]; next[i] = { ...g, questionType: e.target.value as any }; setReadingGroups(next);
                  }}>
                    <option value="matching">Heading/Paragraph Matching</option>
                    <option value="multiple_choice">Multiple Choice</option>
                    <option value="true_false">True/False/NG</option>
                    <option value="fill_blank">Fill in the Blank</option>
                    <option value="short_answer">Short Answer</option>
                  </select>
                  <input type="number" className="rounded-md border-gray-300" placeholder="Start" value={g.start} onChange={(e) => { const next = [...readingGroups]; next[i] = { ...g, start: Number(e.target.value) }; setReadingGroups(next); }} />
                  <input type="number" className="rounded-md border-gray-300" placeholder="End" value={g.end} onChange={(e) => { const next = [...readingGroups]; next[i] = { ...g, end: Number(e.target.value) }; setReadingGroups(next); }} />
                  <input type="number" step="0.5" className="rounded-md border-gray-300" placeholder="Points" value={g.points || 1} onChange={(e) => { const next = [...readingGroups]; next[i] = { ...g, points: Number(e.target.value) }; setReadingGroups(next); }} />
                  <input className="rounded-md border-gray-300 md:col-span-2" placeholder="Default question text (optional)" value={g.questionText || ''} onChange={(e) => { const next = [...readingGroups]; next[i] = { ...g, questionText: e.target.value }; setReadingGroups(next); }} />
                  {/* Advanced: options and correct answers (comma-separated) */}
                  <input className="rounded-md border-gray-300 md:col-span-3" placeholder="Options (comma-separated, e.g., A,B,C or A:Heading A,B:Heading B)" value={(g.options as any)?.map((o:any)=> typeof o==='string'? o : `${o.letter||''}:${o.text||''}`).join(',') || ''} onChange={(e) => {
                    const raw = e.target.value.trim();
                    const parsed = raw ? raw.split(',').map((item) => {
                      const [letter, text] = item.split(':');
                      if (text !== undefined) return { letter: letter.trim(), text: text.trim() };
                      return item.trim();
                    }) : [];
                    const next = [...readingGroups]; next[i] = { ...g, options: parsed as any } as any; setReadingGroups(next);
                  }} />
                  <input className="rounded-md border-gray-300 md:col-span-3" placeholder="Correct answers per question (comma-separated, aligns with range)" value={(g.correctAnswers || []).join(',')} onChange={(e) => {
                    const next = [...readingGroups]; next[i] = { ...g, correctAnswers: e.target.value ? e.target.value.split(',').map(s=>s.trim()) : [] }; setReadingGroups(next);
                  }} />
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Listening Bulk */}
          {hasSection.listening && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Bulk Questions (Listening)</h2>
            <div className="space-y-3">
              {listeningGroups.map((g, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-6 gap-2">
                  <select className="rounded-md border-gray-300" value={g.questionType} onChange={(e) => { const next = [...listeningGroups]; next[i] = { ...g, questionType: e.target.value as any }; setListeningGroups(next); }}>
                    <option value="multiple_choice">Multiple Choice</option>
                    <option value="matching">Matching</option>
                    <option value="fill_blank">Fill in the Blank</option>
                  </select>
                  <input type="number" className="rounded-md border-gray-300" placeholder="Start" value={g.start} onChange={(e) => { const next = [...listeningGroups]; next[i] = { ...g, start: Number(e.target.value) }; setListeningGroups(next); }} />
                  <input type="number" className="rounded-md border-gray-300" placeholder="End" value={g.end} onChange={(e) => { const next = [...listeningGroups]; next[i] = { ...g, end: Number(e.target.value) }; setListeningGroups(next); }} />
                  <input type="number" step="0.5" className="rounded-md border-gray-300" placeholder="Points" value={g.points || 1} onChange={(e) => { const next = [...listeningGroups]; next[i] = { ...g, points: Number(e.target.value) }; setListeningGroups(next); }} />
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Writing Bulk */}
          {hasSection.writing && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Bulk Questions (Writing)</h2>
            <div className="space-y-3">
              {writingGroups.map((g, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-6 gap-2">
                  <select className="rounded-md border-gray-300" value={g.questionType} onChange={(e) => { const next = [...writingGroups]; next[i] = { ...g, questionType: e.target.value as any }; setWritingGroups(next); }}>
                    <option value="essay">Task Prompts</option>
                  </select>
                  <input type="number" className="rounded-md border-gray-300" placeholder="Start" value={g.start} onChange={(e) => { const next = [...writingGroups]; next[i] = { ...g, start: Number(e.target.value) }; setWritingGroups(next); }} />
                  <input type="number" className="rounded-md border-gray-300" placeholder="End" value={g.end} onChange={(e) => { const next = [...writingGroups]; next[i] = { ...g, end: Number(e.target.value) }; setWritingGroups(next); }} />
                  <input type="number" step="0.5" className="rounded-md border-gray-300" placeholder="Points" value={g.points || 0} onChange={(e) => { const next = [...writingGroups]; next[i] = { ...g, points: Number(e.target.value) }; setWritingGroups(next); }} />
                </div>
              ))}
            </div>
          </div>
          )}

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


