import React from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, XCircle, Ticket, User, Calendar, Clock, BookOpen, CheckCircle } from 'lucide-react';
import { apiService } from '../../services/api';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { toast } from 'react-toastify';

interface AdminSessionResultsData {
  session: any;
  exam: any;
  answers: Array<any>;
}

const AdminSessionResults: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-session-results', sessionId],
    queryFn: async () => {
      const res = await apiService.get<any>(`/admin/sessions/${sessionId}/results`);
      return res.data as AdminSessionResultsData;
    },
    enabled: !!sessionId
  });

  const queryClient2 = useQueryClient();
  const gradeAnswer = useMutation({
    mutationFn: async ({ questionId, pointsEarned, isCorrect, comments }: { questionId: string; pointsEarned: number; isCorrect?: boolean; comments?: string }) =>
      apiService.patch(`/admin/sessions/${sessionId}/answers/${questionId}/grade`, { pointsEarned, isCorrect, comments }),
    onSuccess: () => {
      toast.success('Grade saved');
      queryClient2.invalidateQueries({ queryKey: ['admin-session-results', sessionId] });
    },
    onError: () => { toast.error('Failed to save grade'); }
  });
  const recalc = useMutation({
    mutationFn: async () => apiService.post(`/admin/sessions/${sessionId}/recalculate`, {}),
    onSuccess: () => {
      toast.success('Recalculated');
      queryClient2.invalidateQueries({ queryKey: ['admin-session-results', sessionId] });
    },
    onError: () => toast.error('Recalculate failed')
  });
  const approve = useMutation({
    mutationFn: async () => apiService.post(`/admin/sessions/${sessionId}/approve`, {}),
    onSuccess: () => {
      toast.success('Results approved');
      queryClient2.invalidateQueries({ queryKey: ['admin-session-results', sessionId] });
    },
    onError: () => toast.error('Approval failed')
  });

  // Mutations for admin session controls
  const stopSession = useMutation({
    mutationFn: async (id: string) => apiService.post(`/admin/sessions/${id}/stop`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-session-results', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['admin-sessions'] });
    }
  });
  const deleteSession = useMutation({
    mutationFn: async ({ id, force }: { id: string; force?: boolean }) => apiService.delete(`/admin/sessions/${id}${force ? '?force=true' : ''}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-sessions'] });
      navigate('/admin/sessions');
    }
  });

  // Confirm dialog state
  const [dialog, setDialog] = React.useState<{ mode: 'stop' | 'delete'; open: boolean }>(() => ({ mode: 'stop', open: false }));
  const openDialog = (mode: 'stop' | 'delete') => setDialog({ mode, open: true });
  const closeDialog = () => setDialog(d => ({ ...d, open: false }));
  const confirmDialog = () => {
    if (!data?.session || !sessionId) return;
    if (dialog.mode === 'stop') {
      stopSession.mutate(sessionId, { onSuccess: closeDialog });
    } else {
      const isSubmitted = data.session.status === 'submitted';
      deleteSession.mutate({ id: sessionId, force: isSubmitted }, { onSuccess: closeDialog });
    }
  };

  // UI state and derived summary must be declared before any early returns to keep Hooks order stable
  const [showDetails, setShowDetails] = React.useState(false);
  const summary = React.useMemo(() => {
    const session = data?.session;
    const exam = data?.exam;
    const answersRaw = (data?.answers || []) as any[];
    const ans = answersRaw.map((a: any) => {
      // Normalize metadata if it's a string
      let qMeta = a.questionMetadata;
      if (qMeta && typeof qMeta === 'string') {
        try { qMeta = JSON.parse(qMeta); } catch { qMeta = undefined; }
      }
      // Reconstruct graded for simple_table if missing
      const sa = a.studentAnswer;
      if (sa && typeof sa === 'object' && sa.type === 'simple_table' && (!Array.isArray(sa.graded) || sa.graded.length === 0)) {
        const rows: any[][] = qMeta?.simpleTable?.rows || [];
        const graded: any[] = [];
        const norm = (v: any) => String(v ?? '').trim().toLowerCase();
        const judge = (qType: string, studentVal: any, correctSpec: string): boolean => {
          const rec = norm(studentVal);
          if (!correctSpec) return false;
          if (qType === 'multiple_choice') {
            const exp = correctSpec.split('|').map(norm).filter(Boolean);
            const got = rec.split('|').filter(Boolean);
            const uniq = (arr: string[]) => Array.from(new Set(arr));
            const eU = uniq(exp); const gU = uniq(got);
            return eU.length === gU.length && eU.every(v => gU.includes(v));
          }
          if (qType === 'true_false') {
            const map: Record<string, string> = { t: 'true', f: 'false', ng: 'not given', notgiven: 'not given' };
            return (map[rec] || rec) === (map[norm(correctSpec)] || norm(correctSpec));
          }
          // generic: support variants split by '|'
          return correctSpec.split('|').map(norm).includes(rec);
        };
        rows.forEach((row: any[], ri: number) => row.forEach((cell: any, ci: number) => {
          if (!cell || cell.type !== 'question') return;
          const keyBase = `${ri}_${ci}`;
          const cellKey = `${ri}_${ci}`;
          const qType = cell.questionType || 'fill_blank';
          const val = sa.cells?.[cellKey];
          const baseNum = typeof cell.questionNumber === 'number' ? cell.questionNumber : undefined;
          if (Array.isArray(val)) {
            val.forEach((v: any, idx: number) => {
              const corr = typeof cell.correctAnswer === 'string'
                ? (cell.correctAnswer.split(';')[idx] ?? cell.correctAnswer)
                : String(cell.correctAnswer ?? '');
              graded.push({
                key: `${keyBase}_b${idx}`,
                questionType: qType,
                questionNumber: baseNum !== undefined ? baseNum + idx : undefined,
                studentAnswer: v,
                correctAnswer: corr,
                points: cell.points || 1,
                isCorrect: judge(qType, v, corr)
              });
            });
          } else {
            const corr = String(cell.correctAnswer ?? '');
            graded.push({
              key: `${keyBase}`,
              questionType: qType,
              questionNumber: baseNum,
              studentAnswer: val,
              correctAnswer: corr,
              points: cell.points || 1,
              isCorrect: judge(qType, val, corr)
            });
          }
        }));
        sa.graded = graded;
      }
      return a;
    });
    const norm = (s:any) => String(s ?? '').toLowerCase().replace(/\s+/g,' ').trim();
    const countFillBlankArray = (a: any): { total: number; correct: number } => {
      const sa = a.studentAnswer;
      if (!Array.isArray(sa)) return { total: 1, correct: a.isCorrect ? 1 : 0 };
      // Build per-blank accepted groups
      let groups: string[][] | null = null;
      if (typeof a.correctAnswer === 'string') {
        if (a.correctAnswer.includes(';')) {
          groups = a.correctAnswer.split(';').map((g:string)=> g.split('|').map((x:string)=> norm(x)).filter(Boolean));
        } else if (a.correctAnswer.length > 0) {
          // Same accepted set for each blank
          const accepts = a.correctAnswer.split('|').map((x:string)=> norm(x)).filter(Boolean);
          groups = Array.from({ length: sa.length }, ()=> accepts);
        }
      } else {
        try {
          const parsed = JSON.parse(a.correctAnswer || 'null');
          if (Array.isArray(parsed)) groups = parsed.map((g:any)=> Array.isArray(g)? g.map((x:any)=> norm(x)): [norm(g)]);
        } catch {}
      }
      const total = sa.length;
      let correct = 0;
      sa.forEach((ans:any, idx:number) => {
        const recv = norm(ans);
        const accepts = groups?.[idx] || [];
        if (accepts.length ? accepts.includes(recv) : false) correct += 1;
      });
      return { total, correct };
    };

    let totalQuestions = 0;
    let correctQuestions = 0;
    ans.forEach((a: any) => {
      const sa = a.studentAnswer;
      if (sa && typeof sa === 'object' && sa.type === 'simple_table') {
        const graded = Array.isArray(sa.graded) ? sa.graded : [];
        totalQuestions += graded.length;
        correctQuestions += graded.filter((g: any) => g.isCorrect).length;
      } else if (a.questionType === 'fill_blank' && Array.isArray(sa)) {
        const { total, correct } = countFillBlankArray(a);
        totalQuestions += total;
        correctQuestions += correct;
      } else {
        totalQuestions += 1;
        if (a.isCorrect) correctQuestions += 1;
      }
    });
    const overallPercent = typeof session?.percentageScore === 'number'
      ? session.percentageScore
      : (totalQuestions ? (correctQuestions / totalQuestions) * 100 : 0);
    return {
      examTitle: exam?.title,
      completedAt: session?.submittedAt,
      durationMinutes: exam?.durationMinutes,
      totalQuestions,
      correctAnswers: correctQuestions,
      percentage: overallPercent,
      answers: ans,
    };
  }, [data]);

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
  const canStop = session?.status === 'in_progress' || session?.status === 'pending';

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
      // General Training (more lenient)
      if (c >= 40) return 9.0; if (c >= 39) return 8.5; if (c >= 37) return 8.0; if (c >= 36) return 7.5; if (c >= 34) return 7.0;
      if (c >= 32) return 6.5; if (c >= 30) return 6.0; if (c >= 27) return 5.5; if (c >= 23) return 5.0; if (c >= 19) return 4.5;
      if (c >= 15) return 4.0; if (c >= 12) return 3.5; if (c >= 9) return 3.0; if (c >= 6) return 2.5; return 2.0;
    }
  };

  // Per-section correct counts (expand simple_table graded entries)
  const computeSectionCounts = (section: 'listening' | 'reading') => {
    let total = 0; let correct = 0;
    (answers || []).forEach((a: any) => {
      if ((a.sectionType || '').toLowerCase() !== section) return;
      const sa = a.studentAnswer;
      if (sa && typeof sa === 'object' && sa.type === 'simple_table') {
        const graded: any[] = Array.isArray(sa.graded) ? sa.graded : [];
        total += graded.length;
        correct += graded.filter((g:any)=> g.isCorrect).length;
      } else if (a.questionType === 'fill_blank' && Array.isArray(sa)) {
        const { total: t, correct: c } = (():{total:number;correct:number}=>{
          // reuse logic from summary
          let groups: string[][] | null = null;
          if (typeof a.correctAnswer === 'string') {
            if (a.correctAnswer.includes(';')) {
              groups = a.correctAnswer.split(';').map((g:string)=> g.split('|').map((x:string)=> String(x||'').toLowerCase().replace(/\s+/g,' ').trim()).filter(Boolean));
            } else if (a.correctAnswer.length > 0) {
              const accepts = a.correctAnswer.split('|').map((x:string)=> String(x||'').toLowerCase().replace(/\s+/g,' ').trim()).filter(Boolean);
              groups = Array.from({ length: sa.length }, ()=> accepts);
            }
          } else {
            try { const parsed = JSON.parse(a.correctAnswer || 'null'); if (Array.isArray(parsed)) groups = parsed.map((g:any)=> Array.isArray(g)? g.map((x:any)=> String(x||'').toLowerCase().replace(/\s+/g,' ').trim()): [String(g||'').toLowerCase().replace(/\s+/g,' ').trim()]); } catch {}
          }
          const totalLocal = sa.length; let correctLocal = 0;
          sa.forEach((ans:any, idx:number)=>{ const recv = String(ans||'').toLowerCase().replace(/\s+/g,' ').trim(); const accepts = groups?.[idx] || []; if (accepts.length && accepts.includes(recv)) correctLocal += 1; });
          return { total: totalLocal, correct: correctLocal };
        })();
        total += t; correct += c;
      } else {
        total += 1;
        if (a.isCorrect) correct += 1;
      }
    });
    return { total, correct };
  };
  const { total: listeningTotal, correct: listeningCorrect } = computeSectionCounts('listening');
  const { total: readingTotal, correct: readingCorrect } = computeSectionCounts('reading');
  const overallTotal = (() => {
    let t = 0; (answers || []).forEach((a:any)=>{ const sa=a.studentAnswer; if (sa && typeof sa==='object' && sa.type==='simple_table') { const graded:any[]=Array.isArray(sa.graded)?sa.graded:[]; t+=graded.length; } else if (a.questionType==='fill_blank' && Array.isArray(sa)) { t += sa.length; } else { t+=1; } }); return t; })();
  const listeningBand = listeningTotal ? listeningBandFromCorrect(listeningCorrect) : null;
  const readingBand = readingTotal ? readingBandFromCorrect(readingCorrect, exam?.type) : null;


  const renderStudentAnswer = (ans: any) => {
    if (ans == null) return '—';
    if (typeof ans === 'string' || typeof ans === 'number') return String(ans);
    if (Array.isArray(ans)) return ans.join(', ');
    if (typeof ans === 'object') {
      // Simple table container summary
      if ((ans as any).type === 'simple_table') {
        const graded: any[] = Array.isArray((ans as any).graded) ? (ans as any).graded : [];
        const correct = graded.filter((g:any)=>g.isCorrect).length;
        return `Simple Table: ${correct}/${graded.length} correct`;
      }
      // Common MCQ/TF shapes
      const candidate = (ans as any).selected ?? (ans as any).answer ?? (ans as any).value ?? (ans as any).letter ?? (ans as any).choice;
      if (candidate !== undefined) {
        return Array.isArray(candidate) ? candidate.join(', ') : String(candidate);
      }
      // image_dnd / custom objects fallback
      try { return JSON.stringify(ans); } catch { return String(ans); }
    }
    return String(ans);
  };

  const labelForType = (t: string) => {
    switch (t) {
      case 'fill_blank': return 'Fill Blank';
      case 'multiple_choice': return 'MCQ';
      case 'multi_select': return 'Multi-Select';
      case 'true_false': return 'T/F';
      case 'short_answer': return 'Short Ans';
      case 'matching': return 'Matching';
      case 'image_labeling': return 'Image Label';
      case 'image_dnd': return 'Image DnD';
      default: return t || '—';
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link to="/admin/sessions" className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700 mb-2"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Sessions</Link>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Exam Results (Session)</h1>
          <p className="text-gray-600 text-sm">Exam: <span className="font-medium">{exam.title}</span></p>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2 mb-2">
            <Link to={`/admin/exams/${exam.id}/edit`} className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50">View Exam</Link>
            {canStop && (
              <button onClick={() => openDialog('stop')} className="px-3 py-1.5 text-xs border rounded text-amber-700 border-amber-300 hover:bg-amber-50">Stop</button>
            )}
            <button onClick={() => openDialog('delete')} className="px-3 py-1.5 text-xs border rounded text-red-700 border-red-300 hover:bg-red-50">Remove</button>
            <button onClick={() => recalc.mutate()} disabled={recalc.isPending} className="px-3 py-1.5 text-xs border rounded text-blue-700 border-blue-300 hover:bg-blue-50 disabled:opacity-50">{recalc.isPending ? 'Recalculating…' : 'Recalculate'}</button>
            <button onClick={() => approve.mutate()} disabled={approve.isPending} className="px-3 py-1.5 text-xs border rounded text-green-700 border-green-300 hover:bg-green-50 disabled:opacity-50">{approve.isPending ? 'Approving…' : 'Approve'}</button>
          </div>
          <div className="text-sm text-gray-500">Session ID</div>
          <div className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{session.id}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">Score</div>
          <div className="text-xl font-semibold text-gray-900">{pctDisplay}%</div>
          <div className="text-xs text-gray-500">Total: {overallTotal}</div>
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
            <div className="flex items-center text-sm text-gray-800"><User className="h-4 w-4 mr-1" /> {session.user.name} {session.user.email && (<span className="ml-2 text-xs text-gray-500">{session.user.email}</span>)}</div>
          ) : (
            <div className="text-sm italic text-gray-500">Unknown user</div>
          )}
          <div className="mt-2 text-[10px] text-gray-500">Started {session.startedAt ? new Date(session.startedAt).toLocaleString() : '—'}</div>
        </div>
      </div>

      {/* Section Bands */}
      {(listeningBand || readingBand) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {listeningBand !== null && (
            <div className="bg-white border rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Listening Band</div>
              <div className="text-xl font-semibold text-gray-900">{listeningBand.toFixed(1)}</div>
              <div className="text-xs text-gray-500">Correct: {listeningCorrect}/{listeningTotal}</div>
            </div>
          )}
          {readingBand !== null && (
            <div className="bg-white border rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Reading Band</div>
              <div className="text-xl font-semibold text-gray-900">{readingBand.toFixed(1)}</div>
              <div className="text-xs text-gray-500">Correct: {readingCorrect}/{readingTotal} • {exam?.type === 'academic' ? 'Academic' : 'General Training'}</div>
            </div>
          )}
        </div>
      )}

      {/* Exam-style summary and optional details */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold text-gray-900">Exam Results</h2>
        <p className="text-gray-600">{summary.examTitle}</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          <div className="flex items-center text-sm text-gray-600">
            <Calendar className="h-4 w-4 mr-2" />
            <span>Completed: {summary.completedAt ? new Date(summary.completedAt).toLocaleDateString() : '—'}</span>
          </div>
          <div className="flex items-center text-sm text-gray-600">
            <Clock className="h-4 w-4 mr-2" />
            <span>Duration: {summary.durationMinutes ?? '—'} minutes</span>
          </div>
          <div className="flex items-center text-sm text-gray-600">
            <BookOpen className="h-4 w-4 mr-2" />
            <span>Questions: {overallTotal}</span>
          </div>
          <div className="flex items-center text-sm text-gray-600">
            <CheckCircle className="h-4 w-4 mr-2" />
            <span>Correct: {summary.correctAnswers} ({Math.round(summary.percentage)}%)</span>
          </div>
        </div>
        <div className="mt-4">
          <button onClick={() => setShowDetails(!showDetails)} className="text-sm text-blue-600 hover:text-blue-500">
            {showDetails ? 'Hide details' : 'Show details'}
          </button>
        </div>

        {showDetails && (
          <div className="mt-6 space-y-3">
            {(() => {
              const items: { key: string; heading: string; a: any }[] = [];
              let nextNumber = 1;
              summary.answers.forEach((a: any) => {
                const sa = a.studentAnswer;
                if (sa && typeof sa === 'object' && sa.type === 'simple_table' && Array.isArray(sa.graded) && sa.graded.length) {
                  const count = sa.graded.length;
                  const start = nextNumber; const end = nextNumber + count - 1;
                  const rangeLabel = start === end ? String(start) : `${start}-${end}`;
                  items.push({ key: a.questionId, heading: `Q${rangeLabel}. ${a.questionText}`, a });
                  nextNumber = end + 1;
                } else {
                  const explicit = a.questionMetadata?.questionNumber || a.questionNumber;
                  let displayNum: number;
                  if (typeof explicit === 'number' && explicit >= nextNumber) { displayNum = explicit; nextNumber = explicit + 1; }
                  else { displayNum = nextNumber; nextNumber += 1; }
                  items.push({ key: a.questionId, heading: `Q${displayNum}. ${a.questionText}`, a });
                }
              });
              return items.map(({ key, heading, a }) => {
                const sa = a.studentAnswer;
                const isSimpleTable = sa && typeof sa === 'object' && sa.type === 'simple_table';
                return (
                  <div key={key} className="p-4 border border-gray-200 rounded">
                    <div className="flex items-start justify-between">
                      <div className="font-medium text-gray-900">{heading}</div>
                      {!isSimpleTable && (a.isCorrect ? <CheckCircle className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-red-600" />)}
                    </div>
                    <div className="mt-2 text-sm space-y-2">
                      <div className="text-gray-600">Student answer: <span className="text-gray-900">{renderStudentAnswer(a.studentAnswer)}</span></div>
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
                        // Per-blank breakdown for multi-blank fill-in
                        if (a.questionType === 'fill_blank' && Array.isArray(a.studentAnswer)) {
                          const normalize = (s:any) => String(s ?? '').toLowerCase().replace(/\s+/g,' ').trim();
                          const buildGroups = (): string[][] => {
                            if (typeof a.correctAnswer === 'string') {
                              if (a.correctAnswer.includes(';')) {
                                return a.correctAnswer.split(';').map((g:string)=> g.split('|').map((x:string)=> normalize(x)).filter(Boolean));
                              }
                              const accepts = a.correctAnswer.split('|').map((x:string)=> normalize(x)).filter(Boolean);
                              return Array.from({ length: a.studentAnswer.length }, ()=> accepts);
                            }
                            try { const parsed = JSON.parse(a.correctAnswer || 'null'); if (Array.isArray(parsed)) return parsed.map((g:any)=> Array.isArray(g)? g.map((x:any)=> normalize(x)): [normalize(g)]); } catch {}
                            return Array.from({ length: a.studentAnswer.length }, ()=> []);
                          };
                          const groups = buildGroups();
                          return (
                            <div className="mt-2">
                              <div className="text-gray-700 font-medium text-xs mb-1">Blanks Detail</div>
                              <div className="overflow-auto">
                                <table className="min-w-[360px] text-[11px] border border-gray-200">
                                  <thead>
                                    <tr className="bg-gray-50">
                                      <th className="px-2 py-1 border">Blank #</th>
                                      <th className="px-2 py-1 border">Your Answer</th>
                                      <th className="px-2 py-1 border">Accepted</th>
                                      <th className="px-2 py-1 border">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {a.studentAnswer.map((ans:any, idx:number) => {
                                      const recv = normalize(ans);
                                      const accepts = groups[idx] || [];
                                      const ok = accepts.length > 0 && accepts.includes(recv);
                                      return (
                                        <tr key={idx} className={ok ? 'bg-green-50' : 'bg-red-50'}>
                                          <td className="px-2 py-1 border text-center">{idx + 1}</td>
                                          <td className="px-2 py-1 border">{String(ans ?? '—')}</td>
                                          <td className="px-2 py-1 border">{accepts.length ? accepts.join(', ') : '—'}</td>
                                          <td className="px-2 py-1 border text-center">{ok ? 'Correct' : 'Wrong'}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        }
                        return <div className="text-gray-600">Correct answer: <span className="text-gray-900">{a.correctAnswer ?? '—'}</span></div>;
                      })()}
                      {/* Grading controls for writing */}
                      {(['writing_task1','essay'].includes(a.questionType)) && (
                        <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                          <div className="text-xs font-semibold text-yellow-800 mb-2">Grade</div>
                          <form onSubmit={(e)=>{ e.preventDefault(); const form = e.currentTarget as HTMLFormElement; const fd = new FormData(form); const pts = parseFloat(String(fd.get('points')||'0'))||0; const correct = String(fd.get('isCorrect')||'')==='on'; const comments = String(fd.get('comments')||''); gradeAnswer.mutate({ questionId: a.questionId, pointsEarned: pts, isCorrect: correct, comments }, { onSuccess: ()=> recalc.mutate() }); }} className="flex flex-wrap items-end gap-2">
                            <label className="text-xs text-yellow-800 flex flex-col gap-1">
                              Band (0-9, .5 increments)
                              <input name="points" type="number" step="0.5" min={0} defaultValue={a.pointsEarned || 0} className="px-2 py-1 border border-yellow-300 rounded w-24" />
                            </label>
                            <label className="text-xs text-yellow-800 flex items-center gap-2">
                              <input name="isCorrect" type="checkbox" defaultChecked={!!a.isCorrect} /> Mark correct
                            </label>
                            <label className="text-xs text-yellow-800 flex flex-col gap-1 flex-1 min-w-[220px]">
                              Comments
                              <input name="comments" type="text" defaultValue={''} className="px-2 py-1 border border-yellow-300 rounded" />
                            </label>
                            <button type="submit" className="px-3 py-1.5 text-xs border border-yellow-400 text-yellow-800 rounded hover:bg-yellow-100">Save Grade</button>
                          </form>
                        </div>
                      )}
                    </div>
                    {a.explanation && (
                      <div className="mt-2 p-2 bg-blue-50 rounded text-sm text-blue-800">{a.explanation}</div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={dialog.open}
        title={dialog.mode === 'stop' ? 'Stop this session?' : (session?.status === 'submitted' ? 'Remove submitted session?' : 'Remove this session?')}
        description={dialog.mode === 'stop'
          ? 'This will mark the session as expired and prevent further answers. You can still view existing responses.'
          : (session?.status === 'submitted' ? 'This will permanently delete the submitted session and its answers. This action cannot be undone.' : 'This will delete the session and any partial answers. This action cannot be undone.')}
        tone={dialog.mode === 'delete' ? 'danger' : 'warning'}
        confirmText={dialog.mode === 'stop' ? 'Stop Session' : 'Delete'}
        onCancel={closeDialog}
        onConfirm={confirmDialog}
        loading={stopSession.isPending || deleteSession.isPending}
      />
    </div>
  );
};

export default AdminSessionResults;
