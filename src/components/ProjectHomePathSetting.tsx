import { useState, useEffect } from 'react';
import { FolderIcon, FolderOpenIcon } from 'lucide-react';
import { DirectoryBrowser } from './DirectoryBrowser';

interface ProjectHomePathSettingProps {
  className?: string;
}

export function ProjectHomePathSetting({ className }: ProjectHomePathSettingProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDirectoryBrowser, setShowDirectoryBrowser] = useState(false);

  // 초기 settings 로드
  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/settings');
      if (!response.ok) {
        throw new Error(`Failed to fetch settings: ${response.statusText}`);
      }
      const data = await response.json();
      setCurrentPath(data.settings.projectHomePath || '');
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load settings';
      console.error('Settings fetch error:', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBrowse = () => {
    setError(null);
    setShowDirectoryBrowser(true);
  };


  const handleDirectorySelect = async (selectedPath: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/settings/home-path', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectHomePath: selectedPath }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to update path: ${response.statusText}`);
      }

      const data = await response.json();
      setCurrentPath(data.settings.projectHomePath);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update path';
      console.error('Path update error:', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };


  const formatPath = (path: string) => {
    if (!path) return '';
    return path.length > 50 ? `...${path.slice(-47)}` : path;
  };

  return (
    <>
      <div className={`flex items-center space-x-2 ${className}`}>
        <FolderIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        
        <div className="flex items-center space-x-1 group">
          <span 
            className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
            title={currentPath}
            onClick={handleBrowse}
          >
            {isLoading ? 'Loading...' : formatPath(currentPath) || 'Set project path'}
          </span>
          <button
            onClick={handleBrowse}
            className="p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
            title="Browse directory"
          >
            <FolderOpenIcon className="w-3 h-3" />
          </button>
        </div>

        {error && (
          <div className="text-xs text-red-400 max-w-xs truncate" title={error}>
            {error}
          </div>
        )}
      </div>

      <DirectoryBrowser
        isOpen={showDirectoryBrowser}
        onClose={() => setShowDirectoryBrowser(false)}
        onSelect={handleDirectorySelect}
        initialPath={currentPath}
      />
    </>
  );
}