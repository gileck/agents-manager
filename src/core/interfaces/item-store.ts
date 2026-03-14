import type { Item, ItemCreateInput, ItemUpdateInput } from '../../shared/types';

export interface IItemStore {
  createItem(input: ItemCreateInput): Promise<Item>;
  getItem(id: string): Promise<Item | null>;
  listItems(): Promise<Item[]>;
  updateItem(id: string, input: ItemUpdateInput): Promise<Item | null>;
  deleteItem(id: string): Promise<boolean>;
}
