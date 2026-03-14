export interface ITransactionRunner {
  runTransaction<T>(fn: () => T): T;
}
