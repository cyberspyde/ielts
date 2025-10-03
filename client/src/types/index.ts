// User Types
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'student' | 'admin' | 'super_admin';
  status: 'active' | 'inactive' | 'suspended' | 'pending';
  emailVerified?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthUser extends User {
  token: string;
}

// Exam Types
export interface Exam {
  id: string;
  title: string;
  description: string;
  examType: 'academic' | 'general_training';
  durationMinutes: number; // in minutes
  passingScore?: number;
  audioUrl?: string; // central listening audio for entire exam
  sections?: ExamSection[];
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExamSection {
  id: string;
  sectionType: 'reading' | 'listening' | 'writing' | 'speaking';
  title: string;
  description: string;
  // durationMinutes removed (global exam duration applies)
  questions: Question[];
  order: number;
  // legacy per-section audio removed; use Exam.audioUrl instead
  instructions?: string;
  audioUrl?: string;
  passageText?: string;
  passageTexts?: Record<string, string> | null;
  headingBank?: any;
}

// Question Types
export interface Question {
  id: string;
  sectionId: string;
  questionType: QuestionType;
  questionText: string;
  options?: QuestionOption[];
  correctAnswer?: string | string[];
  points: number;
  questionNumber: number;
  audioUrl?: string;
  imageUrl?: string;
  explanation?: string;
}

export type QuestionType = 
  | 'multiple_choice'
  | 'multi_select'
  | 'true_false'
  | 'fill_blank'
  | 'matching'
  | 'short_answer'
  | 'essay'
  | 'speaking'
  | 'drag_drop'
  | 'speaking_task'
  | 'image_labeling'
  | 'image_dnd';

export interface QuestionOption {
  id: string;
  text: string;
  letter?: string;
  order?: number;
}

// Ticket Types
export interface Ticket {
  id: string;
  code: string;
  examId: string;
  status: 'active' | 'used' | 'expired' | 'cancelled';
  validFrom?: string;
  validUntil: string;
  maxUses?: number;
  currentUses?: number;
  createdAt?: string;
  exam?: Exam;
}

// Exam Session Types
export interface ExamSession {
  id: string;
  examId: string;
  ticketId?: string;
  status: 'pending' | 'in_progress' | 'submitted' | 'expired' | 'cancelled';
  startedAt?: string;
  submittedAt?: string;
  expiresAt: string;
  currentSectionId?: string;
  totalScore?: number;
  percentageScore?: number;
  timeSpentSeconds?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExamAnswer {
  id: string;
  questionId: string;
  answer: string | string[];
  isCorrect?: boolean;
  points?: number;
  answeredAt: string;
}

// Result Types
export interface ExamResult {
  id: string;
  examId: string;
  studentId: string;
  sessionId: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  bandScore: number;
  sectionScores: SectionScore[];
  completedAt: string;
  createdAt: string;
  exam?: Exam;
  student?: User;
}

export interface SectionScore {
  section: string;
  score: number;
  maxScore: number;
  percentage: number;
  bandScore: number;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Form Types
export interface LoginForm {
  email: string;
  password: string;
}

export interface RegisterForm {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface TicketValidationForm {
  code: string;
}

// Dashboard Types removed: dashboard no longer used in UI

export interface ScoreDistributionBucket {
  range: string;
  count: number;
}

export interface SectionPerformanceStat {
  section: string;
  sessions: number;
  accuracyPercent: number | null;
  averageScorePercent: number | null;
}

export interface ExamAttemptsStat {
  examId: string;
  examTitle: string;
  totalAttempts: number;
  averageScore: number;
  passRate: number;
}

export interface TicketPerformerStat {
  name: string;
  ticketCode: string | null;
  averageScore: number;
  attempts: number;
}

export interface QuestionDifficultyStat {
  questionId: string;
  questionText: string;
  examTitle: string;
  section: string;
  attempts: number;
  accuracyPercent: number | null;
}

export interface AdminAnalyticsSummary {
  dateRange: {
    startDate: string;
    endDate: string;
  };
  filters: {
    examId: string | null;
  };
  totals: {
    students: number;
    exams: number;
    sessions: number;
    scoredSessions: number;
  };
  averages: {
    score: number;
    passRate: number;
  };
  scoreDistribution: ScoreDistributionBucket[];
  sectionPerformance: SectionPerformanceStat[];
  topExams: ExamAttemptsStat[];
  topTicketPerformers: TicketPerformerStat[];
  questionDifficulty: {
    hardest: QuestionDifficultyStat[];
    easiest: QuestionDifficultyStat[];
  };
  totalStudents: number;
  totalExams: number;
  totalSessions: number;
  scoredSessions: number;
  averageScore: number;
  passRate: number;
}
// Socket Types
export interface SocketEvents {
  'exam:start': (data: { examId: string; studentId: string }) => void;
  'exam:progress': (data: { sessionId: string; currentSection: number }) => void;
  'exam:submit': (data: { sessionId: string; answers: ExamAnswer[] }) => void;
  'exam:time_warning': (data: { sessionId: string; remainingTime: number }) => void;
  'exam:force_submit': (data: { sessionId: string }) => void;
  'admin:exam_monitor': (data: { examId: string; sessions: ExamSession[] }) => void;
}

// UI Types
export interface LoadingState {
  isLoading: boolean;
  error?: string;
}

export interface ModalState {
  isOpen: boolean;
  type?: string;
  data?: any;
}

// Filter and Sort Types
export interface ExamFilters {
  status?: 'active' | 'inactive' | 'all';
  dateRange?: {
    start: string;
    end: string;
  };
  search?: string;
}

export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

