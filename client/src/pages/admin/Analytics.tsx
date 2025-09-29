import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  BookOpen,
  Clock,
  Award,
  TrendingUp,
  RefreshCcw,
  Target,
  BarChart3,
  ListChecks
} from 'lucide-react';
import type { AdminAnalyticsSummary } from '../../types';
import { apiService } from '../../services/api';

type AnalyticsFilters = {
  dateRange: string;
  examId: string;
};

type ExamOption = {
  id: string;
  title: string;
};

const DATE_RANGE_OPTIONS = [
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'Last 365 days', value: '365' }
] as const;

const formatDateInput = (date: Date): string => date.toISOString().split('T')[0];
const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '0';
  return Number(value).toLocaleString();
};
const formatPercent = (value: number | null | undefined, fallback = 'N/A'): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return `${value.toFixed(1)}%`;
};
const formatScore = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '0.0';
  return value.toFixed(1);
};

const AdminAnalytics: React.FC = () => {
  const [filters, setFilters] = useState<AnalyticsFilters>({ dateRange: '30', examId: '' });

  const computedRange = useMemo(() => {
    const days = Number.parseInt(filters.dateRange, 10);
    const end = new Date();
    const start = new Date(end);
    if (Number.isFinite(days) && days > 0) {
      start.setDate(end.getDate() - (days - 1));
    } else {
      start.setDate(end.getDate() - 29);
    }
    return {
      startDate: formatDateInput(start),
      endDate: formatDateInput(end)
    };
  }, [filters.dateRange]);

  const analyticsQuery = useQuery<AdminAnalyticsSummary | undefined>({
    queryKey: ['admin-analytics', computedRange.startDate, computedRange.endDate, filters.examId],
    queryFn: async () => {
      const params: Record<string, string> = {
        startDate: computedRange.startDate,
        endDate: computedRange.endDate
      };
      if (filters.examId) {
        params.examId = filters.examId;
      }
      const response = await apiService.get<AdminAnalyticsSummary>('/admin/analytics', params);
      return response.data;
    }
  });

  const { data: examOptions = [] } = useQuery<ExamOption[]>({
    queryKey: ['admin-analytics-exams'],
    queryFn: async () => {
      const response = await apiService.get<any>('/admin/exams', { limit: 200 });
      const items = Array.isArray(response.data) ? response.data : [];
      return items
        .filter((item: any) => item && item.id)
        .map((item: any) => ({
          id: String(item.id),
          title: item.title || 'Untitled exam'
        }));
    }
  });

  const analytics = analyticsQuery.data;
  const isLoading = analyticsQuery.isLoading;
  const isError = analyticsQuery.isError;
  const isFetching = analyticsQuery.isFetching;

  const sectionPerformance = analytics?.sectionPerformance ?? [];
  const sortedSections = useMemo(() => {
    if (!sectionPerformance.length) return [] as typeof sectionPerformance;
    return [...sectionPerformance].sort((a, b) => (b.averageScorePercent ?? -Infinity) - (a.averageScorePercent ?? -Infinity));
  }, [sectionPerformance]);

  const strongestSection = sortedSections[0];
  const weakestSection = sortedSections.length > 1 ? sortedSections[sortedSections.length - 1] : undefined;

  const scoreDistribution = analytics?.scoreDistribution ?? [];
  const maxDistributionCount = useMemo(
    () => scoreDistribution.reduce((max, bucket) => Math.max(max, bucket.count), 0),
    [scoreDistribution]
  );

  const topExams = analytics?.topExams ?? [];
  const ticketPerformers = analytics?.topTicketPerformers ?? [];
  const hardestQuestions = analytics?.questionDifficulty?.hardest ?? [];
  const easiestQuestions = analytics?.questionDifficulty?.easiest ?? [];

  const selectedRangeOption = DATE_RANGE_OPTIONS.find((option) => option.value === filters.dateRange);

  const handleFilterChange = (key: keyof AnalyticsFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" aria-label="Loading analytics" />
          <p className="text-gray-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (isError || !analytics) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center max-w-md">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Unable to load analytics</h2>
          <p className="text-gray-600 mb-4">Please check your connection and try again.</p>
          <button
            type="button"
            onClick={() => analyticsQuery.refetch()}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Analytics Overview</h1>
            <p className="text-gray-600">Insights on exam engagement, ticket performance, and student skill strengths.</p>
            <p className="text-sm text-gray-500 mt-2">
              Showing data from
              {' '}
              <span className="font-medium text-gray-700">{analytics.dateRange.startDate}</span>
              {' '}to{' '}
              <span className="font-medium text-gray-700">{analytics.dateRange.endDate}</span>
              {filters.examId && ' for the selected exam'}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => analyticsQuery.refetch()}
            className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-60"
            disabled={isFetching}
          >
            <RefreshCcw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 sm:p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
              <select
                value={filters.dateRange}
                onChange={(event) => handleFilterChange('dateRange', event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {DATE_RANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {selectedRangeOption && (
                <p className="text-xs text-gray-500 mt-1">Preset: {selectedRangeOption.label}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Exam</label>
              <select
                value={filters.examId}
                onChange={(event) => handleFilterChange('examId', event.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All exams</option>
                {examOptions.map((exam) => (
                  <option key={exam.id} value={exam.id}>{exam.title}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col justify-end">
              <div className="bg-blue-50 border border-blue-100 rounded-md p-4">
                <p className="text-xs uppercase tracking-wide text-blue-600 font-semibold mb-1">Quick insight</p>
                {strongestSection ? (
                  <p className="text-sm text-blue-700">
                    Students perform best in
                    {' '}
                    <span className="font-medium capitalize">{strongestSection.section}</span>
                    {' '}({formatPercent(strongestSection.averageScorePercent, 'N/A')}).
                  </p>
                ) : (
                  <p className="text-sm text-blue-700">No section performance data yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                <Users className="h-5 w-5" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">Total students</p>
                <p className="text-2xl font-semibold text-gray-900">{formatNumber(analytics.totalStudents)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-green-100 text-green-600">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">Active exams</p>
                <p className="text-2xl font-semibold text-gray-900">{formatNumber(analytics.totalExams)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-indigo-100 text-indigo-600">
                <Clock className="h-5 w-5" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">Completed sessions</p>
                <p className="text-2xl font-semibold text-gray-900">{formatNumber(analytics.totalSessions)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Average score</p>
                <p className="text-2xl font-semibold text-gray-900">{formatScore(analytics.averageScore)}%</p>
                <p className="text-xs text-gray-500 mt-1">Pass rate {formatPercent(analytics.passRate)}</p>
              </div>
              <div className="p-3 rounded-full bg-purple-100 text-purple-600">
                <TrendingUp className="h-5 w-5" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
          <div className="xl:col-span-2 bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Top exams by engagement</h2>
                <BarChart3 className="h-5 w-5 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500 mt-1">Most attempted exams with average performance and pass rate.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Exam</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Attempts</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Avg score</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Pass rate</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {topExams.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-6 text-center text-sm text-gray-500">No exam activity during this period.</td>
                    </tr>
                  )}
                  {topExams.map((exam) => (
                    <tr key={exam.examId}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{exam.examTitle}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-700">{formatNumber(exam.totalAttempts)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-700">{formatScore(exam.averageScore)}%</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-700">{formatPercent(exam.passRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Top ticket performers</h2>
                <ListChecks className="h-5 w-5 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500 mt-1">Ticket holders with the highest average scores.</p>
            </div>
            <div className="p-6 space-y-4">
              {ticketPerformers.length === 0 && (
                <p className="text-sm text-gray-500">No ticket-based submissions in this period.</p>
              )}
              {ticketPerformers.map((performer) => (
                <div key={`${performer.name}-${performer.ticketCode ?? 'ticket'}`} className="border border-gray-100 rounded-md p-4 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{performer.name}</p>
                      <p className="text-xs text-gray-500">Ticket {performer.ticketCode ?? 'N/A'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-gray-900">{formatScore(performer.averageScore)}%</p>
                      <p className="text-xs text-gray-500">Across {formatNumber(performer.attempts)} attempts</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Skill performance</h2>
                <p className="text-sm text-gray-500">Average scores by section highlight strengths and gaps.</p>
              </div>
              <Target className="h-5 w-5 text-gray-400" />
            </div>
            <div className="p-6 space-y-4">
              {strongestSection && (
                <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-md p-4">
                  <div>
                    <p className="text-xs uppercase font-semibold text-green-600">Top skill</p>
                    <p className="text-sm font-medium text-gray-900 capitalize">{strongestSection.section}</p>
                  </div>
                  <p className="text-lg font-semibold text-green-600">{formatPercent(strongestSection.averageScorePercent)}</p>
                </div>
              )}
              {weakestSection && weakestSection !== strongestSection && (
                <div className="flex items-center justify-between bg-yellow-50 border border-yellow-100 rounded-md p-4">
                  <div>
                    <p className="text-xs uppercase font-semibold text-yellow-600">Needs attention</p>
                    <p className="text-sm font-medium text-gray-900 capitalize">{weakestSection.section}</p>
                  </div>
                  <p className="text-lg font-semibold text-yellow-600">{formatPercent(weakestSection.averageScorePercent)}</p>
                </div>
              )}
              <div className="space-y-3">
                {sectionPerformance.length === 0 && (
                  <p className="text-sm text-gray-500">No section-level performance data is available for the selected filters.</p>
                )}
                {sectionPerformance.map((section) => (
                  <div key={section.section} className="border border-gray-100 rounded-md px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900 capitalize">{section.section}</p>
                      <p className="text-sm text-gray-600">{formatNumber(section.sessions)} sessions</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <p className="text-gray-600">Avg score {formatPercent(section.averageScorePercent)}</p>
                      <p className="text-gray-600">Accuracy {formatPercent(section.accuracyPercent)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Score distribution</h2>
                <p className="text-sm text-gray-500">How student scores fall across band ranges.</p>
              </div>
              <Award className="h-5 w-5 text-gray-400" />
            </div>
            <div className="p-6 space-y-4">
              {scoreDistribution.length === 0 && (
                <p className="text-sm text-gray-500">No scoring data for the selected filters.</p>
              )}
              {scoreDistribution.map((bucket) => {
                const width = maxDistributionCount > 0 ? Math.max((bucket.count / maxDistributionCount) * 100, 6) : 0;
                return (
                  <div key={bucket.range}>
                    <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                      <span>{bucket.range}</span>
                      <span>{formatNumber(bucket.count)}</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Question difficulty</h2>
              <p className="text-sm text-gray-500">Hardest and easiest auto-marked questions based on accuracy.</p>
            </div>
            <BarChart3 className="h-5 w-5 text-gray-400" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
            <div className="p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                <Target className="h-4 w-4 text-red-500 mr-2" />
                Hardest questions
              </h3>
              <div className="space-y-4">
                {hardestQuestions.length === 0 && (
                  <p className="text-sm text-gray-500">Not enough graded data to determine difficult questions.</p>
                )}
                {hardestQuestions.map((question) => (
                  <div key={question.questionId} className="border border-gray-100 rounded-md p-4">
                    <p className="text-sm font-semibold text-gray-900 mb-1">{question.examTitle}</p>
                    <p className="text-xs text-gray-500 capitalize mb-2">{question.section}</p>
                    <p className="text-sm text-gray-700 truncate" title={question.questionText}>{question.questionText}</p>
                    <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                      <span>{formatNumber(question.attempts)} attempts</span>
                      <span>Accuracy {formatPercent(question.accuracyPercent)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                <Target className="h-4 w-4 text-green-500 mr-2" />
                Easiest questions
              </h3>
              <div className="space-y-4">
                {easiestQuestions.length === 0 && (
                  <p className="text-sm text-gray-500">Not enough graded data to determine easier questions.</p>
                )}
                {easiestQuestions.map((question) => (
                  <div key={question.questionId} className="border border-gray-100 rounded-md p-4">
                    <p className="text-sm font-semibold text-gray-900 mb-1">{question.examTitle}</p>
                    <p className="text-xs text-gray-500 capitalize mb-2">{question.section}</p>
                    <p className="text-sm text-gray-700 truncate" title={question.questionText}>{question.questionText}</p>
                    <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                      <span>{formatNumber(question.attempts)} attempts</span>
                      <span>Accuracy {formatPercent(question.accuracyPercent)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminAnalytics;
