import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  BookOpen, 
  Clock, 
  Award, 
  Calendar, 
  ArrowRight, 
  CheckCircle,
  AlertCircle,
  TrendingUp
} from 'lucide-react';

import { useAuth } from '../../contexts/AuthContext';
import { apiService } from '../../services/api';
// Types currently unused; keep imports minimal

export const StudentDashboard: React.FC = () => {
  const { user } = useAuth();

  // Fetch available exams
  const { data: examsData, isLoading: examsLoading } = useQuery({
    queryKey: ['exams'],
    queryFn: async () => {
      const response = await apiService.get<any>('/exams');
      return response.data?.exams || [];
    },
  });

  // Fetch active (ongoing) sessions
  const { data: activeSessions, refetch: refetchActive } = useQuery({
    queryKey: ['activeSessions'],
    queryFn: async () => {
      const res = await apiService.get<any>('/exams/sessions/active');
      return (res.data as any)?.sessions || [];
    }
  });

  // Fetch recent results
  const { data: resultsData, isLoading: resultsLoading } = useQuery({
    queryKey: ['results'],
    queryFn: async () => {
      // Placeholder: no dedicated endpoint implemented for listing user results
      return [] as any[];
    },
  });

  const availableExams = (examsData || []).filter((exam: any) => exam.isActive !== false);
  const recentResults = resultsData?.slice(0, 5) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Welcome back, {user?.firstName}!
              </h1>
              <p className="text-gray-600">
                Ready to take your IELTS exam? Here's your dashboard overview.
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                to="/exams"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors duration-200"
              >
                <BookOpen className="h-4 w-4 mr-2" />
                View All Exams
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <BookOpen className="h-8 w-8 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Available Exams</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {examsLoading ? '...' : availableExams.length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Completed Exams</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {resultsLoading ? '...' : recentResults.length}
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
                <p className="text-sm font-medium text-gray-500">Average Score</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {resultsLoading || recentResults.length === 0 
                    ? 'N/A' 
                    : `${Math.round(recentResults.reduce((acc, result) => acc + result.percentage, 0) / recentResults.length)}%`
                  }
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Ongoing Sessions */}
        <div className="mb-8 bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Ongoing Sessions</h2>
              <p className="text-sm text-gray-600">Resume or discard not-submitted exams</p>
            </div>
            <button onClick={() => refetchActive()} className="text-sm text-blue-600 hover:text-blue-500">Refresh</button>
          </div>
          <div className="p-6">
            {(activeSessions || []).length === 0 ? (
              <div className="text-sm text-gray-500">No ongoing sessions.</div>
            ) : (
              <div className="space-y-3">
                {(activeSessions as any[]).map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                    <div>
                      <div className="font-medium text-gray-900">{s.exam?.title || 'Exam'}</div>
                      <div className="text-xs text-gray-500">Expires at {new Date(s.expiresAt).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link to={`/exam/${s.examId}`} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Resume</Link>
                      <button
                        onClick={async () => { await apiService.delete(`/exams/sessions/${s.id}`); refetchActive(); }}
                        className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50"
                      >Discard</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Available Exams */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Available Exams</h2>
              <p className="text-sm text-gray-600">Exams you can take right now</p>
            </div>
            <div className="p-6">
              {examsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : availableExams.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No exams available</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Check back later for new exams or contact your administrator.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {availableExams.slice(0, 3).map((exam: any) => (
                    <div
                      key={exam.id}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                    >
                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-gray-900">{exam.title}</h3>
                        <p className="text-sm text-gray-500">{exam.description}</p>
                        <div className="flex items-center mt-2 text-xs text-gray-500">
                          <Clock className="h-3 w-3 mr-1" />
                          {exam.durationMinutes ?? exam.duration ?? 0} minutes
                        </div>
                      </div>
                      <Link
                        to={`/exam/${exam.id}`}
                        className="ml-4 inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors duration-200"
                      >
                        Start
                        <ArrowRight className="ml-1 h-3 w-3" />
                      </Link>
                    </div>
                  ))}
                  {availableExams.length > 3 && (
                    <div className="text-center pt-4">
                      <Link
                        to="/exams"
                        className="text-sm text-blue-600 hover:text-blue-500 font-medium"
                      >
                        View all {availableExams.length} exams
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Recent Results */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Recent Results</h2>
              <p className="text-sm text-gray-600">Your latest exam performances</p>
            </div>
            <div className="p-6">
              {resultsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : recentResults.length === 0 ? (
                <div className="text-center py-8">
                  <TrendingUp className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No results yet</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Complete your first exam to see your results here.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentResults.map((result) => (
                    <div
                      key={result.id}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                    >
                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-gray-900">
                          {result.exam?.title || 'Exam'}
                        </h3>
                        <div className="flex items-center mt-1 text-xs text-gray-500">
                          <Calendar className="h-3 w-3 mr-1" />
                          {new Date(result.completedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-gray-900">
                          {result.percentage}%
                        </div>
                        <div className="text-xs text-gray-500">
                          Band {result.bandScore}
                        </div>
                      </div>
                      {/* Results view disabled for students */}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8 bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Quick Actions</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Link
                to="/exams"
                className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors duration-200"
              >
                <BookOpen className="h-6 w-6 text-blue-600 mr-3" />
                <div>
                  <h3 className="text-sm font-medium text-gray-900">Browse Exams</h3>
                  <p className="text-xs text-gray-500">View all available exams</p>
                </div>
              </Link>
              
              <Link
                to="/ticket"
                className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors duration-200"
              >
                <Award className="h-6 w-6 text-green-600 mr-3" />
                <div>
                  <h3 className="text-sm font-medium text-gray-900">Use Ticket</h3>
                  <p className="text-xs text-gray-500">Enter exam ticket code</p>
                </div>
              </Link>
              
              <div className="flex items-center p-4 border border-gray-200 rounded-lg bg-gray-50">
                <TrendingUp className="h-6 w-6 text-gray-400 mr-3" />
                <div>
                  <h3 className="text-sm font-medium text-gray-500">Practice Tests</h3>
                  <p className="text-xs text-gray-400">Coming soon</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
