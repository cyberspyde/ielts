import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';

const AdminStudents: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users', { search }],
    queryFn: async () => {
      const res = await apiService.get<any>('/admin/users', { role: 'student', search, limit: 20 });
      return (res.data as any)?.users || [];
    }
  });

  const updateUser = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: any }) => apiService.put(`/users/${id}`, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] })
  });

  const deleteUser = useMutation({
    mutationFn: async (id: string) => apiService.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] })
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Students</h1>
          <div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search students..." className="rounded-md border-gray-300" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 text-sm text-gray-600">Manage student accounts</div>
          <div className="p-6">
            {isLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
            ) : (users || []).length === 0 ? (
              <div className="text-sm text-gray-500">No students found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {(users as any[]).map((u) => (
                      <tr key={u.id}>
                        <td className="px-4 py-2 text-sm text-gray-900">{u.firstName} {u.lastName}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{u.email}</td>
                        <td className="px-4 py-2 text-sm">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${u.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{u.status}</span>
                        </td>
                        <td className="px-4 py-2 text-right space-x-2">
                          <button onClick={() => updateUser.mutate({ id: u.id, payload: { status: u.status === 'active' ? 'inactive' : 'active' } })} className="px-3 py-1.5 text-sm border rounded">{u.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                          <button onClick={() => deleteUser.mutate(u.id)} className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminStudents;
