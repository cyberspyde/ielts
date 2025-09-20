import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  BookOpen, 
  Clock, 
  Award,
  Calendar,
  Download,
  Filter,
  Eye,
  EyeOff
} from 'lucide-react';
import type { AdminDashboardStats } from '../../types';
import { apiService } from '../../services/api';

interface AnalyticsFilters {
  dateRange: string;
  examId: string;
  section: string;
}

const AdminAnalytics: React.FC = () => {
  const [filters, setFilters] = useState<AnalyticsFilters>({
    dateRange: '30',
    examId: '',
    section: ''
  });
  const [showDetailedStats, setShowDetailedStats] = useState(false);

  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin-analytics', filters],
    queryFn: () => apiService.get<AdminDashboardStats>('/admin/analytics', { params: filters })
  });

  const { data: exams } = useQuery({
    queryKey: ['admin-exams'],
    queryFn: () => apiService.get('/admin/exams')
  });

  const handleFilterChange = (key: keyof AnalyticsFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const downloadReport = () => {
    // Implementation for downloading analytics report
    console.log('Downloading analytics report...');
  };

  const getScoreDistribution = () => {
    if (!stats?.scoreDistribution) return [];
    return Object.entries(stats.scoreDistribution).map(([range, count]) => ({
      range,
      count
    }));
  };

  const getSectionPerformance = () => {
    if (!stats?.sectionPerformance) return [];
    return Object.entries(stats.sectionPerformance).map(([section, data]) => ({
      section,
      averageScore: data.averageScore,
      totalAttempts: data.totalAttempts,
      passRate: data.passRate
    }));
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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Analytics & Reports</h1>
          <p className="text-gray-600">Comprehensive insights into platform performance and student progress</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowDetailedStats(!showDetailedStats)}
            className="flex items-center px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {showDetailedStats ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
            {showDetailedStats ? 'Hide Details' : 'Show Details'}
          </button>
          <button
            onClick={downloadReport}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
            <select
              value={filters.dateRange}
              onChange={(e) => handleFilterChange('dateRange', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Exam</label>
            <select
              value={filters.examId}
              onChange={(e) => handleFilterChange('examId', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Exams</option>
              {exams?.map((exam: any) => (
                <option key={exam.id} value={exam.id}>{exam.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Section</label>
            <select
              value={filters.section}
              onChange={(e) => handleFilterChange('section', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Sections</option>
              <option value="reading">Reading</option>
              <option value="listening">Listening</option>
              <option value="writing">Writing</option>
              <option value="speaking">Speaking</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setFilters({ dateRange: '30', examId: '', section: '' })}
              className="w-full px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Users className="h-6 w-6" color="#2563eb" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Students</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.totalStudents || 0}</p>
              <p className="text-xs text-green-600">
                +{stats?.newStudentsThisMonth || 0} this month
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <BookOpen className="h-6 w-6" color="#16a34a" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Exams</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.totalExams || 0}</p>
              <p className="text-xs text-green-600">
                {stats?.activeExams || 0} active
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Clock className="h-6 w-6" color="#ca8a04" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Exam Sessions</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.totalSessions || 0}</p>
              <p className="text-xs text-green-600">
                {stats?.completedSessions || 0} completed
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Award className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Average Score</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.averageScore ? stats.averageScore.toFixed(1) : '0.0'}
              </p>
              <p className="text-xs text-green-600">
                {stats?.passRate ? (stats.passRate * 100).toFixed(1) : '0'}% pass rate
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts and Detailed Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Score Distribution */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Score Distribution</h3>
          <div className="space-y-3">
            {getScoreDistribution().map((item) => (
              <div key={item.range} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{item.range}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-32 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ width: `${(item.count / (stats?.totalSessions || 1)) * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-8">{item.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section Performance */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Section Performance</h3>
          <div className="space-y-4">
            {getSectionPerformance().map((item) => (
              <div key={item.section} className="border-b border-gray-200 pb-3 last:border-b-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900 capitalize">{item.section}</span>
                  <span className="text-sm font-bold text-blue-600">{item.averageScore.toFixed(1)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{item.totalAttempts} attempts</span>
                  <span>{(item.passRate * 100).toFixed(1)}% pass rate</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
                  <div
                    className="bg-green-500 h-1 rounded-full"
                    style={{ width: `${item.passRate * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
        <div className="space-y-4">
          {stats?.recentActivity?.map((activity, index) => (
            <div key={index} className="flex items-center space-x-4 p-3 bg-gray-50 rounded-lg">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <Calendar className="h-4 w-4 text-blue-600" />
                </div>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{activity.description}</p>
                <p className="text-xs text-gray-500">{new Date(activity.timestamp).toLocaleString()}</p>
              </div>
              <div className="text-sm text-gray-600">
                {activity.user ? `${activity.user.firstName} ${activity.user.lastName}` : 'System'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed Statistics */}
      {showDetailedStats && (
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Detailed Statistics</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Time-based Analytics */}
            <div>
              <h4 className="font-medium text-gray-900 mb-3">Time Analytics</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Average completion time:</span>
                  <span className="font-medium">{stats?.averageCompletionTime || 0} minutes</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Fastest completion:</span>
                  <span className="font-medium">{stats?.fastestCompletionTime || 0} minutes</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Slowest completion:</span>
                  <span className="font-medium">{stats?.slowestCompletionTime || 0} minutes</span>
                </div>
              </div>
            </div>

            {/* Question Analytics */}
            <div>
              <h4 className="font-medium text-gray-900 mb-3">Question Analytics</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total questions:</span>
                  <span className="font-medium">{stats?.totalQuestions || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Average correct:</span>
                  <span className="font-medium">{stats?.averageCorrectAnswers || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Most difficult:</span>
                  <span className="font-medium">{stats?.mostDifficultSection || 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* User Engagement */}
            <div>
              <h4 className="font-medium text-gray-900 mb-3">User Engagement</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Active users (30d):</span>
                  <span className="font-medium">{stats?.activeUsers30Days || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Returning users:</span>
                  <span className="font-medium">{stats?.returningUsers || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg sessions/user:</span>
                  <span className="font-medium">{stats?.averageSessionsPerUser || 0}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Performance Trends */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance Trends</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <TrendingUp className="h-8 w-8 text-blue-600 mx-auto mb-2" />
            <p className="text-sm text-gray-600">Score Trend</p>
            <p className="text-lg font-bold text-blue-600">
              {stats?.scoreTrend ? (stats.scoreTrend > 0 ? '+' : '') + stats.scoreTrend.toFixed(1) : '0'}%
            </p>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <Users className="h-8 w-8 text-green-600 mx-auto mb-2" />
            <p className="text-sm text-gray-600">User Growth</p>
            <p className="text-lg font-bold text-green-600">
              {stats?.userGrowth ? (stats.userGrowth > 0 ? '+' : '') + stats.userGrowth.toFixed(1) : '0'}%
            </p>
          </div>
          <div className="text-center p-4 bg-yellow-50 rounded-lg">
            <BookOpen className="h-8 w-8 text-yellow-600 mx-auto mb-2" />
            <p className="text-sm text-gray-600">Exam Completion</p>
            <p className="text-lg font-bold text-yellow-600">
              {stats?.completionRate ? (stats.completionRate * 100).toFixed(1) : '0'}%
            </p>
          </div>
          <div className="text-center p-4 bg-purple-50 rounded-lg">
            <Award className="h-8 w-8 text-purple-600 mx-auto mb-2" />
            <p className="text-sm text-gray-600">Success Rate</p>
            <p className="text-lg font-bold text-purple-600">
              {stats?.successRate ? (stats.successRate * 100).toFixed(1) : '0'}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminAnalytics;

