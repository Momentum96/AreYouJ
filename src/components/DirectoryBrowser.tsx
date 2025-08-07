import { useState, useEffect } from 'react';
import { FolderIcon, ArrowUpIcon, CheckIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Directory {
  name: string;
  path: string;
}

interface DirectoryBrowserData {
  currentPath: string;
  canGoUp: boolean;
  parentPath: string | null;
  directories: Directory[];
}

interface DirectoryBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function DirectoryBrowser({ isOpen, onClose, onSelect, initialPath }: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [directories, setDirectories] = useState<Directory[]>([]);
  const [canGoUp, setCanGoUp] = useState<boolean>(false);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Reset and fetch directories when dialog opens or path changes
  useEffect(() => {
    if (isOpen) {
      const pathToUse = initialPath || '';
      setCurrentPath(pathToUse);
      fetchDirectories(pathToUse || undefined);
    }
  }, [isOpen, initialPath]);

  const fetchDirectories = async (path?: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const queryParams = path ? `?path=${encodeURIComponent(path)}` : '';
      const response = await fetch(`/api/directories${queryParams}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to fetch directories: ${response.statusText}`);
      }

      const data: DirectoryBrowserData = await response.json();
      setCurrentPath(data.currentPath);
      setDirectories(data.directories);
      setCanGoUp(data.canGoUp);
      setParentPath(data.parentPath);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch directories';
      console.error('Directory fetch error:', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    fetchDirectories(path);
  };

  const handleGoUp = () => {
    if (canGoUp && parentPath) {
      handleNavigate(parentPath);
    }
  };

  const handleSelect = () => {
    onSelect(currentPath);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>디렉터리 선택</DialogTitle>
          <DialogDescription>
            프로젝트 홈 디렉터리로 사용할 폴더를 선택해주세요.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Path */}
          <div className="px-4 py-2 bg-muted/20 rounded-lg text-sm border">
            <span className="text-muted-foreground">현재 경로: </span>
            <span className="font-mono break-all">{currentPath}</span>
          </div>

          {/* Directory List */}
          <div className="max-h-[400px] overflow-y-auto border rounded-lg">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                로딩 중...
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-32 text-red-400 text-sm p-4 text-center">
                {error}
              </div>
            ) : (
              <div className="p-2">
                {canGoUp && (
                  <button
                    onClick={handleGoUp}
                    className="flex items-center space-x-2 w-full p-3 text-left hover:bg-muted rounded text-sm transition-colors"
                  >
                    <ArrowUpIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span>..</span>
                  </button>
                )}
                {directories.map((dir) => (
                  <button
                    key={dir.path}
                    onClick={() => handleNavigate(dir.path)}
                    className="flex items-center space-x-2 w-full p-3 text-left hover:bg-muted rounded text-sm transition-colors break-words"
                  >
                    <FolderIcon className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <span className="break-all">{dir.name}</span>
                  </button>
                ))}
                {directories.length === 0 && !canGoUp && (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    이 디렉터리에는 하위 폴더가 없습니다.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded hover:bg-muted/50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSelect}
              disabled={isLoading}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded flex items-center space-x-1 transition-colors"
            >
              <CheckIcon className="w-4 h-4" />
              <span>선택</span>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}