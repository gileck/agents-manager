import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const STORAGE_KEY = 'app.lastRoute';

export function useRouteRestore() {
  const navigate = useNavigate();
  const location = useLocation();
  const hasRestored = useRef(false);

  // Restore last route on mount
  useEffect(() => {
    if (hasRestored.current) return;
    hasRestored.current = true;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved !== '/' && saved !== location.pathname) {
      navigate(saved, { replace: true });
    }
  }, []);

  // Save current route on every navigation
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, location.pathname);
  }, [location.pathname]);
}
