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
import AdminDashboard from './pages/admin/Dashboard';
import AdminExams from './pages/admin/Exams';
import AdminExamCreate from './pages/admin/ExamCreate';
import AdminExamEdit from './pages/admin/ExamEdit';
import AdminStudents from './pages/admin/Students';
import AdminTickets from './pages/admin/Tickets';
import AdminAnalytics from './pages/admin/Analytics';
import { StudentDashboard } from './pages/student/Dashboard';
import ExamList from './pages/student/ExamList';
import ExamTaking from './pages/student/ExamTaking';
import ExamResults from './pages/student/ExamResults';
import { NotFoundPage } from './pages/NotFoundPage';
import TopNav from './components/ui/TopNav';

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
              <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/ticket" element={<TicketValidationPage />} />
                
                {/* Admin Routes */}
                <Route path="/admin" element={
                  <AdminRoute>
                    <AdminDashboard />
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
                <Route path="/admin/analytics" element={
                  <AdminRoute>
                    <AdminAnalytics />
                  </AdminRoute>
                } />
                
                {/* Student Routes */}
                <Route path="/dashboard" element={
                  <ProtectedRoute>
                    <StudentDashboard />
                  </ProtectedRoute>
                } />
                <Route path="/exams" element={
                  <ProtectedRoute>
                    <ExamList />
                  </ProtectedRoute>
                } />
                <Route path="/exam/:examId" element={
                  <ProtectedRoute>
                    <ExamTaking />
                  </ProtectedRoute>
                } />
                <Route path="/results/:sessionId" element={
                  <ProtectedRoute>
                    <ExamResults />
                  </ProtectedRoute>
                } />
                
                {/* Default redirects */}
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
              
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
