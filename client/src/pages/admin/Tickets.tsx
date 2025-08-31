import React, { useState } from 'react';
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
            <input className="rounded-md border-gray-300" placeholder="Exam ID" value={createForm.examId} onChange={(e) => setCreateForm({ ...createForm, examId: e.target.value })} />
            <input type="number" min={1} className="rounded-md border-gray-300" placeholder="Quantity" value={createForm.quantity} onChange={(e) => setCreateForm({ ...createForm, quantity: Number(e.target.value) })} />
            <input type="datetime-local" className="rounded-md border-gray-300" placeholder="Valid Until" value={createForm.validUntil} onChange={(e) => setCreateForm({ ...createForm, validUntil: e.target.value })} />
            <input type="number" min={1} className="rounded-md border-gray-300" placeholder="Max Uses" value={createForm.maxUses} onChange={(e) => setCreateForm({ ...createForm, maxUses: Number(e.target.value) })} />
            <input className="rounded-md border-gray-300" placeholder="Issued To Email (optional)" value={createForm.issuedToEmail} onChange={(e) => setCreateForm({ ...createForm, issuedToEmail: e.target.value })} />
            <input className="rounded-md border-gray-300" placeholder="Issued To Name (optional)" value={createForm.issuedToName} onChange={(e) => setCreateForm({ ...createForm, issuedToName: e.target.value })} />
            <input className="rounded-md border-gray-300 md:col-span-3" placeholder="Notes (optional)" value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} />
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
