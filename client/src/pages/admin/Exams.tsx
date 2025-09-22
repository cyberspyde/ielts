import React, { useMemo, useState } from 'react';
import { useQuery, keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
// removed toast

import { apiService } from '../../services/api';

type ExamListItem = {
  id: string;
  title: string;
  description: string;
  examType: 'academic' | 'general_training';
  durationMinutes: number;
  passingScore: number;
  instructions?: string;
  sectionCount: number;
  createdAt: string;
  tags?: string[];
  isComposite?: boolean;
};

type ExamsListResponse = {
  exams: ExamListItem[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
};

const AdminExams: React.FC = () => {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'all' | 'academic' | 'general_training'>('all');
  const [tag, setTag] = useState('');

  const params = useMemo(() => {
    const p: Record<string, any> = { page, limit };
    if (search.trim()) p.search = search.trim();
    if (type !== 'all') p.type = type;
    if (tag.trim()) p.tag = tag.trim();
    return p;
  }, [page, limit, search, type, tag]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ExamsListResponse, Error>({
    queryKey: ['admin-exams', params],
    queryFn: async () => {
      const res = await apiService.get<ExamsListResponse>('/exams', params);
      if (!res.success || !res.data) {
        throw new Error(res.message || 'Failed to load exams');
      }
      return res.data;
    },
    placeholderData: keepPreviousData,
  });

  const onCreateExam = () => {
    window.location.href = '/admin/exams/new';
  };

  const onRefresh = () => {
    refetch();
  };

  const queryClient = useQueryClient();
  const deleteExam = useMutation({
    mutationFn: async (id: string) => apiService.delete(`/admin/exams/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-exams'] }); }
  });
  const [dialogExam, setDialogExam] = useState<ExamListItem | null>(null);

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Exams</h1>
            <p className="text-sm text-gray-600">Manage IELTS exams, schedules, and availability.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onRefresh}
              className="inline-flex items-center px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              onClick={onCreateExam}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              Create Exam
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
              <input
                value={search}
                onChange={(e) => { setPage(1); setSearch(e.target.value); }}
                placeholder="Search by title or description"
                className="w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => { setPage(1); setType(e.target.value as any); }}
                className="w-full rounded-md border-gray-300 bg-white focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="academic">Academic</option>
                <option value="general_training">General Training</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tag</label>
              <input
                value={tag}
                onChange={(e) => { setPage(1); setTag(e.target.value); }}
                placeholder="e.g. full-mock, one-skill, peter"
                className="w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Per page</label>
              <select
                value={limit}
                onChange={(e) => { setPage(1); setLimit(Number(e.target.value)); }}
                className="w-full rounded-md border-gray-300 bg-white focus:border-blue-500 focus:ring-blue-500"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {/* Table header */}
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="grid grid-cols-12 text-xs font-medium text-gray-500">
              <div className="col-span-5">Title</div>
              <div className="col-span-2">Type</div>
              <div className="col-span-2">Duration</div>
              <div className="col-span-1">Sections</div>
              <div className="col-span-2 text-right">Created</div>
            </div>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="p-6 text-center text-gray-500">Loading exams…</div>
          )}

          {/* Error state */}
          {isError && !isLoading && (
            <div className="p-6 text-center text-red-600">Failed to load exams. Please try again.</div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && data && data.exams.length === 0 && (
            <div className="p-10 text-center">
              <h3 className="text-sm font-medium text-gray-900">No exams found</h3>
              <p className="mt-1 text-sm text-gray-500">Try adjusting your filters or create a new exam.</p>
            </div>
          )}

          {/* Rows */}
          {!isLoading && !isError && data && data.exams.length > 0 && (
            <div className="divide-y divide-gray-100">
              {data.exams.map((exam: ExamListItem) => (
                <div key={exam.id} className="px-4 py-4 grid grid-cols-12 items-center">
                  <div className="col-span-5">
                    <div className="font-medium text-gray-900">{exam.title}</div>
                    <div className="text-sm text-gray-500 line-clamp-1">{exam.description}</div>
                    {exam.tags && exam.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {exam.tags.map((t, idx) => (
                          <span key={`${exam.id}-tag-${idx}`} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700 border border-gray-200">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                      {exam.examType === 'academic' ? 'Academic' : 'General Training'}
                    </span>
                  </div>
                  <div className="col-span-2 text-gray-700 text-sm">{exam.durationMinutes} min</div>
                  <div className="col-span-1 text-gray-700 text-sm">{exam.sectionCount}</div>
                  <div className="col-span-2 text-right">
                    <div className="text-sm text-gray-500">{new Date(exam.createdAt).toLocaleDateString()}</div>
                    <div className="mt-2 inline-flex gap-2">
                      <a href={`/admin/exams/${exam.id}/edit`} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Edit</a>
                      <button
                        onClick={() => setDialogExam(exam)}
                        className="px-3 py-1.5 text-sm rounded-md border border-red-300 text-red-600 hover:bg-red-50"
                      >Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {!isLoading && !isError && data && data.pagination && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
              <div className="text-gray-600">
                Page {data.pagination.currentPage} of {data.pagination.totalPages} · {data.pagination.totalCount} total
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={!data.pagination.hasPrev}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={`px-3 py-1.5 rounded-md border ${data.pagination.hasPrev ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'}`}
                >
                  Previous
                </button>
                <button
                  disabled={!data.pagination.hasNext}
                  onClick={() => setPage((p) => p + 1)}
                  className={`px-3 py-1.5 rounded-md border ${data.pagination.hasNext ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'}`}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
  </div>
  <ConfirmDialog
      open={!!dialogExam}
      title="Delete Exam"
      tone="danger"
      confirmText={deleteExam.isPending ? 'Deleting…' : 'Delete'}
      description={<>
        Are you sure you want to permanently delete exam <strong>{dialogExam?.title}</strong>?<br/>
        All sections, questions, options, sessions, answers and tickets will be removed.
      </>}
      onCancel={() => setDialogExam(null)}
      onConfirm={() => { if (dialogExam) deleteExam.mutate(dialogExam.id, { onSuccess: () => setDialogExam(null) }); }}
      loading={deleteExam.isPending}
    />
  </>
  );
};

export default AdminExams;
