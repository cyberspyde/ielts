import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Ticket, 
  Plus, 
  Search, 
  Filter, 
  Calendar,
  Copy,
  Download,
  Eye,
  Trash2,
  MoreVertical,
  CheckCircle,
  XCircle,
  Clock,
  User,
  BookOpen
} from 'lucide-react';
import type { Ticket as TicketType, Exam, User as UserType } from '../../types';
import { apiService } from '../../services/api';

interface TicketFilters {
  search: string;
  status: string;
  examId: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

interface GenerateTicketForm {
  examId: string;
  quantity: number;
  expiresAt: string;
  maxUses: number;
}

const AdminTickets: React.FC = () => {
  const queryClient = useQueryClient();
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [filters, setFilters] = useState<TicketFilters>({
    search: '',
    status: 'all',
    examId: '',
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['admin-tickets', filters],
    queryFn: () => apiService.get<TicketType[]>('/admin/tickets', { params: filters })
  });

  const { data: exams } = useQuery({
    queryKey: ['admin-exams'],
    queryFn: () => apiService.get<Exam[]>('/admin/exams')
  });

  const generateTicketsMutation = useMutation({
    mutationFn: (ticketData: GenerateTicketForm) => apiService.post<TicketType[]>('/admin/tickets/generate', ticketData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tickets'] });
      setShowGenerateModal(false);
    }
  });

  const deleteTicketMutation = useMutation({
    mutationFn: (ticketId: string) => apiService.delete(`/admin/tickets/${ticketId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tickets'] });
    }
  });

  const revokeTicketMutation = useMutation({
    mutationFn: (ticketId: string) => apiService.patch(`/admin/tickets/${ticketId}/revoke`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tickets'] });
    }
  });

  const copyTicketCode = (code: string) => {
    navigator.clipboard.writeText(code);
    // You could add a toast notification here
  };

  const downloadTickets = () => {
    // Implementation for downloading tickets as CSV
    console.log('Downloading tickets...');
  };

  const handleFilterChange = (key: keyof TicketFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleSortChange = (field: string) => {
    setFilters(prev => ({
      ...prev,
      sortBy: field,
      sortOrder: prev.sortBy === field && prev.sortOrder === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleDeleteTicket = (ticketId: string) => {
    if (window.confirm('Are you sure you want to delete this ticket? This action cannot be undone.')) {
      deleteTicketMutation.mutate(ticketId);
    }
  };

  const handleRevokeTicket = (ticketId: string) => {
    if (window.confirm('Are you sure you want to revoke this ticket? It will no longer be valid.')) {
      revokeTicketMutation.mutate(ticketId);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Ticket Management</h1>
          <p className="text-gray-600">Generate and manage exam access tickets</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={downloadTickets}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </button>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4 mr-2" />
            Generate Tickets
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Ticket className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Tickets</p>
              <p className="text-2xl font-bold text-gray-900">{tickets?.length || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Active Tickets</p>
              <p className="text-2xl font-bold text-gray-900">
                {tickets?.filter(t => t.status === 'active').length || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Clock className="h-6 w-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Used Tickets</p>
              <p className="text-2xl font-bold text-gray-900">
                {tickets?.filter(t => t.status === 'used').length || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center">
            <div className="p-2 bg-red-100 rounded-lg">
              <XCircle className="h-6 w-6 text-red-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Expired/Revoked</p>
              <p className="text-2xl font-bold text-gray-900">
                {tickets?.filter(t => t.status === 'expired' || t.status === 'revoked').length || 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <input
              type="text"
              placeholder="Search tickets..."
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="used">Used</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>
          <select
            value={filters.examId}
            onChange={(e) => handleFilterChange('examId', e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">All Exams</option>
            {exams?.map((exam) => (
              <option key={exam.id} value={exam.id}>{exam.title}</option>
            ))}
          </select>
          <select
            value={filters.sortBy}
            onChange={(e) => handleSortChange(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="createdAt">Date Created</option>
            <option value="expiresAt">Expiry Date</option>
            <option value="code">Ticket Code</option>
          </select>
          <div className="text-sm text-gray-600 flex items-center">
            {tickets?.length || 0} ticket{tickets?.length !== 1 ? 's' : ''} found
          </div>
        </div>
      </div>

      {/* Tickets Table */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Ticket Code
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Exam
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Usage
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Expires
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tickets?.map((ticket) => (
                <tr key={ticket.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="h-8 w-8 rounded bg-blue-100 flex items-center justify-center">
                          <Ticket className="h-4 w-4 text-blue-600" />
                        </div>
                      </div>
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900 font-mono">
                          {ticket.code}
                        </div>
                        <div className="text-sm text-gray-500">
                          Created {new Date(ticket.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{ticket.exam?.title}</div>
                    <div className="text-sm text-gray-500 flex items-center">
                      <BookOpen className="h-3 w-3 mr-1" />
                      {ticket.exam?.sections.length} sections
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      ticket.status === 'active' ? 'bg-green-100 text-green-800' :
                      ticket.status === 'used' ? 'bg-blue-100 text-blue-800' :
                      ticket.status === 'expired' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {ticket.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex items-center">
                      <User className="h-4 w-4 mr-1" />
                      {ticket.usedBy ? `${ticket.usedBy.firstName} ${ticket.usedBy.lastName}` : 'Not used'}
                    </div>
                    {ticket.usedAt && (
                      <div className="text-xs text-gray-400">
                        {new Date(ticket.usedAt).toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex items-center">
                      <Calendar className="h-4 w-4 mr-1" />
                      {ticket.expiresAt ? new Date(ticket.expiresAt).toLocaleDateString() : 'No expiry'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => copyTicketCode(ticket.code)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Copy ticket code"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      {ticket.status === 'active' && (
                        <button
                          onClick={() => handleRevokeTicket(ticket.id)}
                          className="text-yellow-600 hover:text-yellow-900"
                          title="Revoke ticket"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteTicket(ticket.id)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete ticket"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {tickets?.length === 0 && (
        <div className="text-center py-12">
          <Ticket className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No tickets found</h3>
          <p className="text-gray-600">Generate your first ticket to get started.</p>
        </div>
      )}

      {/* Generate Tickets Modal */}
      {showGenerateModal && (
        <GenerateTicketsModal
          exams={exams || []}
          onSubmit={(data) => generateTicketsMutation.mutate(data)}
          onClose={() => setShowGenerateModal(false)}
          isLoading={generateTicketsMutation.isPending}
        />
      )}
    </div>
  );
};

interface GenerateTicketsModalProps {
  exams: Exam[];
  onSubmit: (data: GenerateTicketForm) => void;
  onClose: () => void;
  isLoading: boolean;
}

const GenerateTicketsModal: React.FC<GenerateTicketsModalProps> = ({
  exams,
  onSubmit,
  onClose,
  isLoading
}) => {
  const [formData, setFormData] = useState<GenerateTicketForm>({
    examId: '',
    quantity: 1,
    expiresAt: '',
    maxUses: 1
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Generate Tickets</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Exam
              </label>
              <select
                value={formData.examId}
                onChange={(e) => setFormData(prev => ({ ...prev, examId: e.target.value }))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">Choose an exam...</option>
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>{exam.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quantity
              </label>
              <input
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData(prev => ({ ...prev, quantity: parseInt(e.target.value) }))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="1"
                max="100"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Expiry Date
              </label>
              <input
                type="datetime-local"
                value={formData.expiresAt}
                onChange={(e) => setFormData(prev => ({ ...prev, expiresAt: e.target.value }))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Uses per Ticket
              </label>
              <input
                type="number"
                value={formData.maxUses}
                onChange={(e) => setFormData(prev => ({ ...prev, maxUses: parseInt(e.target.value) }))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="1"
                required
              />
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-6 border-t mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? 'Generating...' : 'Generate Tickets'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminTickets;

