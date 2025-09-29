import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Contexts
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';

// Components
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { AdminRoute } from './components/auth/AdminRoute';

// Pages
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { TicketValidationPage } from './pages/auth/TicketValidationPage';
import AdminExams from './pages/admin/Exams';
import AdminExamCreate from './pages/admin/ExamCreate';
import AdminExamEdit from './pages/admin/ExamEdit';
import AdminStudents from './pages/admin/Students';
import AdminTickets from './pages/admin/Tickets';
import AdminTicketPrint from './pages/admin/AdminTicketPrint';
import AdminAnalytics from './pages/admin/Analytics';
import AdminSessions from './pages/admin/AdminSessions';
import AdminSessionResults from './pages/admin/AdminSessionResults';
import ExamList from './pages/student/ExamList';
import ExamTaking from './pages/student/ExamTaking';
import { NotFoundPage } from './pages/NotFoundPage';
import PublicResultCheck from './pages/student/PublicResultCheck';
import TopNav from './components/ui/TopNav';
import ErrorBoundary from './components/ui/ErrorBoundary';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <SocketProvider>
            <div className="min-h-screen bg-gray-50">
              <TopNav />
              <ErrorBoundary>
              <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/ticket" element={<TicketValidationPage />} />
                
                {/* Admin Routes */}
                <Route path="/admin" element={
                  <AdminRoute>
                    <Navigate to="/admin/exams" replace />
                  </AdminRoute>
                } />
                <Route path="/admin/exams" element={
                  <AdminRoute>
                    <AdminExams />
                  </AdminRoute>
                } />
                <Route path="/admin/exams/new" element={
                  <AdminRoute>
                    <AdminExamCreate />
                  </AdminRoute>
                } />
                <Route path="/admin/exams/:examId/edit" element={
                  <AdminRoute>
                    <AdminExamEdit />
                  </AdminRoute>
                } />
                <Route path="/admin/students" element={
                  <AdminRoute>
                    <AdminStudents />
                  </AdminRoute>
                } />
                <Route path="/admin/tickets" element={
                  <AdminRoute>
                    <AdminTickets />
                  </AdminRoute>
                } />
                <Route path="/admin/tickets/print" element={
                  <AdminRoute>
                    <AdminTicketPrint />
                  </AdminRoute>
                } />
                <Route path="/admin/analytics" element={
                  <AdminRoute>
                    <AdminAnalytics />
                  </AdminRoute>
                } />
                <Route path="/admin/sessions" element={
                  <AdminRoute>
                    <AdminSessions />
                  </AdminRoute>
                } />
                <Route path="/admin/sessions/:sessionId" element={
                  <AdminRoute>
                    <AdminSessionResults />
                  </AdminRoute>
                } />
                
                {/* Student Routes */}
                <Route path="/dashboard" element={<Navigate to="/exams" replace />} />
                <Route path="/exams" element={
                  <ProtectedRoute>
                    <ExamList />
                  </ProtectedRoute>
                } />
                <Route path="/exam/:examId" element={<ExamTaking />} />
                {/* Public result check page for ticket codes */}
                <Route path="/results" element={<PublicResultCheck />} />
                
                {/* Default redirects */}
                <Route path="/" element={<Navigate to="/exams" replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
              </ErrorBoundary>
              
              {/* Global Components */}
              <ToastContainer
                position="top-right"
                autoClose={5000}
                hideProgressBar={false}
                newestOnTop={false}
                closeOnClick
                rtl={false}
                pauseOnFocusLoss
                draggable
                pauseOnHover
                theme="light"
                aria-label="Notifications"
              />
            </div>
          </SocketProvider>
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
