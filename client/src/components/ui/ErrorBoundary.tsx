import React from 'react';

interface ErrorBoundaryState { hasError: boolean; error?: any; }

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, info: any) {
    // Log if needed
    console.error('ErrorBoundary caught error', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-xl mx-auto text-center">
          <h2 className="text-xl font-semibold text-red-600 mb-3">Something went wrong.</h2>
          <p className="text-gray-600 text-sm mb-4">An unexpected error occurred while rendering this view.</p>
          <button onClick={() => this.setState({ hasError: false, error: undefined })} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;