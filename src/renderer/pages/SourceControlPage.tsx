import React, { useState, useCallback } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../components/ui/select';
import { useProjects } from '../hooks/useProjects';
import { useGitLog, useGitBranch } from '../hooks/useGitLog';
import { formatRelativeTime } from '../lib/utils';
import {
  GitBranch, ChevronRight, ChevronDown, FileText, FilePlus, FileX, FileEdit, User, RefreshCw,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import type { GitLogEntry, GitCommitDetail } from '../../shared/types';

function fileStatusIcon(status: string) {
  switch (status) {
    case 'A': return <FilePlus className="h-3.5 w-3.5 text-green-600" />;
    case 'D': return <FileX className="h-3.5 w-3.5 text-red-500" />;
    case 'M': return <FileEdit className="h-3.5 w-3.5 text-yellow-600" />;
    default: return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function fileStatusLabel(status: string) {
  switch (status) {
    case 'A': return 'Added';
    case 'D': return 'Deleted';
    case 'M': return 'Modified';
    case 'R': return 'Renamed';
    case 'C': return 'Copied';
    default: return status;
  }
}

interface CommitRowProps {
  commit: GitLogEntry;
  projectId: string;
}

function CommitRow({ commit, projectId }: CommitRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const handleToggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!detail) {
      setLoadingDetail(true);
      try {
        const d = await window.api.git.commitDetail(projectId, commit.hash);
        setDetail(d);
      } catch {
        setDetail({ hash: commit.hash, body: '', files: [] });
      } finally {
        setLoadingDetail(false);
      }
    }
  }, [expanded, detail, projectId, commit.hash]);

  return (
    <Card className="border-b last:border-b-0 rounded-none first:rounded-t-lg last:rounded-b-lg shadow-none">
      <button
        className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
        onClick={handleToggle}
      >
        <div className="flex items-start gap-3">
          <div className="mt-1 text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{commit.subject}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {commit.author}
              </span>
              <span>{formatRelativeTime(commit.date)}</span>
              <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono">
                {commit.hash.slice(0, 7)}
              </code>
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <CardContent className="pt-0 pb-3 px-4 pl-11">
          {loadingDetail ? (
            <div className="text-xs text-muted-foreground py-2">Loading...</div>
          ) : detail ? (
            <div className="space-y-3">
              {detail.body.trim() && (
                <div className="text-sm text-muted-foreground whitespace-pre-wrap border-l-2 border-muted pl-3">
                  {detail.body.trim()}
                </div>
              )}
              {detail.files.length > 0 ? (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">
                    {detail.files.length} file{detail.files.length !== 1 ? 's' : ''} changed
                  </div>
                  <div className="space-y-0.5">
                    {detail.files.map((file) => (
                      <div
                        key={file.path}
                        className="flex items-center gap-2 text-sm py-0.5 px-2 rounded hover:bg-muted/50"
                      >
                        {fileStatusIcon(file.status)}
                        <span className="font-mono text-xs truncate flex-1">{file.path}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {fileStatusLabel(file.status)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No file changes found</div>
              )}
            </div>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

export function SourceControlPage() {
  const { projects, loading: projectsLoading } = useProjects();
  const projectsWithPath = projects.filter((p) => p.path);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Auto-select first project with a path
  const activeProjectId = selectedProjectId ?? projectsWithPath[0]?.id ?? null;

  const { commits, loading: commitsLoading, error, refetch } = useGitLog(activeProjectId);
  const { branch } = useGitBranch(activeProjectId);

  // Group commits by date
  const groupedCommits = commits.reduce<Record<string, GitLogEntry[]>>((groups, commit) => {
    const dateKey = new Date(commit.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(commit);
    return groups;
  }, {});

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Source Control</h1>
          <p className="text-muted-foreground text-sm mt-1">Recent commits and changes</p>
        </div>
        <div className="flex items-center gap-3">
          {branch && (
            <Badge variant="secondary" className="flex items-center gap-1.5 px-3 py-1">
              <GitBranch className="h-3.5 w-3.5" />
              {branch}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={refetch} disabled={commitsLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${commitsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Project selector */}
      {projectsWithPath.length > 1 && (
        <Select
          value={activeProjectId ?? ''}
          onValueChange={(v) => setSelectedProjectId(v)}
        >
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Select project" />
          </SelectTrigger>
          <SelectContent>
            {projectsWithPath.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* States */}
      {projectsLoading && (
        <div className="text-center py-12 text-muted-foreground">Loading projects...</div>
      )}

      {!projectsLoading && projectsWithPath.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <GitBranch className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No projects with a git repository path configured.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Add a path to a project to see its commit history.
            </p>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-destructive text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Commit list */}
      {!projectsLoading && activeProjectId && !error && (
        <div className="space-y-6">
          {commitsLoading && commits.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">Loading commits...</div>
          ) : commits.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No commits found.</p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(groupedCommits).map(([date, dateCommits]) => (
              <div key={date}>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{date}</h3>
                <div className="border rounded-lg overflow-hidden">
                  {dateCommits.map((commit) => (
                    <CommitRow
                      key={commit.hash}
                      commit={commit}
                      projectId={activeProjectId}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
