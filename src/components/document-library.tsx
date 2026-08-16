/**
 * Painel interno (técnico) da Biblioteca de documentos.
 * Mostra os tipos catalogados, os casos de teste e o resultado do último teste.
 * Não aparece no fluxo do usuário comum — vive em Configurações.
 */
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/page-header";
import {
  buildTypeStats,
  fetchDocumentTestCases,
  fetchDocumentTypes,
  STRATEGY_LABELS,
  TEST_STATUS_CLASSES,
  TEST_STATUS_LABELS,
} from "@/lib/document-types";

function formatarData(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function DocumentLibraryCard() {
  const tipos = useQuery({ queryKey: ["document-types"], queryFn: fetchDocumentTypes });
  const casos = useQuery({ queryKey: ["document-test-cases"], queryFn: fetchDocumentTestCases });

  const stats = buildTypeStats(tipos.data ?? [], casos.data ?? []);
  const carregando = tipos.isLoading || casos.isLoading;

  return (
    <Card className="mt-4">
      <h2 className="text-base font-bold">Biblioteca de documentos</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Área técnica: formatos de nota reconhecidos pela leitura automática e os casos de teste
        usados para evitar regressões. O usuário continua vendo apenas Nova compra.
      </p>

      {carregando ? (
        <p className="mt-4 text-sm text-muted-foreground">Carregando biblioteca…</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Tipo</th>
                  <th className="py-2 pr-3 font-semibold">Estratégia</th>
                  <th className="py-2 pr-3 font-semibold">Testes</th>
                  <th className="py-2 pr-3 font-semibold">Aprovados</th>
                  <th className="py-2 pr-3 font-semibold">Com erro</th>
                  <th className="py-2 font-semibold">Último teste</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.tipo.id} className="border-t border-border/60">
                    <td className="py-2 pr-3">
                      <span className="font-semibold">{s.tipo.nome}</span>
                      <span className="block text-xs text-muted-foreground">{s.tipo.codigo}</span>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {STRATEGY_LABELS[s.tipo.estrategia_leitura]}
                      {s.tipo.requires_ocr && <span className="block text-xs">requer OCR</span>}
                      {s.tipo.supports_qr_code && <span className="block text-xs">aceita QR Code</span>}
                    </td>
                    <td className="py-2 pr-3">{s.total}</td>
                    <td className="py-2 pr-3">{s.aprovados}</td>
                    <td className="py-2 pr-3">{s.comErro}</td>
                    <td className="py-2 text-muted-foreground">
                      {s.total === 0 ? "Aguardando" : formatarData(s.ultimoTeste)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mt-6 text-sm font-bold">Casos de teste</h3>
          {(casos.data ?? []).length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Nenhum caso cadastrado ainda.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {(casos.data ?? []).map((c) => (
                <li
                  key={c.id}
                  className="rounded-xl border border-border/60 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{c.nome_teste}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TEST_STATUS_CLASSES[c.resultado]}`}
                    >
                      {TEST_STATUS_LABELS[c.resultado]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.estabelecimento_esperado ?? "—"} ·{" "}
                    {c.valor_esperado != null
                      ? Number(c.valor_esperado).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      : "—"}{" "}
                    · {c.quantidade_itens_esperada ?? 0} itens · {c.pagamento_esperado ?? "—"} ·
                    último teste {formatarData(c.ultimo_teste_em)}
                  </p>
                  {c.observacoes && (
                    <p className="mt-1 text-xs text-muted-foreground">{c.observacoes}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
