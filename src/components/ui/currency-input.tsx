import { forwardRef } from "react";
import { inputClass } from "@/components/page-header";

/** Converte o texto digitado em centavos (somente dígitos, nunca negativo). */
function digitsToNumber(text: string) {
  const digits = text.replace(/\D/g, "").slice(0, 15);
  if (!digits) return null;
  return Number(digits) / 100;
}

/** Formata um número como moeda brasileira (R$ 1.250,50). */
export function formatCurrencyInput(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export type CurrencyInputProps = {
  /** Valor em reais; `null` representa campo vazio. */
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
};

/**
 * Campo monetário pt-BR reutilizável: exibe "R$ 5.000,00" e devolve 5000 como número.
 * Digitação é da direita para a esquerda (centavos primeiro), como nos apps de banco.
 */
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, placeholder = "R$ 0,00", className = "", ...rest }, ref) => (
    <input
      {...rest}
      ref={ref}
      inputMode="numeric"
      autoComplete="off"
      className={`${inputClass} ${className}`}
      placeholder={placeholder}
      value={value === null ? "" : formatCurrencyInput(value)}
      onChange={(e) => onChange(digitsToNumber(e.target.value))}
    />
  ),
);
CurrencyInput.displayName = "CurrencyInput";
