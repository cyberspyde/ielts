import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Calendar, Clock, BookOpen, CheckCircle } from 'lucide-react';
import { apiService } from '../../services/api';
import { tallyFillBlank, toMetadataObject } from '../../utils/resultMetrics';

const ExamResults: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['exam-results', sessionId],
    queryFn: async () => {
      const res = await apiService.get<any>(`/exams/sessions/${sessionId}/results`);
      return (res.data as any)?.results;
    },
    enabled: !!sessionId
  });

  const view = useMemo(() => {
    if (!data) return null;
    const answers = data.answers || [];
    const speakingFeedback = Array.isArray((data as any).speakingFeedback) ? (data as any).speakingFeedback : [];
    // Expand simple_table aggregated cells for stats
    let totalQuestions = 0;
    let correctQuestions = 0;
    let readingTotal = 0; let readingCorrect = 0;
    let listeningTotal = 0; let listeningCorrect = 0;
    answers.forEach((a: any) => {
      const metadataObj = toMetadataObject(a.questionMetadata);
      a.questionMetadata = metadataObj;
      const sa = a.studentAnswer;
      if (sa && typeof sa === 'object' && sa.type === 'simple_table') {
        let graded = Array.isArray(sa.graded) ? sa.graded : [];
        // Reconstruct graded breakdown if missing and metadata present
        if ((!graded || !graded.length) && a.questionMetadata?.simpleTable?.rows) {
          const metaRows = a.questionMetadata.simpleTable.rows;
            graded = [];
          metaRows.forEach((row:any[], ri:number)=> row.forEach((cell:any, ci:number)=>{
            if (cell?.type==='question') {
              const key = `${ri}_${ci}`;
              const val = sa.cells?.[key];
              graded.push({ key, questionType: cell.questionType, questionNumber: cell.questionNumber, studentAnswer: val, correctAnswer: cell.correctAnswer, points: cell.points||1, isCorrect: false });
            }
          }));
          // naive correctness (without backend grading) if correctAnswer & student available
          graded = graded.map((g:any)=>{
            let isCorrect = false;
            const norm = (v:any)=> String(v??'').trim().toLowerCase();
            if (g.correctAnswer) {
              if (g.questionType==='multiple_choice') {
                const exp = g.correctAnswer.split('|').map((s:string)=>norm(s));
                const got = norm(g.studentAnswer).split('|');
                const uniq=(arr:string[])=>Array.from(new Set(arr.filter(Boolean)));
                const eU=uniq(exp); const gU=uniq(got);
                isCorrect = eU.length===gU.length && eU.every(v=>gU.includes(v));
              } else if (g.questionType==='true_false') {
                const map:Record<string,string>={t:'true',f:'false',ng:'not given','notgiven':'not given'};
                isCorrect = (map[norm(g.studentAnswer)]||norm(g.studentAnswer)) === (map[norm(g.correctAnswer)]||norm(g.correctAnswer));
              } else {
                const variants = g.correctAnswer.split('|').map((s:string)=>norm(s));
                const rec = norm(g.studentAnswer);
                isCorrect = variants.includes(rec);
              }
            }
            return { ...g, isCorrect };
          });
          sa.graded = graded; // mutate local object for downstream use
        }
        // Fallback: if any graded entry still contains multi-answer group separated by ';', expand to individual blanks
        if (Array.isArray(sa.graded)) {
          const expanded: any[] = [];
          const norm = (v:any)=> String(v??'').trim().toLowerCase();
          sa.graded.forEach((g:any) => {
            if (g && typeof g.correctAnswer === 'string' && g.correctAnswer.includes(';') && !/_b\d+$/.test(g.key)) {
              const parts = g.correctAnswer.split(';').map((p:string)=>p.trim()).filter(Boolean);
              if (parts.length > 1) {
                // Build student tokens attempts
                let studentTokens: string[] = [];
                if (typeof g.studentAnswer === 'string') {
                  const attempts: string[][] = [g.studentAnswer.split(';'), g.studentAnswer.split(','), g.studentAnswer.split(/\s+/)];
                  for (const t of attempts) { const cleaned = t.map((s:string)=>s.trim()).filter(Boolean); if (cleaned.length === parts.length) { studentTokens = cleaned; break; } }
                  if (studentTokens.length === 0) {
                    // Heuristic 1: all parts identical and studentAnswer is that token repeated
                    const allSame = parts.every((p:string)=>p===parts[0]);
                    if (allSame) {
                      const token = parts[0];
                      if (g.studentAnswer === token.repeat(parts.length)) {
                        studentTokens = Array.from({length: parts.length}, ()=> token);
                      }
                    }
                  }
                  if (studentTokens.length === 0) {
                    // Heuristic 2: concatenate parts equals studentAnswer (ordered) – slice by part lengths
                    const totalLen = parts.reduce((acc:number,p:string)=>acc+p.length,0);
                    if (g.studentAnswer.length === totalLen) {
                      let offset = 0; const slices: string[] = [];
                      for (const p of parts) { slices.push(g.studentAnswer.slice(offset, offset + p.length)); offset += p.length; }
                      if (slices.join('') === g.studentAnswer) studentTokens = slices;
                    }
                  }
                } else if (Array.isArray(g.studentAnswer)) {
                  // Rare case: already array but not flattened; pad/truncate
                  studentTokens = (g.studentAnswer as any[]).slice(0, parts.length).map(v=>String(v));
                }
                const baseNum = (typeof g.questionNumber === 'number') ? g.questionNumber : undefined;
                parts.forEach((p: string, idx: number) => {
                  const studentVal = studentTokens[idx] ?? (idx===0 ? g.studentAnswer : undefined);
                  const variants = p.split('|').map((x:string)=>norm(x));
                  const rec = norm(studentVal);
                  let isCorrect = false;
                  if (g.questionType === 'multiple_choice') {
                    const got = rec.split('|').filter(Boolean); const uniq=(arr:string[])=>Array.from(new Set(arr)); const eU=uniq(variants); const gU=uniq(got); isCorrect = eU.length===gU.length && eU.every(v=>gU.includes(v));
                  } else if (g.questionType === 'true_false') {
                    const map:Record<string,string>={t:'true',f:'false',ng:'not given','notgiven':'not given'}; isCorrect = (map[rec]||rec)===(map[variants[0]]||variants[0]);
                  } else {
                    isCorrect = variants.includes(rec);
                  }
                  expanded.push({
                    ...g,
                    key: `${g.key}_b${idx}`,
                    correctAnswer: p,
                    studentAnswer: studentVal,
                    isCorrect,
                    questionNumber: baseNum !== undefined ? baseNum + idx : g.questionNumber
                  });
                });
                return; // skip original aggregated entry
              }
            }
            expanded.push(g);
          });
          sa.graded = expanded;
        }
        const counted = sa.graded?.length || 0;
        const correct = (sa.graded || []).filter((c: any) => c.isCorrect).length;
        totalQuestions += counted;
        correctQuestions += correct;
        if (a.sectionType === 'reading') { readingTotal += counted; readingCorrect += correct; }
        if (a.sectionType === 'listening') { listeningTotal += counted; listeningCorrect += correct; }
      } else if (a.questionType === 'fill_blank' && Array.isArray(sa)) {
        const { total, correct } = tallyFillBlank({
          studentAnswer: sa,
          correctAnswer: a.correctAnswer,
          questionMetadata: metadataObj,
          isCorrect: a.isCorrect,
        });
        totalQuestions += total;
        correctQuestions += correct;
        if (a.sectionType === 'reading') { readingTotal += total; readingCorrect += correct; }
        if (a.sectionType === 'listening') { listeningTotal += total; listeningCorrect += correct; }
      } else {
        totalQuestions += 1;
        const isC = !!a.isCorrect;
        if (isC) correctQuestions += 1;
        if (a.sectionType === 'reading') { readingTotal += 1; if (isC) readingCorrect += 1; }
        if (a.sectionType === 'listening') { listeningTotal += 1; if (isC) listeningCorrect += 1; }
      }
    });
    // IELTS band helpers
    const listeningBandFromCorrect = (c: number): number => {
      if (c >= 39) return 9.0; if (c >= 37) return 8.5; if (c >= 35) return 8.0; if (c >= 32) return 7.5; if (c >= 30) return 7.0;
      if (c >= 26) return 6.5; if (c >= 23) return 6.0; if (c >= 18) return 5.5; if (c >= 16) return 5.0; if (c >= 13) return 4.5;
      if (c >= 10) return 4.0; if (c >= 7) return 3.5; if (c >= 5) return 3.0; if (c >= 3) return 2.5; return 2.0;
    };
    const readingBandFromCorrect = (c: number, examType: string | undefined): number => {
      const acad = examType === 'academic';
      if (acad) {
        if (c >= 39) return 9.0; if (c >= 37) return 8.5; if (c >= 35) return 8.0; if (c >= 33) return 7.5; if (c >= 30) return 7.0;
        if (c >= 27) return 6.5; if (c >= 23) return 6.0; if (c >= 19) return 5.5; if (c >= 15) return 5.0; if (c >= 13) return 4.5;
        if (c >= 10) return 4.0; if (c >= 8) return 3.5; if (c >= 6) return 3.0; if (c >= 4) return 2.5; return 2.0;
      } else {
        if (c >= 40) return 9.0; if (c >= 39) return 8.5; if (c >= 37) return 8.0; if (c >= 36) return 7.5; if (c >= 34) return 7.0;
        if (c >= 32) return 6.5; if (c >= 30) return 6.0; if (c >= 27) return 5.5; if (c >= 23) return 5.0; if (c >= 19) return 4.5;
        if (c >= 15) return 4.0; if (c >= 12) return 3.5; if (c >= 9) return 3.0; if (c >= 6) return 2.5; return 2.0;
      }
    };
    const examType = data.exam?.type || data.session?.examType;
  // Cap reading totals at 40 for IELTS scale consistency
  const cappedReadingTotal = Math.min(readingTotal, 40);
  const cappedReadingCorrect = Math.min(readingCorrect, cappedReadingTotal);
  const readingBand = cappedReadingTotal > 0 ? readingBandFromCorrect(cappedReadingCorrect, examType) : undefined;
  const listeningBand = listeningTotal > 0 ? listeningBandFromCorrect(listeningCorrect) : undefined;
    return {
      examTitle: data.exam?.title,
      completedAt: data.session?.submittedAt,
      durationMinutes: data.exam?.durationMinutes,
      totalQuestions,
      correctAnswers: correctQuestions,
  readingTotal: cappedReadingTotal,
  readingCorrect: cappedReadingCorrect,
      listeningTotal,
      listeningCorrect,
      readingBand,
      listeningBand,
      answers,
      speakingFeedback,
    };
  }, [data]);

  const renderStudentAnswer = (ans: any) => {
    if (ans == null) return '—';
    if (typeof ans === 'string' || typeof ans === 'number') return String(ans);
    if (Array.isArray(ans)) return ans.join(', ');
    if (typeof ans === 'object') {
      if (ans.type === 'simple_table') {
        const graded: any[] = Array.isArray(ans.graded) ? ans.graded : [];
        const correct = graded.filter((g:any)=>g.isCorrect).length;
        return `Simple Table: ${correct}/${graded.length} correct`;
      }
      return JSON.stringify(ans);
    }
    return String(ans);
  };

  // no-op helpers removed

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Results not found</h2>
          <p className="text-gray-600">Make sure the session was submitted successfully.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Exam Results</h1>
          <p className="text-gray-600">{view.examTitle}</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
            <div className="flex items-center text-sm text-gray-600">
              <Calendar className="h-4 w-4 mr-2" />
              <span>Completed: {view.completedAt ? new Date(view.completedAt).toLocaleDateString() : '—'}</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <Clock className="h-4 w-4 mr-2" />
              <span>Duration: {view.durationMinutes ?? '—'} minutes</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <BookOpen className="h-4 w-4 mr-2" />
              <span>Questions: {view.totalQuestions}</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <CheckCircle className="h-4 w-4 mr-2" />
              <span>Correct: {view.correctAnswers} / {view.totalQuestions}</span>
            </div>
          </div>
          {(view.listeningTotal || view.readingTotal) && (
            <div className="mt-3 text-sm text-gray-800 space-y-1">
              {view.listeningTotal ? (
                <div>Listening: {view.listeningCorrect}/{view.listeningTotal}{typeof view.listeningBand === 'number' ? ` — Band ${view.listeningBand.toFixed(1)}` : ''}</div>
              ) : null}
              {view.readingTotal ? (
                <div>Reading: {view.readingCorrect}/{view.readingTotal}{typeof view.readingBand === 'number' ? ` — Band ${view.readingBand.toFixed(1)}` : ''}</div>
              ) : null}
            </div>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => window.print()} className="text-sm text-blue-600 hover:text-blue-500">Print Session Details</button>
          </div>
        </div>

        {Array.isArray(view.speakingFeedback) && view.speakingFeedback.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Speaking Feedback</h3>
            <ul className="space-y-2">
              {view.speakingFeedback.map((f:any, idx:number) => (
                <li key={idx} className="border rounded p-3">
                  <div className="text-xs text-gray-600 mb-1">{f.type === 'speaking_task' ? 'Speaking Task' : (f.type || 'Speaking')} — Band: {f.band ?? '—'}</div>
                  <div className="text-sm text-gray-800 mb-1">{f.questionText}</div>
                  {f.comments && <div className="text-gray-800 whitespace-pre-wrap">{f.comments}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Print-only details (no correctness or correct answers on screen) */}
        <div className="hidden print:block bg-white rounded-lg border p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Session Details</h3>
          <div className="space-y-3">
            {(() => {
              const items: { key: string; heading: string; a: any }[] = [];
              let nextNumber = 1;
              view.answers.forEach((a: any) => {
                const explicit = a.questionMetadata?.questionNumber || a.questionNumber;
                let displayNum: number;
                if (typeof explicit === 'number' && explicit >= nextNumber) { displayNum = explicit; nextNumber = explicit + 1; }
                else { displayNum = nextNumber; nextNumber += 1; }
                items.push({ key: a.questionId, heading: `Q${displayNum}. ${a.questionText}`, a });
              });
              return items.map(({ key, heading, a }) => (
                <div key={key} className="p-3 border border-gray-200 rounded">
                  <div className="font-medium text-gray-900">{heading}</div>
                  <div className="mt-1 text-sm text-gray-700">Your answer: <span className="text-gray-900">{renderStudentAnswer(a.studentAnswer)}</span></div>
                </div>
              ));
            })()}
          </div>
        </div>

        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/exams')} className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700">Take Another Exam</button>
          <button onClick={() => navigate('/dashboard')} className="px-6 py-3 border border-gray-300 rounded hover:bg-gray-50">Back to Dashboard</button>
        </div>
      </div>
    </div>
  );
};

export default ExamResults;
