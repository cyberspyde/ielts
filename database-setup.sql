-- IELTS Platform Complete Database Setup Script
-- Run this script as a PostgreSQL superuser (postgres)

-- Create database (if it doesn't exist)
SELECT 'CREATE DATABASE ielts_platform'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ielts_platform')\gexec

-- Create user (if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'ielts_user') THEN
        CREATE USER ielts_user WITH PASSWORD 'ielts_password';
    END IF;
END
$$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE ielts_platform TO ielts_user;

-- Connect to the database
\c ielts_platform;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop tables if they exist (for clean migrations)
DROP TABLE IF EXISTS exam_session_answers CASCADE;
DROP TABLE IF EXISTS exam_sessions CASCADE;
DROP TABLE IF EXISTS exam_question_options CASCADE;
DROP TABLE IF EXISTS exam_questions CASCADE;
DROP TABLE IF EXISTS exam_sections CASCADE;
DROP TABLE IF EXISTS exams CASCADE;
DROP TABLE IF EXISTS ticket_usage CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS admin_logs CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;

-- Drop types if they exist
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;
DROP TYPE IF EXISTS exam_type CASCADE;
DROP TYPE IF EXISTS exam_section_type CASCADE;
DROP TYPE IF EXISTS question_type CASCADE;
DROP TYPE IF EXISTS session_status CASCADE;
DROP TYPE IF EXISTS ticket_status CASCADE;

-- User types enum
CREATE TYPE user_role AS ENUM ('student', 'admin', 'super_admin');
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'pending');

-- Exam types and sections
CREATE TYPE exam_type AS ENUM ('academic', 'general_training');
CREATE TYPE exam_section_type AS ENUM ('listening', 'reading', 'writing', 'speaking');
CREATE TYPE question_type AS ENUM ('multiple_choice', 'true_false', 'fill_blank', 'essay', 'speaking_task', 'drag_drop', 'matching', 'short_answer', 'writing_task1', 'table_fill_blank', 'table_drag_drop', 'simple_table', 'multi_select');

-- Exam session statuses
CREATE TYPE session_status AS ENUM ('pending', 'in_progress', 'completed', 'submitted', 'expired', 'cancelled');

-- Ticket statuses
CREATE TYPE ticket_status AS ENUM ('active', 'used', 'expired', 'cancelled');

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    role user_role NOT NULL DEFAULT 'student',
    status user_status NOT NULL DEFAULT 'active',
    date_of_birth DATE,
    nationality VARCHAR(100),
    identification_number VARCHAR(50),
    profile_image_url VARCHAR(500),
    preferred_language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'UTC',
    last_login TIMESTAMP WITH TIME ZONE,
    email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User sessions table for JWT token management
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token VARCHAR(500) NOT NULL,
    device_info JSONB,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Exams table
CREATE TABLE exams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    exam_type exam_type NOT NULL,
    duration_minutes INTEGER NOT NULL, -- Total exam duration
    passing_score DECIMAL(5,2) DEFAULT 0.0,
    max_attempts INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    instructions TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Exam sections table (listening, reading, writing, speaking)
CREATE TABLE exam_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    section_type exam_section_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL,
    max_score DECIMAL(5,2) NOT NULL,
    section_order INTEGER NOT NULL,
    instructions TEXT,
    audio_url VARCHAR(500), -- For listening sections
    passage_text TEXT, -- For reading sections
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Exam questions table
CREATE TABLE exam_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID NOT NULL REFERENCES exam_sections(id) ON DELETE CASCADE,
    question_type question_type NOT NULL,
    question_text TEXT NOT NULL,
    question_number INTEGER NOT NULL,
    points DECIMAL(5,2) DEFAULT 1.0,
    time_limit_seconds INTEGER, -- Individual question time limit
    correct_answer TEXT, -- For auto-gradable questions
    explanation TEXT,
    audio_url VARCHAR(500), -- For listening questions
    image_url VARCHAR(500), -- For visual questions
    metadata JSONB, -- Additional question-specific data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Question options table (for multiple choice, matching, etc.)
CREATE TABLE exam_question_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_id UUID NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    option_letter CHAR(1), -- A, B, C, D, etc.
    is_correct BOOLEAN DEFAULT FALSE,
    option_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tickets table for exam access control
CREATE TABLE tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_code VARCHAR(20) UNIQUE NOT NULL,
    exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    issued_to_email VARCHAR(255),
    issued_to_name VARCHAR(200),
    status ticket_status NOT NULL DEFAULT 'active',
    valid_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    max_uses INTEGER DEFAULT 1,
    current_uses INTEGER DEFAULT 0,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ticket usage tracking
CREATE TABLE ticket_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Exam sessions table (tracks student exam attempts)
CREATE TABLE exam_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
    status session_status NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE,
    submitted_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    time_spent_seconds INTEGER DEFAULT 0,
    current_section_id UUID REFERENCES exam_sections(id),
    total_score DECIMAL(5,2),
    percentage_score DECIMAL(5,2),
    is_passed BOOLEAN,
    browser_info JSONB,
    security_violations JSONB[], -- Track any suspicious activities
    proctoring_data JSONB, -- Store proctoring information
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Student answers table
CREATE TABLE exam_session_answers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
    student_answer TEXT,
    is_correct BOOLEAN,
    points_earned DECIMAL(5,2) DEFAULT 0.0,
    time_spent_seconds INTEGER DEFAULT 0,
    answered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    graded_at TIMESTAMP WITH TIME ZONE,
    graded_by UUID REFERENCES users(id),
    grader_comments TEXT,
    
    -- Ensure one answer per question per session
    UNIQUE(session_id, question_id)
);

-- Admin activity logs
CREATE TABLE admin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL, -- 'exam', 'user', 'ticket', etc.
    resource_id UUID,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- System settings table
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    setting_type VARCHAR(20) DEFAULT 'string', -- 'string', 'number', 'boolean', 'json'
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE, -- Whether setting can be read by non-admins
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

CREATE INDEX idx_exams_type ON exams(exam_type);
CREATE INDEX idx_exams_active ON exams(is_active);
CREATE INDEX idx_exam_sections_exam_id ON exam_sections(exam_id);
CREATE INDEX idx_exam_sections_type ON exam_sections(section_type);
CREATE INDEX idx_exam_questions_section_id ON exam_questions(section_id);
CREATE INDEX idx_exam_question_options_question_id ON exam_question_options(question_id);

CREATE INDEX idx_tickets_code ON tickets(ticket_code);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_exam_id ON tickets(exam_id);
CREATE INDEX idx_tickets_valid_until ON tickets(valid_until);

CREATE INDEX idx_exam_sessions_user_id ON exam_sessions(user_id);
CREATE INDEX idx_exam_sessions_exam_id ON exam_sessions(exam_id);
CREATE INDEX idx_exam_sessions_status ON exam_sessions(status);
CREATE INDEX idx_exam_sessions_expires_at ON exam_sessions(expires_at);

CREATE INDEX idx_answers_session_id ON exam_session_answers(session_id);
CREATE INDEX idx_answers_question_id ON exam_session_answers(question_id);

CREATE INDEX idx_admin_logs_user_id ON admin_logs(user_id);
CREATE INDEX idx_admin_logs_action ON admin_logs(action);
CREATE INDEX idx_admin_logs_created_at ON admin_logs(created_at);

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_exams_updated_at BEFORE UPDATE ON exams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_exam_sessions_updated_at BEFORE UPDATE ON exam_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO ielts_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ielts_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ielts_user;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ielts_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ielts_user;

-- Insert default system settings
INSERT INTO system_settings (setting_key, setting_value, setting_type, description, is_public) VALUES
    ('site_name', 'IELTS Online Platform', 'string', 'Platform name', true),
    ('site_description', 'Professional IELTS Testing Platform for Best Center', 'string', 'Platform description', true),
    ('max_exam_attempts', '3', 'number', 'Maximum exam attempts per student', false),
    ('exam_session_timeout', '7200', 'number', 'Default exam session timeout in seconds', false),
    ('ticket_expiry_hours', '24', 'number', 'Default ticket expiry in hours', false),
    ('enable_proctoring', 'true', 'boolean', 'Enable exam proctoring features', false),
    ('maintenance_mode', 'false', 'boolean', 'System maintenance mode', true),
    ('registration_enabled', 'true', 'boolean', 'Allow new student registrations', true);

-- Create default admin user (password: admin123 - should be changed immediately)
INSERT INTO users (email, password_hash, first_name, last_name, role, status, email_verified) VALUES
    ('admin@bestcenter.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj3qUkzs0eC6', 'System', 'Administrator', 'super_admin', 'active', true);

-- Sample exam data for testing
INSERT INTO exams (title, description, exam_type, duration_minutes, passing_score, instructions, created_by) VALUES
    (
        'IELTS Academic Practice Test 1',
        'Complete IELTS Academic practice test with all four sections',
        'academic',
        180,
        6.5,
        'This is a complete IELTS Academic test. You have 3 hours to complete all sections. Make sure you have a quiet environment and stable internet connection.',
        (SELECT id FROM users WHERE email = 'admin@bestcenter.com')
    );

-- Sample sections for the test exam
INSERT INTO exam_sections (exam_id, section_type, title, description, duration_minutes, max_score, section_order, instructions) VALUES
    (
        (SELECT id FROM exams WHERE title = 'IELTS Academic Practice Test 1'),
        'listening',
        'Listening Section',
        'IELTS Listening test with 4 parts',
        30,
        9.0,
        1,
        'You will hear a number of different recordings and you will have to answer questions on what you hear.'
    ),
    (
        (SELECT id FROM exams WHERE title = 'IELTS Academic Practice Test 1'),
        'reading',
        'Reading Section',
        'IELTS Reading test with 3 passages',
        60,
        9.0,
        2,
        'Read the passages and answer the questions. You have 60 minutes to complete this section.'
    ),
    (
        (SELECT id FROM exams WHERE title = 'IELTS Academic Practice Test 1'),
        'writing',
        'Writing Section',
        'IELTS Writing test with 2 tasks',
        60,
        9.0,
        3,
        'Complete both writing tasks. Task 1 should be at least 150 words, Task 2 at least 250 words.'
    ),
    (
        (SELECT id FROM exams WHERE title = 'IELTS Academic Practice Test 1'),
        'speaking',
        'Speaking Section',
        'IELTS Speaking test with 3 parts',
        15,
        9.0,
        4,
        'Record your responses to the speaking prompts. Speak clearly and naturally.'
    );

-- Create sample ticket for testing
INSERT INTO tickets (ticket_code, exam_id, status, valid_until, max_uses, created_by) VALUES
    (
        'TEST123456',
        (SELECT id FROM exams WHERE title = 'IELTS Academic Practice Test 1'),
        'active',
        CURRENT_TIMESTAMP + INTERVAL '30 days',
        10,
        (SELECT id FROM users WHERE email = 'admin@bestcenter.com')
    );

-- Grant all privileges to ielts_user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ielts_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ielts_user;

COMMIT;
