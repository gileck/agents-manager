import type { ActivityEntry, ActivityCreateInput, ActivityFilter } from '../../shared/types';

export interface IActivityLog {
  log(input: ActivityCreateInput): ActivityEntry;
  getEntries(filter?: ActivityFilter): ActivityEntry[];
}
