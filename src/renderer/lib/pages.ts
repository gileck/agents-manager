import {
  LayoutDashboard,
  CheckSquare,
  MessageSquare,
  Clock,
  FolderOpen,
  Bot,
  BarChart3,
  Zap,
  Bug,
  DollarSign,
  GitBranch,
  Terminal,
  TerminalSquare,
  Settings,
  Palette,
  Workflow,
  Keyboard,
  PanelTop,
  FolderCog,
  MessageCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── Types ──

export interface PageDefinition {
  id: string;
  path: string;
  label: string;
  icon: LucideIcon;
  iconName: string;
  /** Extra terms matched during global search (case-insensitive) */
  keywords: string[];
  group: 'main' | 'settings';
}

// ── All application pages ──

export const APP_PAGES: PageDefinition[] = [
  // Main pages
  { id: 'dashboard', path: '/', label: 'Dashboard', icon: LayoutDashboard, iconName: 'LayoutDashboard', keywords: ['home', 'overview'], group: 'main' },
  { id: 'tasks', path: '/tasks', label: 'Tasks', icon: CheckSquare, iconName: 'CheckSquare', keywords: ['todo', 'work'], group: 'main' },
  { id: 'chat', path: '/chat', label: 'Chat', icon: MessageSquare, iconName: 'MessageSquare', keywords: ['thread', 'message', 'conversation'], group: 'main' },
  { id: 'threads', path: '/threads', label: 'Thread History', icon: Clock, iconName: 'Clock', keywords: ['history', 'sessions', 'past'], group: 'main' },
  { id: 'projects', path: '/projects', label: 'Projects', icon: FolderOpen, iconName: 'FolderOpen', keywords: ['repos', 'repositories'], group: 'main' },
  { id: 'automations', path: '/automated-agents', label: 'Automations', icon: Bot, iconName: 'Bot', keywords: ['automated', 'agents', 'bots'], group: 'main' },
  { id: 'features', path: '/features', label: 'Features', icon: BarChart3, iconName: 'BarChart3', keywords: ['epics', 'stories'], group: 'main' },
  { id: 'agent-runs', path: '/agent-runs', label: 'Agent Runs', icon: Zap, iconName: 'Zap', keywords: ['runs', 'executions'], group: 'main' },
  { id: 'post-mortem', path: '/post-mortem', label: 'Post-Mortem', icon: Bug, iconName: 'Bug', keywords: ['retrospective', 'review'], group: 'main' },
  { id: 'cost', path: '/cost', label: 'Cost', icon: DollarSign, iconName: 'DollarSign', keywords: ['billing', 'usage', 'spend', 'money'], group: 'main' },
  { id: 'source-control', path: '/source-control', label: 'Source Control', icon: GitBranch, iconName: 'GitBranch', keywords: ['git', 'branches', 'pull requests', 'pr'], group: 'main' },
  { id: 'terminal', path: '/terminal', label: 'Terminal', icon: TerminalSquare, iconName: 'TerminalSquare', keywords: ['shell', 'console', 'pty', 'command'], group: 'main' },
  { id: 'debug-logs', path: '/debug-logs', label: 'Debug Logs', icon: Terminal, iconName: 'Terminal', keywords: ['logs', 'console', 'output'], group: 'main' },
  { id: 'settings', path: '/settings', label: 'Settings', icon: Settings, iconName: 'Settings', keywords: ['preferences', 'config', 'configuration'], group: 'main' },

  // Settings sub-pages
  { id: 'settings-general', path: '/settings/general', label: 'Settings \u2192 General', icon: Settings, iconName: 'Settings', keywords: ['preferences', 'general settings'], group: 'settings' },
  { id: 'settings-theme', path: '/settings/theme', label: 'Settings \u2192 Theme', icon: Palette, iconName: 'Palette', keywords: ['appearance', 'dark mode', 'light mode', 'colors'], group: 'settings' },
  { id: 'settings-pipelines', path: '/settings/pipelines', label: 'Settings \u2192 Pipelines', icon: Workflow, iconName: 'Workflow', keywords: ['pipeline', 'workflow', 'stages'], group: 'settings' },
  { id: 'settings-agents', path: '/settings/agents', label: 'Settings \u2192 Agent Definitions', icon: Bot, iconName: 'Bot', keywords: ['agent config', 'agent settings', 'definitions'], group: 'settings' },
  { id: 'settings-keyboard', path: '/settings/keyboard', label: 'Settings \u2192 Keyboard Shortcuts', icon: Keyboard, iconName: 'Keyboard', keywords: ['keybindings', 'hotkeys', 'shortcuts'], group: 'settings' },
  { id: 'settings-tabs', path: '/settings/tabs', label: 'Settings \u2192 Tabs', icon: PanelTop, iconName: 'PanelTop', keywords: ['tab settings', 'tab management'], group: 'settings' },
  { id: 'settings-project', path: '/settings/project', label: 'Settings \u2192 Project Config', icon: FolderCog, iconName: 'FolderCog', keywords: ['project settings', 'project configuration'], group: 'settings' },
  { id: 'settings-threads', path: '/settings/threads', label: 'Settings \u2192 Threads', icon: MessageCircle, iconName: 'MessageCircle', keywords: ['thread settings', 'chat settings'], group: 'settings' },
];

// ── Derived exports ──

/** Ordered sidebar navigation items (excludes Settings which is rendered separately in the footer) */
export const SIDEBAR_NAV_PAGES: PageDefinition[] = APP_PAGES.filter(p =>
  ['tasks', 'threads', 'projects', 'automations', 'post-mortem'].includes(p.id)
);

/** Path -> { label, iconName } map for TabsContext static page tabs */
export const STATIC_PAGES_MAP: Record<string, { label: string; iconName: string }> = Object.fromEntries(
  APP_PAGES
    .filter(p => p.group === 'main' && p.id !== 'settings')
    .map(p => [p.path, { label: p.label, iconName: p.iconName }])
);

/** Icon name -> LucideIcon component map for tab icon deserialization */
export const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  CheckSquare,
  MessageSquare,
  FolderOpen,
  Settings,
  Bot,
  Bug,
  Clock,
  GitBranch,
  DollarSign,
  Terminal,
  TerminalSquare,
  BarChart3,
  Zap,
  Palette,
  Workflow,
  Keyboard,
  PanelTop,
  FolderCog,
  MessageCircle,
};

/** Resolve the display title for the top menu given a pathname.
 *  Uses prefix matching, with special handling for /agents/:runId.
 */
export function getPageTitle(pathname: string): string {
  // Exact match first
  const exact = APP_PAGES.find(p => p.path === pathname);
  if (exact) return exact.label;

  // Special case: /agents/:runId -> Agent Runs
  if (pathname.startsWith('/agents/')) return 'Agent Runs';

  // Special case: /chat/:sessionId -> New thread (matches existing TopMenu behavior)
  if (pathname.startsWith('/chat/')) return 'New thread';

  // Prefix match (longest prefix wins)
  let bestMatch: PageDefinition | null = null;
  for (const page of APP_PAGES) {
    if (page.path !== '/' && pathname.startsWith(page.path)) {
      if (!bestMatch || page.path.length > bestMatch.path.length) {
        bestMatch = page;
      }
    }
  }
  if (bestMatch) return bestMatch.label;

  return 'Agents Manager';
}
