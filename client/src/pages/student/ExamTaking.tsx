import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Clock, ChevronLeft, ChevronRight, AlertTriangle, Send } from 'lucide-react';
import { toast } from 'react-toastify';
import { apiService } from '../../services/api';

interface TimerProps {
  duration: number;
  onTimeUp: () => void;
  isPaused: boolean;
}

const Timer: React.FC<TimerProps> = ({ duration, onTimeUp, isPaused }) => {
  const [timeLeft, setTimeLeft] = useState(duration * 60);

  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onTimeUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isPaused, onTimeUp]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="flex items-center space-x-2 font-mono text-lg font-semibold text-gray-900">
      <Clock className="h-5 w-5" />
      <span>{minutes}:{seconds.toString().padStart(2, '0')}</span>
      {isPaused && <span className="text-sm text-gray-500">(Paused)</span>}
    </div>
  );
};

const ExamTaking: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const [searchParams] = useSearchParams();
  const sectionParam = searchParams.get('section') || undefined;
  const navigate = useNavigate();

  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { questionId: string; answer: string | string[] }>>({});
  const [isPaused] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingHeading, setPendingHeading] = useState<string | null>(null);

  // Fetch exam (with questions)
  const { data: exam, isLoading: examLoading } = useQuery({
    queryKey: ['exam', examId],
    queryFn: async () => {
      const res = await apiService.get<any>(`/exams/${examId}`, { questions: 'true', ...(sectionParam ? { section: sectionParam } : {}) });
      return (res.data as any)?.exam || res.data;
    },
    enabled: !!examId
  });

  // Start session on load
  const startSession = useMutation({
    mutationFn: async (eid: string) => {
      const body: any = {};
      if (sectionParam) body.section = sectionParam;
      const res = await apiService.post<any>(`/exams/${eid}/start`, body);
      if (!res.success || !res.data) throw new Error(res.message || 'Failed to start exam');
      return (res.data as any).sessionId as string;
    },
    onSuccess: (sid) => setSessionId(sid)
  });

  useEffect(() => {
    if (exam && !sessionId) {
      startSession.mutate(exam.id);
    }
  }, [exam, sessionId]);

  // Submit
  const submit = useMutation({
    mutationFn: async (sid: string) => {
      const payload = Object.values(answers).map(a => ({ questionId: a.questionId, studentAnswer: a.answer }));
      return apiService.post(`/exams/sessions/${sid}/submit`, { answers: payload });
    },
    onSuccess: (res: any) => {
      setShowConfirmSubmit(false);
      const id = (res?.data as any)?.sessionId || sessionId;
      if (id) {
        navigate(`/results/${id}`);
      } else {
        toast.success('Exam submitted');
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to submit exam');
    }
  });

  const currentSection = exam?.sections?.[currentSectionIndex];
  const currentQuestion = currentSection?.questions?.[currentQuestionIndex];
  const isMatchingSection = (currentSection?.questions || []).some((q: any) => (q.questionType === 'matching'));
  const headingOptions: any[] = isMatchingSection
    ? ((currentSection as any)?.headingBank?.options ||
       ((currentSection?.questions || []).find((q: any) => q.questionType === 'matching')?.options || []))
    : [];

  // Line-drawing refs
  const bankRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const questionAnchorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [lines, setLines] = useState<Array<{ x1:number; y1:number; x2:number; y2:number; key: string }>>([]);

  const recalcLines = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const containerRect = scrollContainerRef.current.getBoundingClientRect();
    const newLines: Array<{ x1:number; y1:number; x2:number; y2:number; key: string }> = [];
    (currentSection?.questions || []).forEach((q: any) => {
      const letter = (answers[q.id]?.answer as string) || '';
      if (!letter) return;
      const bankEl = bankRefs.current[letter];
      const anchorEl = questionAnchorRefs.current[q.id];
      if (!bankEl || !anchorEl) return;
      const a = bankEl.getBoundingClientRect();
      const b = anchorEl.getBoundingClientRect();
      newLines.push({
        x1: a.left + a.width / 2 - containerRect.left,
        y1: a.top + a.height / 2 - containerRect.top,
        x2: b.left + 8 - containerRect.left,
        y2: b.top + b.height / 2 - containerRect.top,
        key: q.id,
      });
    });
    setLines(newLines);
  }, [answers, currentSection]);

  useEffect(() => {
    recalcLines();
  }, [recalcLines]);

  useEffect(() => {
    const handler = () => recalcLines();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [recalcLines]);

  const goToQuestion = (sectionIndex: number, questionIndex: number) => {
    setCurrentSectionIndex(sectionIndex);
    setCurrentQuestionIndex(questionIndex);
  };

  const goToNextQuestion = () => {
    if (currentQuestionIndex < (currentSection?.questions?.length || 0) - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else if (currentSectionIndex < (exam?.sections?.length || 0) - 1) {
      setCurrentSectionIndex(prev => prev + 1);
      setCurrentQuestionIndex(0);
    }
  };

  const goToPreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    } else if (currentSectionIndex > 0) {
      const prevLen = exam?.sections?.[currentSectionIndex - 1]?.questions?.length || 1;
      setCurrentSectionIndex(prev => prev - 1);
      setCurrentQuestionIndex(prevLen - 1);
    }
  };

  const handleAnswerChange = (questionId: string, answer: string | string[]) => {
    setAnswers(prev => ({ ...prev, [questionId]: { questionId, answer } }));
  };

  const handleTimeUp = useCallback(() => {
    if (sessionId) submit.mutate(sessionId);
  }, [sessionId]);

  if (examLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Exam Not Found</h2>
          <p className="text-gray-600">The exam you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{exam.title}</h1>
              <p className="text-sm text-gray-600">
                Section {currentSectionIndex + 1} of {exam.sections.length}: {currentSection?.title || currentSection?.sectionType}
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <Timer duration={currentSection?.durationMinutes || exam.durationMinutes || 60} onTimeUp={handleTimeUp} isPaused={isPaused} />
              <button onClick={() => setShowConfirmSubmit(true)} className="flex items-center px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">
                <Send className="h-4 w-4 mr-1" />
                Submit
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto px-0 py-0">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
          {/* Left column: passage (for reading) */}
          <div className={(currentSection?.sectionType || '').toLowerCase() === 'reading' ? 'lg:col-span-6' : 'lg:col-span-6'}>
            <div className="bg-white shadow-sm border rounded-none flex flex-col h-[calc(100vh-180px)]">
              <div className="p-2 md:p-3 flex-1 overflow-auto">
                {(currentSection?.sectionType || '').toLowerCase() === 'reading' ? (
                  <>
                    <h3 className="font-semibold text-gray-900 mb-3">Reading Passage</h3>
                    <div className="prose max-w-none text-gray-800 whitespace-pre-wrap">
                      {currentSection?.passageText || 'No passage text set for this section.'}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-gray-500">Navigate questions using the chips below.</div>
                )}
              </div>
            </div>
          </div>

          

          {/* Right column: question list */}
          <div className="lg:col-span-6">
            <div className="bg-white shadow-sm border-l rounded-none flex flex-col h-[calc(100vh-180px)]">
              <div className="p-2 md:p-3 flex-1 overflow-auto relative" ref={scrollContainerRef}>
                {isMatchingSection && (
                  <div className="mb-4">
                    <div className="text-sm font-medium text-gray-700 mb-2">Headings</div>
                    <div className="flex flex-wrap gap-2">
                      {headingOptions.map((opt: any, idx: number) => {
                        const letter = opt.letter || opt.option_letter || String.fromCharCode(65 + idx);
                        const isActive = pendingHeading === letter;
                        return (
                          <button
                            key={letter}
                            ref={(el) => { bankRefs.current[letter] = el; }}
                            onClick={() => setPendingHeading(isActive ? null : letter)}
                            className={`px-2.5 py-1 rounded border text-sm ${isActive ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'}`}
                            title={opt.text || opt.option_text}
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                    {pendingHeading && (
                      <div className="mt-1 text-xs text-blue-600">Selected: {pendingHeading} — click a paragraph/question to assign</div>
                    )}
                  </div>
                )}
                {/* SVG overlay for lines */}
                {isMatchingSection && lines.length > 0 && (
                  <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
                    {lines.map((l) => (
                      <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#2563eb" strokeWidth="2" strokeOpacity="0.8" />
                    ))}
                  </svg>
                )}
                {(currentSection?.questions || []).map((q: any, idx: number) => (
                  <div key={q.id} className="mb-3 pb-3 border-b last:border-0 last:pb-0">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <span className="text-sm font-medium text-gray-500">Question {idx + 1}</span>
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full">{q.questionType}</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div ref={(el) => { questionAnchorRefs.current[q.id] = el; }} className="w-2 h-2 mt-2 rounded-full bg-blue-500 opacity-60"></div>
                      <h3 className="text-lg font-medium text-gray-900 mb-3 flex-1">{q.questionText || q.text}</h3>
                    </div>

                    {(currentSection?.sectionType || '').toLowerCase() === 'listening' && currentSection?.audioUrl && idx === 0 && (
                      <div className="mb-3">
                        <audio controls src={currentSection.audioUrl} className="w-full">
                          Your browser does not support the audio element.
                        </audio>
                      </div>
                    )}

                    {(q.passage) && (
                      <div className="bg-gray-50 p-3 rounded mb-3">
                        <h4 className="font-medium text-gray-900 mb-2">Passage:</h4>
                        <div className="text-gray-700 leading-relaxed">{q.passage}</div>
                      </div>
                    )}

                    {(q.questionType === 'multiple_choice' || q.type === 'multiple_choice' || q.questionType === 'matching') && (
                      <div className="space-y-2.5">
                        {(q.options || []).map((option: any, index: number) => {
                          const value = option.letter || option.text || option;
                          const isSelected = answers[q.id]?.answer === value;
                          return (
                            <label key={index} className="flex items-center p-3 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer">
                              <input
                                type="radio"
                                name={`question-${q.id}`}
                                value={value}
                                checked={isSelected}
                                onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                className="mr-3"
                              />
                              {option.letter && (
                                <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 mr-2">
                                  {option.letter}
                                </span>
                              )}
                              <span className="text-gray-900">{option.text || option}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {isMatchingSection && q.questionType === 'matching' && (
                      <button
                        onClick={() => {
                          if (!pendingHeading) return;
                          handleAnswerChange(q.id, pendingHeading);
                          setPendingHeading(null);
                        }}
                        className="mt-2 px-3 py-1.5 text-sm rounded border border-blue-200 text-blue-700 hover:bg-blue-50"
                      >
                        {answers[q.id]?.answer ? `Assigned: ${answers[q.id]?.answer}` : 'Assign selected heading'}
                      </button>
                    )}

                    {(q.questionType === 'true_false') && (
                      <div className="space-y-2.5">
                        {['True','False','Not Given'].map((label, idx) => (
                          <label key={idx} className="flex items-center p-3 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer">
                            <input
                              type="radio"
                              name={`question-${q.id}`}
                              value={label}
                              checked={answers[q.id]?.answer === label}
                              onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                              className="mr-3"
                            />
                            <span className="text-gray-900">{label}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    {(q.questionType === 'essay' || q.type === 'text') && (
                      <textarea
                        value={(answers[q.id]?.answer as string) || ''}
                        onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                        placeholder="Enter your answer..."
                        className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                        rows={6}
                      />
                    )}

                    {(q.questionType === 'fill_blank' || q.type === 'number') && (
                      <input
                        type="text"
                        value={(answers[q.id]?.answer as string) || ''}
                        onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                        placeholder="Enter your answer..."
                        className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="p-4 border-t flex items-center gap-2">
                <button
                  onClick={() => {
                    const ids = (currentSection?.questions || []).map((qq: any) => qq.id);
                    setAnswers(prev => {
                      const next = { ...prev } as typeof prev;
                      ids.forEach((qid: string) => { if (next[qid]) delete next[qid]; });
                      return next;
                    });
                  }}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Reset Answers
                </button>
                <button onClick={() => setShowConfirmSubmit(true)} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">Submit Answers</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Full-width bottom navigation */}
      <div className="sticky bottom-0 left-0 right-0 bg-white border-t">
        <div className="container mx-auto px-2 md:px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {(currentSection?.questions || []).map((q: any, idx: number) => {
              const isAnswered = answers[q.id];
              const isCurrent = idx === currentQuestionIndex;
              return (
                <button key={q.id} onClick={() => goToQuestion(currentSectionIndex, idx)} className={`w-8 h-8 text-xs rounded border flex items-center justify-center ${isCurrent ? 'bg-blue-600 text-white border-blue-600' : isAnswered ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'}`}>
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showConfirmSubmit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <AlertTriangle className="h-6 w-6 text-red-600 mr-2" />
              <h3 className="text-lg font-semibold">Submit Exam</h3>
            </div>
            <p className="text-gray-600 mb-6">Are you sure you want to submit your exam? This action cannot be undone.</p>
            <div className="flex space-x-3">
              <button onClick={() => setShowConfirmSubmit(false)} className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => sessionId && submit.mutate(sessionId)} disabled={submit.isPending} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {submit.isPending ? 'Submitting...' : 'Submit Exam'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExamTaking;
