import React, { createContext, useContext } from 'react';
import { useTerminals } from '../hooks/useTerminals';

type TerminalsValue = ReturnType<typeof useTerminals>;

const TerminalsContext = createContext<TerminalsValue | null>(null);

export function TerminalsProvider({ children }: { children: React.ReactNode }) {
  const value = useTerminals();
  return (
    <TerminalsContext.Provider value={value}>
      {children}
    </TerminalsContext.Provider>
  );
}

export function useTerminalsContext(): TerminalsValue {
  const ctx = useContext(TerminalsContext);
  if (!ctx) throw new Error('useTerminalsContext must be used within TerminalsProvider');
  return ctx;
}
