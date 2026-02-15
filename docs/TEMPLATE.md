# Template Usage Guide

This guide explains how to use and customize this Electron macOS template.

## Table of Contents

- [Understanding the Architecture](#understanding-the-architecture)
- [Getting Started](#getting-started)
- [Adding Features](#adding-features)
- [Database & Migrations](#database--migrations)
- [IPC Communication](#ipc-communication)
- [UI Pages & Components](#ui-pages--components)
- [Settings Management](#settings-management)
- [Customizing the Template](#customizing-the-template)

---

## Understanding the Architecture

### `template/` Directory (Framework Code - DO NOT MODIFY)

The `template/` directory contains **reusable infrastructure** that works for any macOS app:

```
template/
├── main/
│   ├── core/
│   │   ├── app.ts          # App lifecycle management
│   │   ├── window.ts       # Window creation and management
│   │   └── tray.ts         # Menu bar tray icon
│   ├── services/
│   │   ├── database.ts     # SQLite database with migrations
│   │   ├── settings-service.ts  # Key-value settings storage
│   │   ├── log-service.ts  # Logging to database
│   │   └── notification.ts # macOS notifications
│   └── ipc/
│       └── ipc-registry.ts # IPC handler registration
├── preload/
│   └── bridge.ts           # Context bridge utilities
├── renderer/
│   ├── components/
│   │   ├── ui/            # Shadcn UI components (Button, Card, etc.)
│   │   └── layout/        # AppLayout, Sidebar
│   ├── hooks/             # useTheme, useIpc
│   ├── lib/               # utils (cn, etc.)
│   └── styles/            # Global CSS
└── shared/
    ├── base-types.ts      # Base types (Theme, etc.)
    └── ipc-base.ts        # IPC patterns
```

**Important:** Do NOT modify files in `template/`. This code is framework-level and should work for any app.

### `src/` Directory (Your App Code - CUSTOMIZE THIS)

The `src/` directory contains **your application logic**:

```
src/
├── main/
│   ├── index.ts           # Main process entry point
│   ├── ipc-handlers.ts    # Register IPC handlers
│   ├── migrations.ts      # Database schema migrations
│   └── services/          # App-specific services
│       └── item-service.ts
├── preload/
│   └── index.ts           # IPC API exposed to renderer
├── renderer/
│   ├── components/
│   │   └── layout/        # Your Layout and Sidebar
│   ├── pages/             # Your app pages
│   ├── hooks/             # App-specific hooks
│   └── App.tsx            # Router configuration
└── shared/
    ├── types.ts           # Your data types
    └── ipc-channels.ts    # IPC channel names
```

---

## Getting Started

### 1. Clone the Template

```bash
git clone <your-repo> my-new-app
cd my-new-app
yarn install
```

### 2. Customize Package Metadata

Edit `package.json`:

```json
{
  "name": "my-app-name",
  "version": "1.0.0",
  "description": "My awesome macOS app",
  "productName": "My App"
}
```

### 3. Update App Name

**src/renderer/components/layout/Sidebar.tsx:**
```typescript
<TemplateSidebar
  appName="My App"  // Change this
  appIcon={YourIcon}
  navItems={navItems}
  version="1.0.0"
/>
```

**src/main/index.ts:**
```typescript
tray = createTray({
  title: '🚀',  // Your tray icon
  tooltip: 'My App',
  menuBuilder: () => buildStandardMenu('My App'),
});
```

### 4. Update Database Filename

**src/main/index.ts:**
```typescript
initDatabase({
  filename: 'my-app.db',  // Change this
  migrations: getMigrations(),
});
```

---

## Adding Features

### Example: Adding a "Notes" Feature

#### Step 1: Define the Data Model

**src/shared/types.ts:**
```typescript
export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type NoteCreateInput = {
  title: string;
  content: string;
};

export type NoteUpdateInput = Partial<NoteCreateInput>;
```

#### Step 2: Create Database Migration

**src/main/migrations.ts:**
```typescript
{
  name: '004_create_notes',
  sql: `
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `,
}
```

#### Step 3: Create Service

**src/main/services/note-service.ts:**
```typescript
import { getDatabase, generateId } from '@template/main/services/database';
import type { Note, NoteCreateInput, NoteUpdateInput } from '../../shared/types';

export function createNote(input: NoteCreateInput): Note {
  const db = getDatabase();
  const id = generateId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO notes (id, title, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.title, input.content, now, now);

  return { id, title: input.title, content: input.content, createdAt: now, updatedAt: now };
}

export function getNotes(): Note[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM notes ORDER BY created_at DESC').all() as any[];
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function updateNote(id: string, input: NoteUpdateInput): Note | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const updates: string[] = [];
  const values: any[] = [];

  if (input.title !== undefined) {
    updates.push('title = ?');
    values.push(input.title);
  }
  if (input.content !== undefined) {
    updates.push('content = ?');
    values.push(input.content);
  }

  if (updates.length === 0) return getNote(id);

  updates.push('updated_at = ?');
  values.push(now);
  values.push(id);

  db.prepare(`UPDATE notes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getNote(id);
}

export function deleteNote(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  return result.changes > 0;
}

function getNote(id: string): Note | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

#### Step 4: Add IPC Channels

**src/shared/ipc-channels.ts:**
```typescript
export const IPC_CHANNELS = {
  // ... existing channels
  NOTE_LIST: 'note:list',
  NOTE_GET: 'note:get',
  NOTE_CREATE: 'note:create',
  NOTE_UPDATE: 'note:update',
  NOTE_DELETE: 'note:delete',
} as const;
```

#### Step 5: Register IPC Handlers

**src/main/ipc-handlers.ts:**
```typescript
import * as noteService from './services/note-service';

// Add these handlers
registerIpcHandler(IPC_CHANNELS.NOTE_LIST, async () => {
  return noteService.getNotes();
});

registerIpcHandler(IPC_CHANNELS.NOTE_CREATE, async (_, input: NoteCreateInput) => {
  validateInput(input, ['title', 'content']);
  return noteService.createNote(input);
});

registerIpcHandler(IPC_CHANNELS.NOTE_UPDATE, async (_, id: string, input: NoteUpdateInput) => {
  validateId(id);
  return noteService.updateNote(id, input);
});

registerIpcHandler(IPC_CHANNELS.NOTE_DELETE, async (_, id: string) => {
  validateId(id);
  return noteService.deleteNote(id);
});
```

#### Step 6: Expose API in Preload

**src/preload/index.ts:**
```typescript
const api = {
  // ... existing API
  notes: {
    list: (): Promise<Note[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTE_LIST),
    get: (id: string): Promise<Note | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTE_GET, id),
    create: (input: NoteCreateInput): Promise<Note> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTE_CREATE, input),
    update: (id: string, input: NoteUpdateInput): Promise<Note | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTE_UPDATE, id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTE_DELETE, id),
  },
};
```

#### Step 7: Create UI Pages

**src/renderer/pages/NotesPage.tsx:**
```typescript
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@template/renderer/components/ui/button';
import { Card } from '@template/renderer/components/ui/card';
import type { Note } from '../../shared/types';

export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    window.api.notes.list().then(setNotes);
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('Delete this note?')) {
      await window.api.notes.delete(id);
      setNotes(notes.filter(n => n.id !== id));
    }
  };

  return (
    <div className="p-8">
      <div className="flex justify-between mb-6">
        <h1 className="text-3xl font-bold">Notes</h1>
        <Link to="/notes/new">
          <Button>New Note</Button>
        </Link>
      </div>

      <div className="space-y-4">
        {notes.map(note => (
          <Card key={note.id} className="p-4">
            <h3 className="font-bold">{note.title}</h3>
            <p className="text-sm text-muted-foreground">{note.content}</p>
            <div className="flex gap-2 mt-2">
              <Link to={`/notes/${note.id}/edit`}>
                <Button size="sm" variant="outline">Edit</Button>
              </Link>
              <Button size="sm" variant="destructive" onClick={() => handleDelete(note.id)}>
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

#### Step 8: Add Routes

**src/renderer/App.tsx:**
```typescript
import { NotesPage } from './pages/NotesPage';
import { NoteFormPage } from './pages/NoteFormPage';

<Routes>
  <Route path="/" element={<Layout />}>
    {/* ... existing routes */}
    <Route path="notes" element={<NotesPage />} />
    <Route path="notes/new" element={<NoteFormPage />} />
    <Route path="notes/:id/edit" element={<NoteFormPage />} />
  </Route>
</Routes>
```

#### Step 9: Update Navigation

**src/renderer/components/layout/Sidebar.tsx:**
```typescript
import { Home, Package, Settings, FileText } from 'lucide-react';

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/items', icon: Package, label: 'Items' },
  { to: '/notes', icon: FileText, label: 'Notes' },  // Add this
  { to: '/settings', icon: Settings, label: 'Settings' },
];
```

---

## Database & Migrations

### Migration Best Practices

1. **Never modify existing migrations** - Always add new ones
2. **Use transactions** - Template handles this automatically
3. **Test migrations** - Delete your DB and restart the app to test

### Example Migrations

```typescript
export function getMigrations(): Migration[] {
  return [
    {
      name: '001_initial_schema',
      sql: `
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `,
    },
    {
      name: '002_add_user_avatar',
      sql: `
        ALTER TABLE users ADD COLUMN avatar_url TEXT
      `,
    },
    {
      name: '003_create_indexes',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)
      `,
    },
  ];
}
```

---

## IPC Communication

### Pattern 1: Simple Query

**Main Process:**
```typescript
registerIpcHandler('user:get-current', async () => {
  return getCurrentUser();
});
```

**Preload:**
```typescript
user: {
  getCurrent: (): Promise<User> =>
    ipcRenderer.invoke('user:get-current'),
}
```

**Renderer:**
```typescript
const user = await window.api.user.getCurrent();
```

### Pattern 2: With Parameters

**Main Process:**
```typescript
registerIpcHandler('user:update', async (_, id: string, data: UserUpdateInput) => {
  validateId(id);
  validateInput(data, ['name']);
  return updateUser(id, data);
});
```

**Preload:**
```typescript
user: {
  update: (id: string, data: UserUpdateInput): Promise<User> =>
    ipcRenderer.invoke('user:update', id, data),
}
```

**Renderer:**
```typescript
const updatedUser = await window.api.user.update('123', { name: 'New Name' });
```

### Pattern 3: Events (Main → Renderer)

**Main Process:**
```typescript
import { sendToRenderer } from '@template/main/core/window';

sendToRenderer('user:updated', updatedUser);
```

**Preload:**
```typescript
on: {
  userUpdated: (callback: (user: User) => void) => {
    const listener = (_: IpcRendererEvent, user: User) => callback(user);
    ipcRenderer.on('user:updated', listener);
    return () => ipcRenderer.removeListener('user:updated', listener);
  },
}
```

**Renderer:**
```typescript
useEffect(() => {
  const unsubscribe = window.api.on.userUpdated((user) => {
    console.log('User updated:', user);
  });
  return unsubscribe;
}, []);
```

---

## UI Pages & Components

### Using Template Components

The template provides pre-built UI components:

```typescript
import { Button } from '@template/renderer/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@template/renderer/components/ui/card';
import { Input } from '@template/renderer/components/ui/input';
import { Label } from '@template/renderer/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@template/renderer/components/ui/select';
import { Switch } from '@template/renderer/components/ui/switch';
import { Textarea } from '@template/renderer/components/ui/textarea';
```

### Creating a Form Page

```typescript
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@template/renderer/components/ui/button';
import { Input } from '@template/renderer/components/ui/input';
import { Label } from '@template/renderer/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@template/renderer/components/ui/card';

export function UserFormPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await window.api.users.create({ name, email });
    navigate('/users');
  };

  return (
    <div className="p-8">
      <Card>
        <CardHeader>
          <CardTitle>Create User</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## Settings Management

### Adding Custom Settings

**src/shared/types.ts:**
```typescript
export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
  autoSave: boolean;  // Add custom setting
  language: string;   // Add custom setting
}
```

**src/main/ipc-handlers.ts:**
```typescript
registerIpcHandler(IPC_CHANNELS.SETTINGS_GET, async (): Promise<AppSettings> => {
  const theme = getSetting('theme', 'system') as 'light' | 'dark' | 'system';
  const notificationsEnabled = getSetting('notifications_enabled', 'true') === 'true';
  const autoSave = getSetting('auto_save', 'true') === 'true';
  const language = getSetting('language', 'en');

  return { theme, notificationsEnabled, autoSave, language };
});

registerIpcHandler(IPC_CHANNELS.SETTINGS_UPDATE, async (_, updates: Partial<AppSettings>) => {
  if (updates.theme !== undefined) {
    setSetting('theme', updates.theme);
  }
  if (updates.notificationsEnabled !== undefined) {
    setSetting('notifications_enabled', updates.notificationsEnabled.toString());
  }
  if (updates.autoSave !== undefined) {
    setSetting('auto_save', updates.autoSave.toString());
  }
  if (updates.language !== undefined) {
    setSetting('language', updates.language);
  }

  // Return updated settings
  // ... (repeat the getSetting calls above)
});
```

**src/main/migrations.ts:**
```typescript
{
  name: '002_create_settings',
  sql: `
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('theme', 'system'),
      ('notifications_enabled', 'true'),
      ('auto_save', 'true'),
      ('language', 'en')
  `,
}
```

---

## Customizing the Template

### Changing App Icon

1. Replace `assets/icon.png` with your 1024x1024 icon
2. Run the icon generation script (if available) or use an online converter
3. Replace `assets/icon.icns`

### Customizing Tray Menu

**src/main/index.ts:**
```typescript
import { buildStandardMenu } from '@template/main/core/tray';

const customMenu = buildStandardMenu('My App', [
  {
    label: 'Custom Action',
    click: () => {
      // Do something
    },
  },
  { type: 'separator' },
  {
    label: 'Open Settings',
    click: () => {
      showWindow();
      // Navigate to settings
    },
  },
]);
```

### Adding Global Keyboard Shortcuts

**src/main/index.ts:**
```typescript
import { globalShortcut } from 'electron';

app.whenReady().then(() => {
  globalShortcut.register('CommandOrControl+Shift+N', () => {
    showWindow();
  });
});
```

### Changing Theme Colors

Edit `src/renderer/styles/globals.css`:

```css
:root {
  --primary: 220 90% 56%;  /* Change primary color */
  --primary-foreground: 0 0% 100%;
  /* ... other colors */
}
```

---

## Best Practices

1. **Keep template/ untouched** - All customization goes in src/
2. **Use migrations** - Never modify the database directly
3. **Validate IPC inputs** - Always use validateId() and validateInput()
4. **Handle errors** - Wrap async operations in try-catch
5. **Type everything** - Leverage TypeScript for safety
6. **Test thoroughly** - Delete the database and restart to test migrations
7. **Follow the patterns** - Look at the Items example for guidance

---

## Common Tasks Quick Reference

### Add a new table
1. Define type in `src/shared/types.ts`
2. Create migration in `src/main/migrations.ts`
3. Create service in `src/main/services/`
4. Add IPC channels in `src/shared/ipc-channels.ts`
5. Register handlers in `src/main/ipc-handlers.ts`
6. Expose API in `src/preload/index.ts`

### Add a new page
1. Create component in `src/renderer/pages/`
2. Add route in `src/renderer/App.tsx`
3. Add navigation item in `src/renderer/components/layout/Sidebar.tsx`

### Add a new setting
1. Update `AppSettings` type in `src/shared/types.ts`
2. Update SETTINGS_GET and SETTINGS_UPDATE handlers in `src/main/ipc-handlers.ts`
3. Add default value in `src/main/migrations.ts`
4. Update SettingsPage UI in `src/renderer/pages/SettingsPage.tsx`

---

## Getting Help

- Review the example Items CRUD implementation
- Check `template/` files to understand framework capabilities
- Read docs/CLAUDE.md for development notes and known issues

Happy building! 🚀
