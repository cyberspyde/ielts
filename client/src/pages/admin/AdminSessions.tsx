import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Link } from 'react-router-dom';
import { Search, RefreshCcw, Eye, Ticket, User, Clock, Loader2 } from 'lucide-react';
import { apiService } from '../../services/api';

interface AdminSession {
  id: string;
  status: string;
  startedAt: string | null;
  submittedAt: string | null;
  totalScore: number | null;
  percentageScore: number | null;
  timeSpentSeconds: number | null;
  createdAt: string;
  ticketCode?: string | null;
  user?: { email: string; name: string } | null;
  exam: { title: string; type: string };
}

const formatDuration = (sec: number | null | undefined) => {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
};

const AdminSessions: React.FC = () => {
  const [filters, setFilters] = useState({ examId: '', status: 'submitted', userId: '', search: '', startDate: '', endDate: '' });
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return d.getMonth() + 1; });
  const [calendarYear, setCalendarYear] = useState(() => (new Date()).getFullYear());
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-sessions', filters, page],
    queryFn: async () => {
      const params: any = { page, limit: 25 };
      if (filters.status) params.status = filters.status;
      if (filters.examId) params.examId = filters.examId;
      if (filters.userId) params.userId = filters.userId;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      const res = await apiService.get<any>('/admin/sessions', params);
      return res.data;
    }
  });
  // Calendar counts query
  const { data: calData, isLoading: isCalLoading } = useQuery({
    queryKey: ['admin-sessions-calendar', calendarYear, calendarMonth, filters.examId, filters.status],
    queryFn: async () => {
      const res = await apiService.get<any>('/admin/sessions/calendar', {
        params: { year: calendarYear, month: calendarMonth, examId: filters.examId, status: filters.status }
      });
      return res.data;
    }
  });

  const dayCounts: Record<string, number> = calData?.counts || {};

  // Helper to format a date as local YYYY-MM-DD (no UTC shift)
  const fmtLocalYMD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const monthMatrix = useMemo(() => {
    // build a matrix of weeks for the selected calendar month
    const y = calendarYear; const m = calendarMonth - 1; // JS month 0-11
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startWeekDay = (first.getDay() + 6) % 7; // make Monday=0
    const daysInMonth = last.getDate();
    const weeks: Array<Array<Date | null>> = [];
    let current = 1 - startWeekDay;
    while (current <= daysInMonth) {
      const row: Array<Date | null> = [];
      for (let i = 0; i < 7; i++) {
        const dayNum = current + i;
        if (dayNum < 1 || dayNum > daysInMonth) row.push(null);
        else row.push(new Date(y, m, dayNum));
      }
      weeks.push(row);
      current += 7;
    }
    return weeks;
  }, [calendarYear, calendarMonth]);

  const onPickDate = (d: Date) => {
    setSelectedDate(d);
  };

  // Default to today's local day and update filters whenever selectedDate changes
  useEffect(() => {
    if (!selectedDate) return;
    const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1);
    setFilters(f => ({ ...f, startDate: start.toISOString(), endDate: end.toISOString() }));
    setPage(1);
  }, [selectedDate]);

  const sessions: AdminSession[] = data?.sessions || [];
  const pagination = data?.pagination;

  const queryClient = useQueryClient();
  const stopSession = useMutation({
    mutationFn: async (id: string) => apiService.post(`/admin/sessions/${id}/stop`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-sessions'] }); }
  });
  const deleteSession = useMutation({
    mutationFn: async ({ id, force }: { id: string; force?: boolean }) => apiService.delete(`/admin/sessions/${id}${force ? '?force=true' : ''}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-sessions'] }); }
  });

  // Dialog state for replacing window.confirm
  const [dialog, setDialog] = React.useState<{ mode: 'stop' | 'delete'; session?: AdminSession }>(() => ({ mode: 'stop' }));
  const openDialog = (mode: 'stop' | 'delete', session: AdminSession) => setDialog({ mode, session });
  const closeDialog = () => setDialog(d => ({ ...d, session: undefined }));
  const confirmDialog = () => {
    if (!dialog.session) return;
    if (dialog.mode === 'stop') {
      stopSession.mutate(dialog.session.id, { onSuccess: closeDialog });
    } else {
      deleteSession.mutate({ id: dialog.session.id }, { onSuccess: closeDialog });
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Exam Sessions</h1>
          <p className="text-gray-600 text-sm">Includes ticket-based anonymous submissions</p>
        </div>
        <button onClick={() => refetch()} className="flex items-center px-3 py-2 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50">
          <RefreshCcw className={`h-4 w-4 mr-2 text-gray-600 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="bg-white border rounded-lg p-4 mb-6 grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            placeholder="User email or ticket code"
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            className="pl-9 pr-3 py-2 w-full border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          />
        </div>
        <select value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }} className="px-3 py-2 border rounded text-sm">
          <option value="">All Status</option>
          <option value="submitted">Submitted</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="expired">Expired</option>
        </select>
        <input
          placeholder="Exam ID"
            value={filters.examId}
            onChange={e => { setFilters(f => ({ ...f, examId: e.target.value })); setPage(1); }}
            className="px-3 py-2 border rounded text-sm"
        />
        <input
          placeholder="User ID"
            value={filters.userId}
            onChange={e => { setFilters(f => ({ ...f, userId: e.target.value })); setPage(1); }}
            className="px-3 py-2 border rounded text-sm"
        />
      </div>

      {/* Calendar filter */}
      <div className="bg-white border rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium text-gray-800">Filter by Date</div>
          <div className="flex items-center gap-2 text-sm">
            <button className="px-2 py-1 border rounded" onClick={() => setCalendarMonth(m => m === 1 ? (setCalendarYear(y=>y-1), 12) : m - 1)}>&lt;</button>
            <div className="min-w-[140px] text-center">{new Date(calendarYear, calendarMonth - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })}</div>
            <button className="px-2 py-1 border rounded" onClick={() => setCalendarMonth(m => m === 12 ? (setCalendarYear(y=>y+1), 1) : m + 1)}>&gt;</button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-xs text-gray-600 mb-1">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (<div key={d} className="text-center py-1">{d}</div>))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {monthMatrix.map((week, wi) => week.map((day, di) => {
            if (!day) return <div key={`${wi}-${di}`} className="h-16 bg-gray-50 rounded" />;
            const key = fmtLocalYMD(day);
            const count = dayCounts[key] || 0;
            const isSelected = selectedDate && fmtLocalYMD(selectedDate) === key;
            const todayKey = fmtLocalYMD(new Date());
            const isToday = key === todayKey;
            return (
              <button
                key={`${wi}-${di}`}
                onClick={() => onPickDate(day)}
                className={`h-16 rounded border relative text-left px-2 hover:border-blue-400 ${
                  isSelected ? 'border-blue-500 bg-blue-50' : count ? 'bg-blue-50 border-blue-200' : 'bg-white'
                } ${isToday && !isSelected ? 'border-blue-300' : ''}`}
                title={`${count} session(s)`}
              >
                <div className="text-[11px] text-gray-700">{day.getDate()}</div>
                {count > 0 && (
                  <span className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-600 text-white">{count}</span>
                )}
              </button>
            );
          }))}
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
          <div>
            {filters.startDate ? (
              <>Showing sessions for <strong>{new Date(filters.startDate).toLocaleDateString()}</strong> <button className="ml-2 underline" onClick={() => { const today = new Date(); setSelectedDate(today); }}>Clear</button></>
            ) : 'Select a date to filter'}
          </div>
          {isCalLoading && <div className="italic">Loading calendar…</div>}
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">When</th>
              <th className="px-3 py-2 text-left font-medium">Exam</th>
              <th className="px-3 py-2 text-left font-medium">User / Ticket</th>
              <th className="px-3 py-2 text-left font-medium">Time spent</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="py-10 text-center text-gray-500"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Loading sessions...</td></tr>
            ) : sessions.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-gray-500">No sessions found.</td></tr>
            ) : sessions.filter(s => {
              if (!filters.search) return true;
              const term = filters.search.toLowerCase();
              return (s.user?.email?.toLowerCase().includes(term)) || (s.ticketCode?.toLowerCase().includes(term)) || s.id.toLowerCase().includes(term);
            }).map(session => {
              return (
                <tr key={session.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {session.submittedAt ? new Date(session.submittedAt).toLocaleString() : new Date(session.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 line-clamp-1" title={session.exam.title}>{session.exam.title}</div>
                    <div className="text-[10px] text-gray-500 uppercase">{session.exam.type}</div>
                  </td>
                  <td className="px-3 py-2">
                    {session.user ? (
                      <div className="flex items-center gap-1 text-gray-800"><User className="h-3 w-3" /> <span className="truncate max-w-[160px]" title={session.user.name}>{session.user.name}</span></div>
                    ) : session.ticketCode ? (
                      <div className="flex items-center gap-1 text-gray-700"><Ticket className="h-3 w-3" /> <span className="truncate max-w-[160px]" title={session.ticketCode}>{session.ticketCode}</span></div>
                    ) : <span className="text-gray-400 italic">Unknown</span>}
                    {/* show ticket assignee if exists */}
                    {!session.user && session.ticketCode && (data?.sessions || []).length && (
                      <div className="text-[11px] text-gray-500">{(data?.sessions || []).find((s: AdminSession)=>s.id===session.id)?.ticketIssuedToName || ''}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDuration(session.timeSpentSeconds)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium ${session.status === 'submitted' ? 'bg-green-100 text-green-700' : session.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : session.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-200 text-gray-700'}`}>{session.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    {session.status === 'submitted' && (
                      <Link to={`/admin/sessions/${session.id}`} className="inline-flex items-center text-blue-600 hover:text-blue-700 text-xs font-medium">
                        <Eye className="h-3 w-3 mr-1" /> View
                      </Link>
                    )}
                    {(session.status === 'in_progress' || session.status === 'pending') && (
                      <button
                        onClick={() => openDialog('stop', session)}
                        className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
                        disabled={stopSession.isPending}
                      >Stop</button>
                    )}
                    {session.status !== 'submitted' && (
                      <button
                        onClick={() => openDialog('delete', session)}
                        className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50"
                        disabled={deleteSession.isPending}
                      >Delete</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <ConfirmDialog
          open={!!dialog.session}
          title={dialog.mode === 'stop' ? 'Stop Session' : 'Delete Session'}
          description={dialog.mode === 'stop' ? (
            <>This will immediately expire the selected session. The student will be unable to continue the exam.</>
          ) : (
            <>Delete this session and all related answers? This action cannot be undone.</>
          )}
          tone={dialog.mode === 'delete' ? 'danger' : 'warning'}
          confirmText={dialog.mode === 'stop' ? 'Stop Session' : 'Delete'}
          onCancel={closeDialog}
          onConfirm={confirmDialog}
          loading={stopSession.isPending || deleteSession.isPending}
        />
        {pagination && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 text-xs text-gray-600">
            <div>Page {pagination.currentPage} of {pagination.totalPages} • {pagination.totalCount} sessions</div>
            <div className="flex items-center gap-2">
              <button disabled={pagination.currentPage <= 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 border rounded disabled:opacity-40">Prev</button>
              <button disabled={!pagination.hasNext} onClick={() => setPage(p => p + 1)} className="px-2 py-1 border rounded disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSessions;
