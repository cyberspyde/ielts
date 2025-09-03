import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, CheckCircle2, XCircle, Ticket, User } from 'lucide-react';
import { apiService } from '../../services/api';

interface AdminSessionResultsData {
  session: any;
  exam: any;
  answers: Array<any>;
}

const AdminSessionResults: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-session-results', sessionId],
    queryFn: async () => {
      const res = await apiService.get<any>(`/admin/sessions/${sessionId}/results`);
      return res.data as AdminSessionResultsData;
    },
    enabled: !!sessionId
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-[60vh] text-gray-600"><Loader2 className="h-8 w-8 animate-spin mr-2" />Loading results…</div>;
  }
  if (error) {
    return <div className="p-8 text-center text-red-600">Failed to load session results.</div>;
  }
  if (!data) return null;

  const { session, exam, answers } = data;
  const pctRaw = session?.percentageScore;
  const pctNum = typeof pctRaw === 'number' ? pctRaw : Number(pctRaw);
  const pctDisplay = isFinite(pctNum) ? pctNum.toFixed(1) : '0.0';
  const timeSpent = typeof session?.timeSpentSeconds === 'number' ? session.timeSpentSeconds : Number(session?.timeSpentSeconds) || 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link to="/admin/sessions" className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700 mb-2"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Sessions</Link>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Session Results</h1>
          <p className="text-gray-600 text-sm">Exam: <span className="font-medium">{exam.title}</span></p>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500">Session ID</div>
          <div className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{session.id}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Score</div>
          <div className="text-xl font-semibold text-gray-900">{pctDisplay}%</div>
          <div className="text-xs text-gray-500">Total: {Number(session.totalScore) || 0}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Time Spent</div>
          <div className="text-xl font-semibold text-gray-900">{Math.floor(timeSpent/60)}m {timeSpent%60}s</div>
          <div className="text-xs text-gray-500">Duration: {exam.durationMinutes}m</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Status</div>
          <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${session.isPassed ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>{session.isPassed ? 'PASSED' : 'NOT PASSED'}</div>
          {session.ticketCode && <div className="mt-2 flex items-center text-xs text-gray-600"><Ticket className="h-3 w-3 mr-1" /> {session.ticketCode}</div>}
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">User</div>
          {session.user ? (
            <div className="flex items-center text-sm text-gray-800"><User className="h-4 w-4 mr-1" /> {session.user.name} <span className="ml-2 text-xs text-gray-500">{session.user.email}</span></div>
          ) : (
            <div className="text-sm italic text-gray-500">Ticket (anonymous)</div>
          )}
          <div className="mt-2 text-[10px] text-gray-500">Started {session.startedAt ? new Date(session.startedAt).toLocaleString() : '—'}</div>
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Question</th>
              <th className="px-3 py-2 text-left font-medium">Answer</th>
              <th className="px-3 py-2 text-left font-medium">Correct</th>
              <th className="px-3 py-2 text-left font-medium">Points</th>
              <th className="px-3 py-2 text-left font-medium">Section</th>
            </tr>
          </thead>
          <tbody>
            {answers.map(a => {
              const correct = a.isCorrect;
              const studentDisplay = typeof a.studentAnswer === 'string' ? a.studentAnswer : Array.isArray(a.studentAnswer) ? a.studentAnswer.join(', ') : JSON.stringify(a.studentAnswer);
              return (
                <tr key={a.questionId} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs font-mono">{a.questionNumber}</td>
                  <td className="px-3 py-2 w-[40%]">
                    <div className="text-gray-900 text-xs font-medium line-clamp-2" title={a.questionText}>{a.questionText}</div>
                    <div className="text-[10px] text-gray-500 uppercase mt-1">{a.questionType}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-800 text-xs">{studentDisplay || '—'}</td>
                  <td className="px-3 py-2">{correct ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</td>
                  <td className="px-3 py-2 text-xs">{a.pointsEarned}/{a.maxPoints}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{a.sectionType}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminSessionResults;
