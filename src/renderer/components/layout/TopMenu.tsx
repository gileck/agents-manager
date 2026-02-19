import React from 'react';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useProjects } from '../../hooks/useProjects';
import { useTheme } from '@template/renderer/hooks/useTheme';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '@template/renderer/components/ui/select';
import { FolderOpen, Sun, Moon } from 'lucide-react';
import { cn } from '@template/renderer/lib/utils';

export function TopMenu() {
  const { currentProject, currentProjectId, setCurrentProjectId } =
    useCurrentProject();
  const { projects } = useProjects();
  const { resolvedTheme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="h-12 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
      {/* Left: Project Selector */}
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        <Select
          value={currentProjectId || ''}
          onValueChange={(id) => setCurrentProjectId(id)}
        >
          <SelectTrigger className="w-48 h-8 border-none bg-transparent shadow-none text-sm font-medium hover:bg-muted">
            <span
              className={cn(
                'truncate',
                !currentProject && 'text-muted-foreground'
              )}
            >
              {currentProject ? currentProject.name : 'Select a project'}
            </span>
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Right: Theme Toggle */}
      <button
        onClick={toggleTheme}
        className="p-2 rounded-md hover:bg-muted transition-colors"
        title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {resolvedTheme === 'dark' ? (
          <Sun className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Moon className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}
