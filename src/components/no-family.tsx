import { Link } from "@tanstack/react-router";
import { Card, PageHeader } from "@/components/page-header";

/**
 * Estado compartilhado para quando o usuário ainda não pertence a nenhuma família.
 * Vive em components/ porque é usado por várias páginas ativas.
 */
export function NoFamily() {
  return (
    <div>
      <PageHeader
        title="Crie sua família primeiro"
        subtitle="Os dados financeiros pertencem a uma família. Crie a sua para começar."
      />
      <Card>
        <Link to="/configuracoes" className="text-sm font-semibold text-primary">
          Ir para Configurações
        </Link>
      </Card>
    </div>
  );
}
