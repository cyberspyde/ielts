import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Ticket, BookOpen, ArrowRight } from 'lucide-react';

import { apiService } from '../../services/api';
import type { TicketValidationForm, Ticket as TicketType } from '../../types';

// Validation schema
const ticketSchema = yup.object({
  code: yup
    .string()
    .min(6, 'Ticket code must be at least 6 characters')
    .required('Ticket code is required'),
}).required();

export const TicketValidationPage: React.FC = () => {
  const [isValidating, setIsValidating] = useState(false);
  const [ticket, setTicket] = useState<TicketType | null>(null);
  const [isValid, setIsValid] = useState(false);
  
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<TicketValidationForm>({
    resolver: yupResolver(ticketSchema),
  });

  const onSubmit = async (data: TicketValidationForm) => {
    setIsValidating(true);
    try {
      const response = await apiService.get<TicketType>(`/tickets/${data.code}`);
      
      if (response.success && response.data) {
        setTicket(response.data);
        setIsValid(true);
      } else {
        throw new Error(response.message || 'Invalid ticket code');
      }
    } catch (error: any) {
      setIsValid(false);
      setTicket(null);
      console.error('Ticket validation error:', error);
    } finally {
      setIsValidating(false);
    }
  };

  const useTicket = async () => {
    if (!ticket) return;
    
    try {
      const response = await apiService.post(`/tickets/${ticket.code}/use`);
      
      if (response.success) {
        // Redirect to exam page
        navigate(`/exam/${ticket.examId}`);
      } else {
        throw new Error(response.message || 'Failed to use ticket');
      }
    } catch (error: any) {
      console.error('Use ticket error:', error);
    }
  };

  const resetForm = () => {
    reset();
    setTicket(null);
    setIsValid(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-blue-100">
            <Ticket className="h-8 w-8 text-blue-600" />
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Exam Ticket Validation
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Enter your exam ticket code to access your test
          </p>
        </div>

        {/* Ticket Validation Form */}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700">
              Ticket Code
            </label>
            <div className="mt-1 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <BookOpen className="h-5 w-5 text-gray-400" />
              </div>
              <input
                {...register('code')}
                id="code"
                type="text"
                className={`appearance-none relative block w-full pl-10 pr-3 py-2 border ${
                  errors.code ? 'border-red-300' : 'border-gray-300'
                } placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm`}
                placeholder="Enter your ticket code"
                disabled={isValidating}
              />
            </div>
            {errors.code && (
              <p className="mt-1 text-sm text-red-600">{errors.code.message}</p>
            )}
          </div>

          {/* Submit Button */}
          <div>
            <button
              type="submit"
              disabled={isValidating}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
            >
              {isValidating ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Validating...
                </div>
              ) : (
                'Validate Ticket'
              )}
            </button>
          </div>
        </form>

        {/* Ticket Information */}
        {ticket && isValid && (
          <div className="mt-6 bg-white p-6 rounded-lg shadow-md border border-green-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Valid Ticket</h3>
              <div className="flex items-center text-green-600">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                Active
              </div>
            </div>
            
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-700">Exam:</p>
                <p className="text-sm text-gray-900">{ticket.exam?.title}</p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-700">Ticket Code:</p>
                <p className="text-sm text-gray-900 font-mono">{ticket.code}</p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-700">Expires:</p>
                <p className="text-sm text-gray-900">
                  {new Date(ticket.expiresAt).toLocaleDateString()} at{' '}
                  {new Date(ticket.expiresAt).toLocaleTimeString()}
                </p>
              </div>
              
              {ticket.exam && (
                <div>
                  <p className="text-sm font-medium text-gray-700">Duration:</p>
                  <p className="text-sm text-gray-900">{ticket.exam.duration} minutes</p>
                </div>
              )}
            </div>
            
            <div className="mt-6 flex space-x-3">
              <button
                onClick={useTicket}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-md text-sm font-medium transition-colors duration-200 flex items-center justify-center"
              >
                Start Exam
                <ArrowRight className="ml-2 h-4 w-4" />
              </button>
              <button
                onClick={resetForm}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-2 px-4 rounded-md text-sm font-medium transition-colors duration-200"
              >
                Use Different Ticket
              </button>
            </div>
          </div>
        )}

        {/* Invalid Ticket Message */}
        {!isValid && ticket === null && !isValidating && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <div className="w-5 h-5 bg-red-400 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-bold">!</span>
                </div>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">
                  Invalid Ticket Code
                </h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>
                    The ticket code you entered is invalid or has expired. Please check your code and try again.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Back to Login */}
        <div className="text-center">
          <p className="text-sm text-gray-600">
            Have an account?{' '}
            <button
              onClick={() => navigate('/login')}
              className="font-medium text-blue-600 hover:text-blue-500 transition-colors duration-200"
            >
              Sign in instead
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
