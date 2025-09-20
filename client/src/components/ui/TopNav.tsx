import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const HIDDEN_PATHS = new Set(['/login', '/register', '/ticket']);

const TopNav: React.FC = () => {
  const { isAuthenticated, user, logout } = useAuth();
  const { pathname } = useLocation();

  const isExamRoute = /^\/exam\//.test(pathname);
  if (!isAuthenticated || HIDDEN_PATHS.has(pathname) || isExamRoute) return null;

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  return (
    <div className="bg-white border-b sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center space-x-6">
            <Link to="/dashboard" className="text-gray-900 font-semibold">IELTS Platform</Link>
            <nav className="hidden md:flex items-center space-x-4">
              <Link to="/dashboard" className="text-gray-700 hover:text-gray-900">Dashboard</Link>
              <Link to="/exams" className="text-gray-700 hover:text-gray-900">Exams</Link>
              {isAdmin && (
                <>
                  <Link to="/admin" className="text-gray-700 hover:text-gray-900">Admin</Link>
                  <Link to="/admin/sessions" className="text-gray-700 hover:text-gray-900">Sessions</Link>
                  <Link to="/admin/tickets" className="text-gray-700 hover:text-gray-900">Tickets</Link>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center space-x-3">
            <span className="hidden sm:block text-sm text-gray-600">{user?.firstName} {user?.lastName}</span>
            <button onClick={logout} className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-black">Logout</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TopNav;


