// Item types
export interface Item {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ItemCreateInput = {
  name: string;
  description?: string;
};

export type ItemUpdateInput = Partial<ItemCreateInput>;

// Settings types
export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
}

// Log types (kept for template infrastructure)
export interface LogEntry {
  id: string;
  runId: string;
  timestamp: string;
  level: string;
  message: string;
}
