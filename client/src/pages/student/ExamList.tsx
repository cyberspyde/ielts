import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Calendar, Clock, BookOpen, Play, Search, Filter } from 'lucide-react';
import type { ExamFilters, SortOptions } from '../../types';
import { apiService } from '../../services/api';

const ExamList: React.FC = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ExamFilters>({
    search: '',
    section: '',
    difficulty: '',
    status: 'active'
  });
  const [sortBy, setSortBy] = useState<SortOptions>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const { data: examsResponse, isLoading, error } = useQuery({
    queryKey: ['exams', filters, sortBy, sortOrder],
    queryFn: async () => {
      const res = await apiService.get<{ exams: any[]; pagination: any }>('/exams', { ...filters, sortBy, sortOrder });
      return res.data?.exams || [];
    }
  });

  const handleStartExam = (examId: string) => {
    navigate(`/exam/${examId}`);
  };

  const handleFilterChange = (key: keyof ExamFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleSortChange = (field: SortOptions) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Error Loading Exams</h2>
          <p className="text-gray-600">Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Available Exams</h1>
        <p className="text-gray-600">Choose an exam to start practicing for your IELTS test</p>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <input
              type="text"
              placeholder="Search exams..."
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Section Filter */}
          <select
            value={filters.section}
            onChange={(e) => handleFilterChange('section', e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">All Sections</option>
            <option value="reading">Reading</option>
            <option value="listening">Listening</option>
            <option value="writing">Writing</option>
            <option value="speaking">Speaking</option>
          </select>

          {/* Difficulty Filter */}
          <select
            value={filters.difficulty}
            onChange={(e) => handleFilterChange('difficulty', e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">All Difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>

          {/* Status Filter */}
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="active">Active</option>
            <option value="upcoming">Upcoming</option>
            <option value="completed">Completed</option>
          </select>

          {/* Clear Filters */}
          <button
            onClick={() => setFilters({ search: '', section: '', difficulty: '', status: 'active' })}
            className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Sort Options */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <span className="text-sm font-medium text-gray-700">Sort by:</span>
          <button
            onClick={() => handleSortChange('title')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              sortBy === 'title' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Title
          </button>
          <button
            onClick={() => handleSortChange('duration')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              sortBy === 'duration' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Duration
          </button>
          <button
            onClick={() => handleSortChange('createdAt')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              sortBy === 'createdAt' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Date Created
          </button>
        </div>
        <div className="text-sm text-gray-600">
          {examsResponse?.length || 0} exam{(examsResponse?.length || 0) !== 1 ? 's' : ''} found
        </div>
      </div>

      {/* Exam Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {examsResponse?.map((exam: any) => (
          <div key={exam.id} className="bg-white rounded-lg shadow-sm border hover:shadow-md transition-shadow">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{exam.title}</h3>
                  <p className="text-sm text-gray-600 mb-3">{exam.description}</p>
                </div>
                <div className={`px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800`}>
                  Active
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center text-sm text-gray-600">
                  <BookOpen className="h-4 w-4 mr-2" />
                  <span>{exam.sectionCount ?? 0} section{(exam.sectionCount ?? 0) !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <Clock className="h-4 w-4 mr-2" />
                  <span>{exam.durationMinutes ?? exam.duration ?? 0} minutes</span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <Calendar className="h-4 w-4 mr-2" />
                  <span>Created {new Date(exam.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {Array.from({ length: exam.sectionCount ?? 0 }).map((_, i) => (
                    <span
                      key={i}
                      className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-md"
                    >
                      Section {i + 1}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleStartExam(exam.id)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700`}
                  >
                    <Play className="h-3 w-3" />
                    Start Exam
                  </button>
                  <button
                    onClick={() => navigate(`/exam/${exam.id}?section=reading`)}
                    className="px-2 py-1 rounded-md text-xs border border-gray-300 hover:bg-gray-50"
                  >
                    Reading only
                  </button>
                  <button
                    onClick={() => navigate(`/exam/${exam.id}?section=listening`)}
                    className="px-2 py-1 rounded-md text-xs border border-gray-300 hover:bg-gray-50"
                  >
                    Listening only
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {examsResponse?.length === 0 && (
        <div className="text-center py-12">
          <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No exams found</h3>
          <p className="text-gray-600">Try adjusting your filters or check back later for new exams.</p>
        </div>
      )}
    </div>
  );
};

export default ExamList;
