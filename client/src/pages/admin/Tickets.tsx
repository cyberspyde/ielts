import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { apiService } from '../../services/api';

const AdminTickets: React.FC = () => {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ search: '', status: 'all', page: 1, limit: 20 });
  const [createForm, setCreateForm] = useState({ examId: '', quantity: 1, validUntil: '', maxUses: 1, issuedToEmail: '', issuedToName: '', notes: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-tickets', filters],
    queryFn: async () => {
      const res = await apiService.get<any>('/admin/tickets', filters);
      return res.data;
    }
  });

  // Fetch recent exams and support searching
  const [examSearch, setExamSearch] = useState('');
  const { data: examsData } = useQuery({
    queryKey: ['admin-exams-search', examSearch],
    queryFn: async () => {
      // Use public exams list endpoint which supports search and pagination
      const res = await apiService.get<any>('/exams', { page: 1, limit: 20, search: examSearch });
      return res.data;
    }
  });
  const recentExams = useMemo(() => (examsData?.exams || []).slice(0, 20), [examsData]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: any = { ...createForm };
      if (!payload.issuedToEmail) delete payload.issuedToEmail;
      if (!payload.issuedToName) delete payload.issuedToName;
      if (!payload.notes) delete payload.notes;
      const res = await apiService.post('/admin/tickets', payload);
      return res;
    },
    onSuccess: () => {
      toast.success('Tickets created');
      queryClient.invalidateQueries({ queryKey: ['admin-tickets'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to create tickets')
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Ticket Management</h1>
        </div>

        {/* Create Tickets */}
        <div className="bg-white rounded-lg border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Tickets</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-xs text-gray-600 mb-1">Exam</label>
              <select className="w-full rounded-md border-gray-300" value={createForm.examId} onChange={(e) => setCreateForm({ ...createForm, examId: e.target.value })}>
                <option value="">Select recent exam…</option>
                {recentExams.map((ex: any) => (
                  <option key={ex.id} value={ex.id}>{ex.title} ({new Date(ex.createdAt || ex.created_at).toLocaleDateString()})</option>
                ))}
              </select>
              <div className="mt-2 flex gap-2">
                <input className="flex-1 rounded-md border-gray-300" placeholder="Search exams…" value={examSearch} onChange={(e) => setExamSearch(e.target.value)} />
                <button className="px-3 py-2 text-sm rounded border" onClick={() => { /* query auto triggers via state */ }}>Search</button>
              </div>
              <div className="mt-2">
                <input className="w-full rounded-md border-gray-300" placeholder="Or paste Exam ID manually" value={createForm.examId} onChange={(e) => setCreateForm({ ...createForm, examId: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Quantity</label>
              <input type="number" min={1} className="w-full rounded-md border-gray-300" placeholder="Quantity" value={createForm.quantity} onChange={(e) => setCreateForm({ ...createForm, quantity: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Valid Until</label>
              <input type="datetime-local" className="w-full rounded-md border-gray-300" placeholder="Valid Until" value={createForm.validUntil} onChange={(e) => setCreateForm({ ...createForm, validUntil: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Max Uses</label>
              <input type="number" min={1} className="w-full rounded-md border-gray-300" placeholder="Max Uses" value={createForm.maxUses} onChange={(e) => setCreateForm({ ...createForm, maxUses: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Issued To Email (optional)</label>
              <input className="w-full rounded-md border-gray-300" placeholder="Issued To Email (optional)" value={createForm.issuedToEmail} onChange={(e) => setCreateForm({ ...createForm, issuedToEmail: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Issued To Name (optional)</label>
              <input className="w-full rounded-md border-gray-300" placeholder="Issued To Name (optional)" value={createForm.issuedToName} onChange={(e) => setCreateForm({ ...createForm, issuedToName: e.target.value })} />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs text-gray-600 mb-1">Notes (optional)</label>
              <input className="w-full rounded-md border-gray-300" placeholder="Notes (optional)" value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {createMutation.isPending ? 'Creating…' : 'Create Tickets'}
            </button>
          </div>
        </div>

        {/* Tickets List */}
        <div className="bg-white rounded-lg border">
          <div className="px-4 py-3 border-b">
            <div className="grid grid-cols-12 text-xs font-medium text-gray-500">
              <div className="col-span-3">Code</div>
              <div className="col-span-2">Exam</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Uses</div>
              <div className="col-span-3 text-right">Valid</div>
            </div>
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-gray-500">Loading tickets…</div>
          ) : (
            <div className="divide-y">
              {(data?.tickets || []).map((t: any) => (
                <div key={t.id} className="px-4 py-3 grid grid-cols-12 items-center text-sm">
                  <div className="col-span-3 font-mono">{t.code}</div>
                  <div className="col-span-2">{t.exam?.title}</div>
                  <div className="col-span-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.status === 'active' ? 'bg-green-100 text-green-700' : t.status === 'used' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{t.status}</span>
                  </div>
                  <div className="col-span-2">{t.currentUses}/{t.maxUses}</div>
                  <div className="col-span-3 text-right">{new Date(t.validFrom || t.createdAt).toLocaleDateString()} → {new Date(t.validUntil).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminTickets;
