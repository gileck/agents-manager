import type { ActivityEntry, ActivityCreateInput, ActivityFilter } from '../../shared/types';

export interface IActivityLog {
  log(input: ActivityCreateInput): Promise<ActivityEntry>;
  getEntries(filter?: ActivityFilter): Promise<ActivityEntry[]>;
}
