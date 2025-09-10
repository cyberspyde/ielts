import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Calendar, Clock, BookOpen, CheckCircle, XCircle } from 'lucide-react';
import { apiService } from '../../services/api';

const ExamResults: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);

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
    // Expand simple_table aggregated cells for stats
    let totalQuestions = 0;
    let correctQuestions = 0;
    answers.forEach((a: any) => {
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
        totalQuestions += (sa.graded?.length || 0);
        correctQuestions += (sa.graded || []).filter((c: any) => c.isCorrect).length;
      } else {
        totalQuestions += 1;
        if (a.isCorrect) correctQuestions += 1;
      }
    });
    const overallPercent = typeof data.session?.percentageScore === 'number'
      ? data.session.percentageScore
      : (totalQuestions ? (correctQuestions / totalQuestions) * 100 : 0);
    return {
      examTitle: data.exam?.title,
      completedAt: data.session?.submittedAt,
      durationMinutes: data.exam?.durationMinutes,
      totalQuestions,
      correctAnswers: correctQuestions,
      percentage: overallPercent,
      answers,
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

  const labelForType = (t: string) => {
    switch (t) {
      case 'fill_blank': return 'Fill Blank';
      case 'multiple_choice': return 'MCQ';
      case 'true_false': return 'T/F';
      case 'short_answer': return 'Short Ans';
      default: return t || '—';
    }
  };

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
              <span>Correct: {view.correctAnswers} ({Math.round(view.percentage)}%)</span>
            </div>
          </div>
          <div className="mt-4">
            <button onClick={() => setShowDetails(!showDetails)} className="text-sm text-blue-600 hover:text-blue-500">
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
          </div>
        </div>

        {showDetails && (
          <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Answers</h3>
            <div className="space-y-3">
              {view.answers.map((a: any, idx: number) => (
                <div key={idx} className="p-4 border border-gray-200 rounded">
                  <div className="flex items-start justify-between">
                    <div className="font-medium text-gray-900">Q{idx + 1}. {a.questionText}</div>
                    {a.isCorrect ? <CheckCircle className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
                  </div>
                  <div className="mt-2 text-sm space-y-1">
                    <div className="text-gray-600">Your answer: <span className="text-gray-900">{renderStudentAnswer(a.studentAnswer)}</span></div>
                    {(() => {
                      const sa = a.studentAnswer;
                      if (sa && typeof sa === 'object' && sa.type === 'simple_table' && Array.isArray(sa.graded)) {
                        return (
                          <div className="mt-2">
                            <div className="text-gray-700 font-medium text-xs mb-1">Simple Table Detail</div>
                            <div className="overflow-auto">
                              <table className="min-w-[400px] text-[11px] border border-gray-200">
                                <thead>
                                  <tr className="bg-gray-50">
                                    <th className="px-2 py-1 border">Cell</th>
                                    <th className="px-2 py-1 border">Type</th>
                                    <th className="px-2 py-1 border">#</th>
                                    <th className="px-2 py-1 border">Your Answer</th>
                                    <th className="px-2 py-1 border">Correct</th>
                                    <th className="px-2 py-1 border">Pts</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sa.graded.map((g:any, i:number)=> (
                                    <tr key={i} className={g.isCorrect ? 'bg-green-50' : 'bg-red-50'}>
                                      <td className="px-2 py-1 border font-mono">{g.key}</td>
                                      <td className="px-2 py-1 border">{labelForType(g.questionType)}</td>
                                      <td className="px-2 py-1 border text-center">{g.questionNumber ?? '—'}</td>
                                      <td className="px-2 py-1 border">{g.studentAnswer ?? '—'}</td>
                                      <td className="px-2 py-1 border">{g.correctAnswer ?? '—'}</td>
                                      <td className="px-2 py-1 border text-center">{g.isCorrect ? g.points : 0}/{g.points}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                          </div>
                          </div>
                        );
                      }
                      return <div className="text-gray-600">Correct answer: <span className="text-gray-900">{a.correctAnswer ?? '—'}</span></div>;
                    })()}
                  </div>
                  {a.explanation && (
                    <div className="mt-2 p-2 bg-blue-50 rounded text-sm text-blue-800">{a.explanation}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/exams')} className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700">Take Another Exam</button>
          <button onClick={() => navigate('/dashboard')} className="px-6 py-3 border border-gray-300 rounded hover:bg-gray-50">Back to Dashboard</button>
        </div>
      </div>
    </div>
  );
};

export default ExamResults;
