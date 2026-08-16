import { useEffect, useState } from "react";

/**
 * Estado de filtro que sobrevive à navegação para a página de detalhe e volta.
 * Guarda apenas preferências de visualização (pessoa, banco, período) na sessão.
 */
export function useStickyState(key: string, initial: string) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem(key);
    if (saved !== null) setValue(saved);
    // Só na montagem: depois disso o estado local é a fonte de verdade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(key, value);
  }, [key, value]);

  return [value, setValue] as const;
}
