import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiService } from '../../services/api';

const PublicResultCheck: React.FC = () => {
  const [code, setCode] = React.useState('');
  const [result, setResult] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();

  React.useEffect(() => {
    const c = params.get('code');
    if (c) { setCode(c); void fetchResult(c); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchResult = async (c: string) => {
    setLoading(true);
    try {
      const res = await apiService.get<any>(`/exams/results/${encodeURIComponent(c)}`);
      setResult(res.data);
    } catch (e) {
      setResult({ error: 'Unable to fetch result' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-xl mx-auto bg-white border rounded p-6">
        <h1 className="text-xl font-semibold mb-4">Check Your Result</h1>
        <form onSubmit={(e)=>{ e.preventDefault(); if (code.trim()) void fetchResult(code.trim()); }} className="flex gap-2 mb-4">
          <input value={code} onChange={e=>setCode(e.target.value)} placeholder="Enter ticket code" className="flex-1 px-3 py-2 border rounded" />
          <button type="submit" className="px-3 py-2 border rounded bg-blue-600 text-white disabled:opacity-50" disabled={loading}>Check</button>
        </form>
        {loading && <div className="text-sm text-gray-600">Checking...</div>}
        {result && !loading && (
          <div className="text-sm">
            {result.status === 'not_found' && <div className="text-red-600">Ticket not found.</div>}
            {result.status && result.status !== 'not_found' && (
              <div className="space-y-1">
                <div>Ticket: <span className="font-mono">{result.ticketCode}</span></div>
                <div>Exam: {result.examTitle || '—'}</div>
                <div>Status: {result.status === 'approved' ? 'Approved' : (result.status === 'submitted' ? 'Submitted (awaiting approval)' : 'In progress / not submitted')}</div>
                {result.status === 'approved' && (
                  <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded space-y-1">
                    {/* Hide percentage; show band and correct counts */}
                    {typeof result.listeningCorrect === 'number' && typeof result.listeningTotal === 'number' && (
                      <div>Listening: {result.listeningCorrect}/{result.listeningTotal}{typeof result.listeningBand === 'number' ? ` — Band ${result.listeningBand.toFixed(1)}` : ''}</div>
                    )}
                    {typeof result.readingCorrect === 'number' && typeof result.readingTotal === 'number' && (
                      <div>Reading: {result.readingCorrect}/{result.readingTotal}{typeof result.readingBand === 'number' ? ` — Band ${result.readingBand.toFixed(1)}` : ''}</div>
                    )}
                  </div>
                )}
                {Array.isArray(result.writingFeedback) && result.writingFeedback.length > 0 && (
                  <div className="mt-3">
                    <div className="font-medium mb-1">Writing Feedback</div>
                    <ul className="space-y-2">
                      {result.writingFeedback.map((f:any, idx:number) => (
                        <li key={idx} className="border rounded p-2">
                          <div className="text-xs text-gray-600 mb-1">{f.type === 'writing_task1' ? 'Task 1' : 'Task 2'} — Band: {f.band ?? '—'}</div>
                          {f.comments && <div className="text-gray-800 whitespace-pre-wrap">{f.comments}</div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {result.error && <div className="text-red-600">{result.error}</div>}
          </div>
        )}
        {/* Always show Back to Login */}
        <div className="mt-4">
          <button type="button" onClick={() => navigate('/login')} className="text-blue-600 hover:underline">Back to Login</button>
        </div>
      </div>
    </div>
  );
};

export default PublicResultCheck;


