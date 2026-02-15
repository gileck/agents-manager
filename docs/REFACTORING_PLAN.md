# Refactoring Plan: Framework-Style Separation

## Overview

Refactor the Task Manager project to separate reusable infrastructure (template/) from application-specific code (src/), then copy it to create the electron-macos-template.

## Goals

1. **Separate concerns clearly**: Framework code in `template/`, app code in `src/`
2. **Keep Task Manager working**: Test after refactoring to ensure nothing breaks
3. **Easy to copy**: Once refactored, copying to template is straightforward
4. **Clean imports**: Use `@template` path alias for framework imports

---

## Phase 1: Refactor Current Project

### Step 1: Setup Infrastructure

**1.1 Create directory structure**
```bash
template/
├── main/
│   ├── core/          # App lifecycle, window, tray
│   ├── services/      # Database, logging, notifications, settings
│   └── ipc/           # IPC framework
├── preload/           # Context bridge
├── renderer/
│   ├── components/
│   │   ├── ui/        # Shadcn components
│   │   └── layout/    # AppLayout, Sidebar
│   ├── hooks/         # useTheme, useIpc
│   ├── lib/           # utils.ts
│   └── styles/        # CSS files
└── shared/            # Base types, IPC patterns
```

**1.2 Update TypeScript configs**
- Add `baseUrl: "."` and `paths` with `@template/*` alias to `tsconfig.json`
- Update `tsconfig.main.json` to include `template/main/**/*` and `template/shared/**/*`
- Update `tsconfig.preload.json` to include `template/preload/**/*` and `template/shared/**/*`
- Update `tsconfig.renderer.json` to include `template/renderer/**/*` and `template/shared/**/*`

**1.3 Update Webpack config**
- Add webpack alias: `'@template': path.resolve(__dirname, 'template')`
- Add webpack alias: `'@app': path.resolve(__dirname, 'src')`

---

### Step 2: Move Main Process Infrastructure

**2.1 Move window management**
- Copy `src/main/window.ts` → `template/main/core/window.ts`
- This file is 100% reusable (no changes needed)

**2.2 Move tray management**
- Copy `src/main/tray.ts` → `template/main/core/tray.ts`
- Make menu items configurable (accept menu items as parameter)

**2.3 Extract app lifecycle**
- Create `template/main/core/app.ts`
- Extract initialization logic from `src/main/index.ts`
- Make it generic with callbacks for app-specific initialization
- `src/main/index.ts` will import and use this

**2.4 Move services**
- Copy `src/main/services/database.ts` → `template/main/services/database.ts`
- Copy `src/main/services/log-service.ts` → `template/main/services/log-service.ts`
- Copy `src/main/services/notification.ts` → `template/main/services/notification.ts`
- Copy `src/main/services/settings-service.ts` → `template/main/services/settings-service.ts`

**2.5 Create IPC framework**
- Create `template/main/ipc/ipc-registry.ts`
- Generic handler registration with validation patterns
- `src/main/ipc-handlers.ts` will use this framework

**Keep in src/main/services/**
- `task-runner.ts` (app-specific)
- `scheduler.ts` (app-specific)
- `task-service.ts` (app-specific)

---

### Step 3: Move Preload Infrastructure

**3.1 Move context bridge**
- Copy `src/preload/index.ts` → `template/preload/bridge.ts`
- Extract reusable API creation patterns
- Make it extensible so `src/preload/index.ts` can add app-specific APIs

---

### Step 4: Move Renderer Infrastructure

**4.1 Move UI components**
- Move all Shadcn components from `src/renderer/components/ui/*` → `template/renderer/components/ui/*`
  - button.tsx
  - card.tsx
  - input.tsx
  - label.tsx
  - select.tsx
  - textarea.tsx
  - badge.tsx
  - switch.tsx
  - dialog.tsx
  - dropdown-menu.tsx
  - tabs.tsx

**4.2 Create layout components**
- Extract generic parts of `src/renderer/components/layout/Layout.tsx` → `template/renderer/components/layout/AppLayout.tsx`
- Extract generic parts of `src/renderer/components/layout/Sidebar.tsx` → `template/renderer/components/layout/Sidebar.tsx`
- Make navigation items configurable

**4.3 Move hooks**
- Copy `src/renderer/hooks/useTheme.ts` → `template/renderer/hooks/useTheme.ts`
- Create `template/renderer/hooks/useIpc.ts` (generic IPC data fetching hook)

**4.4 Move utilities**
- Copy `src/renderer/lib/utils.ts` → `template/renderer/lib/utils.ts`

**4.5 Move styles**
- Copy `src/renderer/styles/globals.css` → `template/renderer/styles/globals.css`
- Copy `src/renderer/index.css` → `template/renderer/styles/tailwind.css`

**Keep in src/renderer/**
- `pages/*` (all task-specific pages)
- `hooks/useTasks.ts`, `useRuns.ts`, `useDashboard.ts`, `useLogs.ts` (app-specific)
- `components/schedule/ScheduleBuilder.tsx` (app-specific)

---

### Step 5: Create Shared Infrastructure

**5.1 Create base types**
- Create `template/shared/base-types.ts`
- Move generic types (Theme, Settings structure pattern, etc.)

**5.2 Create IPC base patterns**
- Create `template/shared/ipc-base.ts`
- Define IPC channel naming conventions
- Define request/response patterns

**Keep in src/shared/**
- All task-specific types (Task, TaskRun, Schedule, etc.)
- All task-specific IPC channels

---

### Step 6: Update Imports

**6.1 Update src/main/ imports**
- Change imports from `./window` to `@template/main/core/window`
- Change imports from `./services/database` to `@template/main/services/database`
- Update `src/main/index.ts` to use `@template/main/core/app`

**6.2 Update src/preload/ imports**
- Update `src/preload/index.ts` to use `@template/preload/bridge`

**6.3 Update src/renderer/ imports**
- Change all `../components/ui/*` imports to `@template/renderer/components/ui/*`
- Change `../lib/utils` to `@template/renderer/lib/utils`
- Change `../hooks/useTheme` to `@template/renderer/hooks/useTheme`
- Update layout component imports

---

### Step 7: Test Refactored Project

**7.1 Build test**
```bash
yarn build
```
- Should compile without errors
- Verify path aliases resolve correctly

**7.2 Launch test**
```bash
yarn start:devtools
```
- App should launch successfully
- Window should appear
- Tray icon should work

**7.3 Functionality test**
- Create a task
- Run a task
- View task history
- Change theme
- Modify settings
- All features should work exactly as before

---

## Phase 2: Create Template Project

### Step 8: Copy Project

```bash
cp -r /Users/gileck/Projects/macOs-electron-app-1 /Users/gileck/Projects/electron-macos-template
cd /Users/gileck/Projects/electron-macos-template
```

### Step 9: Clean Up Template

**9.1 Delete task-specific services**
```bash
rm src/main/services/task-runner.ts
rm src/main/services/scheduler.ts
rm src/main/services/task-service.ts
```

**9.2 Delete task-specific pages**
```bash
rm src/renderer/pages/DashboardPage.tsx
rm src/renderer/pages/TasksPage.tsx
rm src/renderer/pages/TaskFormPage.tsx
rm src/renderer/pages/TaskDetailPage.tsx
rm src/renderer/pages/TaskRunPage.tsx
rm src/renderer/pages/HistoryPage.tsx
```

**9.3 Delete task-specific components**
```bash
rm -rf src/renderer/components/schedule
```

**9.4 Delete task-specific hooks**
```bash
rm src/renderer/hooks/useTasks.ts
rm src/renderer/hooks/useRuns.ts
rm src/renderer/hooks/useLogs.ts
rm src/renderer/hooks/useDashboard.ts
```

### Step 10: Create Simple Example

**10.1 Create item-service.ts**
- Create `src/main/services/item-service.ts`
- Simple CRUD: createItem, getItem, listItems, updateItem, deleteItem

**10.2 Update IPC handlers**
- Replace task handlers with item handlers in `src/main/ipc-handlers.ts`
- ITEM_LIST, ITEM_GET, ITEM_CREATE, ITEM_UPDATE, ITEM_DELETE

**10.3 Update shared types**
- Replace task types with Item type in `src/shared/types.ts`
- Update IPC channels in `src/shared/ipc-channels.ts`

**10.4 Update database migrations**
- Replace task tables with items table
- Keep migrations table, settings table, logs table

**10.5 Create example pages**
- `src/renderer/pages/HomePage.tsx` - Simple dashboard
- `src/renderer/pages/ItemsPage.tsx` - List items
- `src/renderer/pages/ItemFormPage.tsx` - Create/edit item
- `src/renderer/pages/SettingsPage.tsx` - Theme settings

**10.6 Create example hook**
- `src/renderer/hooks/useItems.ts` - Fetch and manage items

**10.7 Update App.tsx**
- Update routes to point to new pages

### Step 11: Update Package.json

**11.1 Update metadata**
```json
{
  "name": "electron-macos-template",
  "version": "1.0.0",
  "description": "Production-ready macOS menu bar app template",
  "productName": "MacOS App Template"
}
```

**11.2 Remove task-specific dependencies**
```bash
yarn remove node-cron cron-parser
```

### Step 12: Create Documentation

**12.1 Create README.md**
- Template overview
- Features
- Quick start
- Tech stack
- Commands

**12.2 Create TEMPLATE.md**
- How to use the template
- Understanding template/ vs src/ separation
- How to add features
- How to customize
- How to sync template updates

**12.3 Update CLAUDE.md**
- Remove task-specific sections
- Add template-specific notes
- Keep infrastructure tips and known issues

**12.4 Create template/README.md**
- Document the template infrastructure
- Explain each service and component

### Step 13: Test Template

**13.1 Build test**
```bash
cd /Users/gileck/Projects/electron-macos-template
rm -rf node_modules dist dist-main
yarn install
yarn build
```

**13.2 Launch test**
```bash
yarn start:devtools
```

**13.3 Functionality test**
- Create an item
- Edit an item
- Delete an item
- Change theme
- Verify settings persist

---

## Success Criteria

- ✅ Task Manager still works after refactoring
- ✅ Template/ code never imports from src/
- ✅ Template builds and runs successfully
- ✅ Example CRUD operations work
- ✅ Documentation is comprehensive
- ✅ Path aliases (@template, @app) work correctly

---

## Rollback Plan

If refactoring breaks Task Manager:
1. Git stash or create backup branch before starting
2. Can revert changes easily
3. Template/ directory is additive - can delete it without affecting src/

## Notes

- Test thoroughly after each major move
- Commit frequently during refactoring
- Keep Task Manager working throughout the process
- Template is a copy, not a move of the original project
