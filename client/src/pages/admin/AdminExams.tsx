import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Search, 
  Calendar,
  Clock,
  BookOpen,
  MoreVertical,
  Copy
} from 'lucide-react';
import type { Exam, ExamSection } from '../../types';
import { apiService } from '../../services/api';

interface SimpleSectionDraft {
  id: string;
  sectionType: ExamSection['sectionType'];
  title: string;
  durationMinutes: number;
  description?: string;
}
interface CreateExamForm {
  title: string;
  description: string;
  examType: Exam['examType'];
  durationMinutes: number;
  sections: SimpleSectionDraft[];
  isActive: boolean;
}

const AdminExams: React.FC = () => {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [examToDelete, setExamToDelete] = useState<Exam | null>(null);

  const { data: examsResp, isLoading } = useQuery({
    queryKey: ['admin-exams'],
    queryFn: () => apiService.get<Exam[]>('/admin/exams')
  });

  const createExamMutation = useMutation({
    mutationFn: (examData: CreateExamForm) => apiService.post<Exam>('/admin/exams', examData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-exams'] });
      setShowCreateModal(false);
    }
  });

  const updateExamMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateExamForm> }) =>
      apiService.put<Exam>(`/admin/exams/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-exams'] });
      setEditingExam(null);
    }
  });

  const deleteExamMutation = useMutation({
    mutationFn: (examId: string) => apiService.delete(`/admin/exams/${examId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-exams'] });
    }
  });

  const duplicateExamMutation = useMutation({
    mutationFn: (examId: string) => apiService.post<Exam>(`/admin/exams/${examId}/duplicate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-exams'] });
    }
  });

  const exams: Exam[] = (examsResp?.data as any) || [];
  const filteredExams = exams.filter((exam: Exam) => {
    const matchesSearch = (exam.title || '').toLowerCase().includes(searchTerm.toLowerCase()) || (exam.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? exam.isActive : statusFilter === 'inactive' ? !exam.isActive : true);
    return matchesSearch && matchesStatus;
  });

  const handleCreateExam = (examData: CreateExamForm | Partial<CreateExamForm>) => {
    // Ensure required fields exist before cast
    const payload: CreateExamForm = {
      title: examData.title || '',
      description: examData.description || '',
      examType: (examData as any).examType || 'academic',
      durationMinutes: (examData as any).durationMinutes || 60,
      sections: (examData as any).sections || [],
      isActive: (examData as any).isActive || false
    };
    createExamMutation.mutate(payload);
  };

  const handleUpdateExam = (examData: Partial<CreateExamForm>) => {
    if (editingExam) {
      updateExamMutation.mutate({ id: editingExam.id, data: examData });
    }
  };

  const handleDeleteExam = (exam: Exam) => {
    setExamToDelete(exam);
  };
  const confirmDelete = () => {
    if (examToDelete) {
      deleteExamMutation.mutate(examToDelete.id, { onSuccess: () => setExamToDelete(null) });
    }
  };
  const cancelDelete = () => setExamToDelete(null);

  const handleDuplicateExam = (examId: string) => {
    duplicateExamMutation.mutate(examId);
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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Exam Management</h1>
          <p className="text-gray-600">Create and manage IELTS exams for students</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create New Exam
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <input
              type="text"
              placeholder="Search exams..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <div className="text-sm text-gray-600 flex items-center">
            {filteredExams?.length || 0} exam{filteredExams?.length !== 1 ? 's' : ''} found
          </div>
        </div>
      </div>

      {/* Exam Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  {filteredExams.map((exam: Exam) => (
          <div key={exam.id} className="bg-white rounded-lg shadow-sm border hover:shadow-md transition-shadow">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{exam.title}</h3>
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">{exam.description}</p>
                </div>
                <div className="relative">
                  <button className="p-1 text-gray-400 hover:text-gray-600">
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  <div className="absolute right-0 top-8 bg-white border rounded-lg shadow-lg py-1 z-10 min-w-[120px]">
                    <button
                      onClick={() => setEditingExam(exam)}
                      className="flex items-center w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDuplicateExam(exam.id)}
                      className="flex items-center w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Duplicate
                    </button>
                    <button
                      onClick={() => handleDeleteExam(exam)}
                      className="flex items-center w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center text-sm text-gray-600">
                  <BookOpen className="h-4 w-4 mr-2" />
                  <span>{exam.sections?.length || 0} section{(exam.sections?.length || 0) !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <Clock className="h-4 w-4 mr-2" />
                  <span>{exam.durationMinutes} minutes</span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <Calendar className="h-4 w-4 mr-2" />
                  <span>Created {exam.createdAt ? new Date(exam.createdAt).toLocaleDateString() : ''}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {exam.sections?.map((section: ExamSection) => (
                    <span
                      key={section.id}
                      className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-md"
                    >
                      {section.sectionType}
                    </span>
                  ))}
                </div>
                <div className={`px-2 py-1 rounded-full text-xs font-medium ${ exam.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800' }`}>
                  {exam.isActive ? 'active' : 'inactive'}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredExams?.length === 0 && (
        <div className="text-center py-12">
          <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No exams found</h3>
          <p className="text-gray-600">Create your first exam to get started.</p>
        </div>
      )}

      {/* Create/Edit Exam Modal */}
      {(showCreateModal || editingExam) && (
        <CreateEditExamModal
          exam={editingExam}
          onSubmit={editingExam ? handleUpdateExam : handleCreateExam}
          onClose={() => {
            setShowCreateModal(false);
            setEditingExam(null);
          }}
          isLoading={createExamMutation.isPending || updateExamMutation.isPending}
        />
      )}
      {examToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="p-5 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Delete Exam</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-700">Are you sure you want to permanently delete <span className="font-medium">{examToDelete.title}</span>? This will remove all its sections, questions, sessions, answers, and tickets. This action cannot be undone.</p>
              <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
                Cascade deletions: sessions, answers, section questions, options, tickets.
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t">
              <button onClick={cancelDelete} className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm">Cancel</button>
              <button onClick={confirmDelete} disabled={deleteExamMutation.isPending} className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 text-sm flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                {deleteExamMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface CreateEditExamModalProps {
  exam?: Exam | null;
  onSubmit: (data: CreateExamForm | Partial<CreateExamForm>) => void;
  onClose: () => void;
  isLoading: boolean;
}

const CreateEditExamModal: React.FC<CreateEditExamModalProps> = ({
  exam,
  onSubmit,
  onClose,
  isLoading
}) => {
  const [formData, setFormData] = useState<CreateExamForm>({
    title: exam?.title || '',
    description: exam?.description || '',
    examType: exam?.examType || 'academic',
    durationMinutes: exam?.durationMinutes || 60,
    sections: (exam?.sections || []).map(s => ({ id: s.id, sectionType: s.sectionType, title: s.title, durationMinutes: s.durationMinutes, description: s.description })),
    isActive: !!exam?.isActive
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const addSection = () => {
    const newSection: SimpleSectionDraft = { id: `temp-${Date.now()}`, sectionType: 'reading', title: '', durationMinutes: 30, description: '' };
    setFormData(prev => ({ ...prev, sections: [...prev.sections, newSection] }));
  };

  const removeSection = (index: number) => {
    setFormData(prev => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== index)
    }));
  };

  const updateSection = (index: number, field: keyof SimpleSectionDraft, value: any) => {
    setFormData(prev => ({
      ...prev,
      sections: prev.sections.map((section, i) => i === index ? { ...section, [field]: value } : section)
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            {exam ? 'Edit Exam' : 'Create New Exam'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Exam Title
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Duration (minutes)
              </label>
              <input
                type="number"
                value={formData.durationMinutes}
                onChange={(e) => setFormData(prev => ({ ...prev, durationMinutes: parseInt(e.target.value) }))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="1"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Active
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={formData.isActive} onChange={(e)=> setFormData(prev=>({...prev, isActive: e.target.checked}))} className="rounded border-gray-300" /> Active
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Exam Type
              </label>
              <select
                value={formData.examType}
                onChange={(e) => setFormData(prev => ({ ...prev, examType: e.target.value as any }))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="academic">Academic</option>
                <option value="general_training">General Training</option>
              </select>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              rows={3}
              required
            />
          </div>

          {/* Sections */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Exam Sections</h3>
              <button
                type="button"
                onClick={addSection}
                className="flex items-center px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Section
              </button>
            </div>

            <div className="space-y-4">
              {formData.sections.map((section, index) => (
                <div key={section.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Section Type
                      </label>
                      <select
                        value={section.sectionType}
                        onChange={(e) => updateSection(index, 'sectionType', e.target.value as any)}
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="reading">Reading</option>
                        <option value="listening">Listening</option>
                        <option value="writing">Writing</option>
                        <option value="speaking">Speaking</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Time Limit (minutes)
                      </label>
                      <input
                        type="number"
                        value={section.durationMinutes}
                        onChange={(e) => updateSection(index, 'durationMinutes', parseInt(e.target.value))}
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        min="1"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => removeSection(index)}
                        className="flex items-center px-3 py-2 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Remove
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Section Title
                    </label>
                    <input
                      type="text"
                      value={section.title}
                      onChange={(e) => updateSection(index, 'title', e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder={`${section.sectionType.charAt(0).toUpperCase() + section.sectionType.slice(1)} Section`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-6 border-t">
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
              {isLoading ? 'Saving...' : (exam ? 'Update Exam' : 'Create Exam')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminExams;

