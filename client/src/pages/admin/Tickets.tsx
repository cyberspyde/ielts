import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { apiService } from '../../services/api';

const AdminTickets: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: '', status: 'all', page: 1, limit: 20 });
  const [createForm, setCreateForm] = useState({ examId: '', quantity: 1, validUntil: '', maxUses: 1, issuedToEmail: '', issuedToName: '', notes: '' });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inlineTickets, setInlineTickets] = useState<any[]>([]);

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

  const ticketsList: any[] = data?.tickets || [];

  const toggleSelectAll = () => {
    if (selectedIds.length === ticketsList.length) setSelectedIds([]);
    else setSelectedIds(ticketsList.map((t: any) => t.id));
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const openPrintPreview = () => {
    const selected = ticketsList.filter((t:any)=> selectedIds.includes(t.id));
    if (selected.length === 0) { toast.info('Select at least one ticket to print'); return; }
    try { sessionStorage.setItem('tickets-print', JSON.stringify(selected)); } catch {}
    navigate('/admin/tickets/print', { state: { tickets: selected } });
  };

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
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="grid grid-cols-12 text-xs font-medium text-gray-500 flex-1">
              <div className="col-span-1">
                <input type="checkbox" className="rounded" aria-label="Select all" checked={ticketsList.length>0 && selectedIds.length === ticketsList.length} onChange={toggleSelectAll} />
              </div>
              <div className="col-span-3">Code</div>
              <div className="col-span-3">Exam</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1">Uses</div>
              <div className="col-span-2 text-right">Valid</div>
            </div>
            <div className="ml-4">
              <button
                className="px-3 py-1.5 text-sm rounded border bg-blue-600 text-white disabled:opacity-50"
                disabled={selectedIds.length === 0}
                onClick={openPrintPreview}
              >
                Print Selected ({selectedIds.length})
              </button>
            </div>
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-gray-500">Loading tickets…</div>
          ) : (
            <div className="divide-y">
              {ticketsList.map((t: any) => (
                <div key={t.id} className="px-4 py-3 grid grid-cols-12 items-center text-sm">
                  <div className="col-span-1">
                    <input type="checkbox" className="rounded" checked={selectedIds.includes(t.id)} onChange={() => toggleSelectOne(t.id)} />
                  </div>
                  <div className="col-span-3 font-mono">{t.code}</div>
                  <div className="col-span-3">{t.exam?.title}</div>
                  <div className="col-span-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.status === 'active' ? 'bg-green-100 text-green-700' : t.status === 'used' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{t.status}</span>
                  </div>
                  <div className="col-span-1">{t.currentUses}/{t.maxUses}</div>
                  <div className="col-span-2 text-right">{new Date(t.validFrom || t.createdAt).toLocaleDateString()} → {t.validUntil ? new Date(t.validUntil).toLocaleDateString() : '—'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Inline print fallback overlay */}
        {inlineTickets.length > 0 && (
          <div className="inline-print-root">
            {(() => {
              const tickets = inlineTickets;
              const pages: any[][] = [];
              for (let i=0;i<tickets.length;i+=6) pages.push(tickets.slice(i,i+6));
              return pages.map((page, idx) => (
                <div key={idx} className="print-sheet">
                  <div className="print-grid">
                    {page.map((t:any) => (
                      <div key={t.id || t.code} className="ticket-card">
                        <div className="ticket-header">{t.exam?.title || 'IELTS Mock Exam'}</div>
                        <div className="ticket-meta">{t.exam?.type ? String(t.exam.type).toUpperCase() : ''}</div>
                        <div className="cut-line" />
                        <div className="label">Ticket Code</div>
                        <div className="code">{t.code || t.ticket_code}</div>
                        <div className="details">
                          <div>Valid: {t.validFrom ? new Date(t.validFrom).toLocaleDateString() : new Date(t.createdAt).toLocaleDateString()} → {t.validUntil ? new Date(t.validUntil).toLocaleDateString() : '—'}</div>
                          {t.issuedToName ? <div>Issued to: {t.issuedToName}</div> : null}
                          <div>Use at: /ticket</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()}
            <style>{`
@media print {
  @page { size: A4; margin: 10mm; }
  .min-h-screen > *:not(.inline-print-root) { display: none !important; }
  .inline-print-root { display: block !important; }
  .print-sheet { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 10mm; box-sizing: border-box; }
  .print-sheet:not(:last-child) { page-break-after: always; }
  .print-grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); gap: 8mm; height: calc(297mm - 20mm); }
  .ticket-card { border: 1px dotted #9ca3af; padding: 6mm; box-sizing: border-box; border-radius: 2mm; }
  .ticket-header { font-family: Georgia, 'Times New Roman', serif; font-size: 14pt; font-weight: 600; color: #111827; }
  .ticket-meta { font-size: 9pt; color: #6b7280; margin-top: 1mm; }
  .label { font-size: 8.5pt; color: #374151; letter-spacing: .05em; text-transform: uppercase; margin-top: 3mm; }
  .code { font-family: 'Courier New', Courier, monospace; font-size: 22pt; letter-spacing: 1.2px; color: #111827; margin-top: 1mm; }
  .details { margin-top: 3mm; font-size: 9pt; color: #374151; line-height: 1.3; }
  .cut-line { border-top: 1px dotted #d1d5db; margin: 4mm 0 3mm 0; }
}
            `}</style>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminTickets;
