import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    // 다음 렌더링에서 폴백 UI를 보여주기 위해 상태를 업데이트합니다.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 에러 로깅 서비스에 에러를 보고할 수 있습니다
    console.error('Error caught by boundary:', error, errorInfo);
    
    // 개발 환경에서 추가 정보 로깅
    if (process.env.NODE_ENV === 'development') {
      console.group('🚨 React Error Boundary');
      console.error('Error:', error);
      console.error('Error Info:', errorInfo);
      console.error('Component Stack:', errorInfo.componentStack);
      console.groupEnd();
    }
  }

  private handleReload = () => {
    // 페이지 새로고침
    window.location.reload();
  };

  private handleReset = () => {
    // 에러 상태 리셋
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      // 커스텀 fallback UI가 제공되었다면 사용
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 기본 에러 UI
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
          <div className="max-w-md w-full space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>앱에서 오류가 발생했습니다</AlertTitle>
              <AlertDescription className="mt-2 space-y-2">
                <p>예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</p>
                {process.env.NODE_ENV === 'development' && this.state.error && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium">
                      개발자 정보 (클릭해서 펼치기)
                    </summary>
                    <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-32">
                      {this.state.error.message}
                      {this.state.error.stack}
                    </pre>
                  </details>
                )}
              </AlertDescription>
            </Alert>
            
            <div className="flex gap-2">
              <Button 
                onClick={this.handleReset}
                variant="outline"
                className="flex-1"
              >
                다시 시도
              </Button>
              <Button 
                onClick={this.handleReload}
                className="flex-1"
              >
                페이지 새로고침
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook으로도 사용할 수 있는 래퍼 컴포넌트
export const ErrorBoundaryWrapper: React.FC<{ 
  children: ReactNode; 
  fallback?: ReactNode;
}> = ({ children, fallback }) => {
  return (
    <ErrorBoundary fallback={fallback}>
      {children}
    </ErrorBoundary>
  );
};