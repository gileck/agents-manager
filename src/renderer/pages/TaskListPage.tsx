import React from 'react';
import { List, Columns3, Table } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { TaskListView } from '../components/tasks/TaskListView';
import { TaskTableView } from '../components/tasks/TaskTableView';
import { KanbanBoardPage } from './KanbanBoardPage';

type TaskViewTab = 'list' | 'kanban' | 'table';

export function TaskListPage() {
  const [activeTab, setActiveTab] = useLocalStorage<TaskViewTab>('taskList.activeTab', 'list');

  return (
    <div className="h-full flex flex-col">
      {/* Header with title and view tabs */}
      <div className="shrink-0 px-8 pt-6 pb-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Tasks</h1>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TaskViewTab)}>
            <TabsList>
              <TabsTrigger value="list">
                <List className="w-3.5 h-3.5 mr-1.5" />
                List
              </TabsTrigger>
              <TabsTrigger value="kanban">
                <Columns3 className="w-3.5 h-3.5 mr-1.5" />
                Kanban
              </TabsTrigger>
              <TabsTrigger value="table">
                <Table className="w-3.5 h-3.5 mr-1.5" />
                Table
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === 'list' && <TaskListView />}
        {activeTab === 'kanban' && <KanbanBoardPage embedded />}
        {activeTab === 'table' && <TaskTableView />}
      </div>
    </div>
  );
}
