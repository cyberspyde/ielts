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
    const totalQuestions = answers.length;
    const correctAnswers = answers.filter((a: any) => a.isCorrect).length;
    const overallPercent = typeof data.session?.percentageScore === 'number'
      ? data.session.percentageScore
      : (totalQuestions ? (correctAnswers / totalQuestions) * 100 : 0);
    return {
      examTitle: data.exam?.title,
      completedAt: data.session?.submittedAt,
      durationMinutes: data.exam?.durationMinutes,
      totalQuestions,
      correctAnswers,
      percentage: overallPercent,
      answers,
    };
  }, [data]);

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
                  <div className="mt-2 text-sm">
                    <div className="text-gray-600">Your answer: <span className="text-gray-900">{Array.isArray(a.studentAnswer) ? a.studentAnswer.join(', ') : (a.studentAnswer ?? '')}</span></div>
                    <div className="text-gray-600">Correct answer: <span className="text-gray-900">{a.correctAnswer ?? '—'}</span></div>
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
