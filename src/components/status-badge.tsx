import { TONE_CLASSES, type Tone } from "@/lib/status";

/**
 * Selo curto e padronizado (Pago, Pendente, Atrasado, Cartão, PIX, Aberta...).
 * Nunca quebra linha: em telas pequenas o texto completo fica no `title`.
 */
export function StatusBadge({
  children,
  tone = "muted",
  title,
  className = "",
}: {
  children: React.ReactNode;
  tone?: Tone;
  title?: string;
  className?: string;
}) {
  return (
    <span
      {...(title ? { title } : {})}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
