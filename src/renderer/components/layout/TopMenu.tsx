import React from 'react';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useProjects } from '../../hooks/useProjects';
import { useTheme } from '@template/renderer/hooks/useTheme';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@template/renderer/components/ui/select';
import { Button } from '@template/renderer/components/ui/button';
import { FolderOpen, Sun, Moon } from 'lucide-react';

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
            <SelectValue placeholder="Select a project">
              {currentProject ? currentProject.name : undefined}
            </SelectValue>
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
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {resolvedTheme === 'dark' ? (
          <Sun className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Moon className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}
