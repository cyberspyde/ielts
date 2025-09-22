import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  Users, 
  BookOpen, 
  Award, 
  Clock, 
  AlertTriangle,
  CheckCircle,
  BarChart3,
  Plus
} from 'lucide-react';

import { useAuth } from '../../contexts/AuthContext';
import { apiService } from '../../services/api';
import type { AdminDashboardStats } from '../../types';

const AdminDashboard: React.FC = () => {
  const { user } = useAuth();

  // Fetch dashboard stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const response = await apiService.get<AdminDashboardStats>('/admin/dashboard');
      return response.data;
    },
  });

  // Fetch recent exams (use public exams endpoint and take first 5)
  const { data: exams, isLoading: examsLoading } = useQuery({
    queryKey: ['admin-exams', { limit: 5 }],
    queryFn: async () => {
      const response = await apiService.get<{ exams: any[]; pagination: any }>(
        '/exams',
        { limit: 5 }
      );
      return (response.data && (response.data as any).exams) || [];
    },
  });

  // Fetch recent students via admin users endpoint
  const { data: students, isLoading: studentsLoading } = useQuery({
    queryKey: ['admin-students', { limit: 5 }],
    queryFn: async () => {
      const response = await apiService.get<{ users: any[]; pagination: any }>(
        '/admin/users',
        { role: 'student', limit: 5 }
      );
      return (response.data && (response.data as any).users) || [];
    },
  });

  const recentExams = exams || [];
  const recentStudents = students || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Admin Dashboard
              </h1>
              <p className="text-gray-600">
                Welcome back, {user?.firstName}. Here's your platform overview.
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                to="/admin/exams"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors duration-200"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Exam
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Users className="h-8 w-8 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Total Students</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {statsLoading ? '...' : stats?.totalStudents || 0}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <BookOpen className="h-8 w-8 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Active Exams</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {statsLoading ? '...' : stats?.activeExams || 0}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Award className="h-8 w-8 text-yellow-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Total Tickets</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {statsLoading ? '...' : stats?.totalTickets || 0}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Clock className="h-8 w-8 text-purple-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Active Sessions</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {statsLoading ? '...' : stats?.examSessions?.active || 0}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Used Tickets</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {statsLoading ? '...' : stats?.usedTickets || 0}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Success Rate</p>
                <p className="text-lg font-semibold text-green-600">
                  {statsLoading || !stats?.totalTickets 
                    ? '0%' 
                    : `${Math.round((stats.usedTickets / stats.totalTickets) * 100)}%`
                  }
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Completed Exams</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {statsLoading ? '...' : stats?.examSessions?.completed || 0}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Abandoned</p>
                <p className="text-lg font-semibold text-red-600">
                  {statsLoading ? '...' : stats?.examSessions?.abandoned || 0}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Pending Tickets</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {statsLoading ? '...' : stats?.pendingTickets || 0}
                </p>
              </div>
              <div className="text-right">
                <AlertTriangle className="h-6 w-6 text-yellow-500" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Exams */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-medium text-gray-900">Recent Exams</h2>
                <p className="text-sm text-gray-600">Latest exam activities</p>
              </div>
              <Link
                to="/admin/exams"
                className="text-sm text-blue-600 hover:text-blue-500 font-medium"
              >
                View all
              </Link>
            </div>
            <div className="p-6">
              {examsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : recentExams.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No exams yet</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Create your first exam to get started.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentExams.map((exam: any) => (
                    <div
                      key={exam.id}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                    >
                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-gray-900">{exam.title}</h3>
                        <p className="text-sm text-gray-500">{exam.description}</p>
                        <div className="flex items-center mt-2 text-xs text-gray-500">
                          <Clock className="h-3 w-3 mr-1" />
                          {exam.durationMinutes ?? exam.duration ?? 0} minutes
                          <span className="mx-2">•</span>
                          {(exam.isActive ?? true) ? (
                            <span className="text-green-600 flex items-center">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Active
                            </span>
                          ) : (
                            <span className="text-gray-500">Inactive</span>
                          )}
                        </div>
                      </div>
                      <Link
                        to={`/admin/exams/${exam.id}/edit`}
                        className="ml-4 inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors duration-200"
                      >
                        Manage
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Students */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-medium text-gray-900">Recent Students</h2>
                <p className="text-sm text-gray-600">Latest student registrations</p>
              </div>
              <Link
                to="/admin/students"
                className="text-sm text-blue-600 hover:text-blue-500 font-medium"
              >
                View all
              </Link>
            </div>
            <div className="p-6">
              {studentsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : recentStudents.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No students yet</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Students will appear here once they register.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentStudents.map((student: any) => (
                    <div
                      key={student.id}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                    >
                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-gray-900">
                          {student.firstName} {student.lastName}
                        </h3>
                        <p className="text-sm text-gray-500">{student.email}</p>
                        <div className="flex items-center mt-2 text-xs text-gray-500">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            student.isActive 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {student.isActive ? 'Active' : 'Inactive'}
                          </span>
                          <span className="mx-2">•</span>
                          Joined {new Date(student.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <Link
                        to={`/admin/students/${student.id}`}
                        className="ml-4 inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors duration-200"
                      >
                        View
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AdminDashboard;
