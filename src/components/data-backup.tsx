import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/page-header";
import { useFamily } from "@/hooks/useFamilyData";
import { usePermissions } from "@/hooks/usePermissions";
import {
  backupFileName,
  countFamilyData,
  downloadBackup,
  generateFamilyBackup,
  resetFamilyData,
  type BackupResult,
  type ResetType,
} from "@/lib/family-backup";

type Etapa = "fechado" | "backup" | "opcoes" | "confirmar";

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Seção "Dados e Backup" das Configurações: exportação e zona de perigo. */
export function DataBackupSection() {
  const { data: family } = useFamily();
  const { isAdmin } = usePermissions();
  const [backup, setBackup] = useState<BackupResult | null>(null);
  const [gerando, setGerando] = useState(false);

  async function gerarBackup() {
    if (!family) return null;
    setGerando(true);
    try {
      const resultado = await generateFamilyBackup(family.id);
      setBackup(resultado);
      toast.success("Backup gerado com sucesso.");
      return resultado;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setGerando(false);
    }
  }

  if (!isAdmin) {
    return (
      <Card className="mt-4 max-w-2xl">
        <h2 className="text-base font-bold">Dados e Backup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Somente o administrador da família pode gerar backups ou resetar os dados.
        </p>
      </Card>
    );
  }

  return (
    <div className="mt-4 max-w-2xl space-y-4">
      <Card>
        <h2 className="text-base font-bold">Backup dos dados</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Exporta em JSON versionado todos os dados de <strong>{family?.nome_da_familia}</strong>.
          Não inclui senhas, tokens ou dados de outras famílias.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={() => void gerarBackup()}
            disabled={gerando || !family}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {gerando ? "Gerando..." : "Gerar backup"}
          </button>
          <button
            disabled
            title="Em breve"
            className="rounded-full border border-border px-6 py-2.5 text-sm font-semibold text-muted-foreground disabled:opacity-60"
          >
            Restaurar backup (em breve)
          </button>
        </div>

        {backup && (
          <div className="mt-5 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            <p className="font-semibold text-primary">Backup gerado com sucesso</p>
            <dl className="mt-3 space-y-2">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Data/hora</dt>
                <dd className="font-medium">{dataHora(backup.backup.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Família</dt>
                <dd className="font-medium">{backup.backup.familyName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Registros</dt>
                <dd className="font-medium">{backup.totalRegistros}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Arquivo</dt>
                <dd className="font-medium">{backupFileName(new Date(backup.backup.createdAt))}</dd>
              </div>
            </dl>
            <button
              onClick={() => downloadBackup(backup.backup)}
              className="mt-4 rounded-full border border-primary/40 px-6 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              Baixar backup
            </button>
          </div>
        )}
      </Card>

      <DangerZone familyId={family?.id ?? ""} onGerarBackup={gerarBackup} />
    </div>
  );
}

function DangerZone({
  familyId,
  onGerarBackup,
}: {
  familyId: string;
  onGerarBackup: () => Promise<BackupResult | null>;
}) {
  const { data: family } = useFamily();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [etapa, setEtapa] = useState<Etapa>("fechado");
  const [tipo, setTipo] = useState<ResetType>("FINANCEIRO");
  const [backupFeito, setBackupFeito] = useState(false);
  const [removerDemo, setRemoverDemo] = useState(true);
  const [confirmacao, setConfirmacao] = useState("");
  const [totais, setTotais] = useState<{ label: string; total: number }[]>([]);
  const [executando, setExecutando] = useState(false);

  const nomeFamilia = family?.nome_da_familia ?? "";
  const alvo = tipo === "FAMILIA_COMPLETA" ? nomeFamilia : "RESETAR";
  const habilitado = confirmacao.trim() === alvo && !executando;

  function abrir() {
    setBackupFeito(false);
    setConfirmacao("");
    setTipo("FINANCEIRO");
    setEtapa("backup");
  }

  async function carregarTotais() {
    setTotais(await countFamilyData(familyId));
    setEtapa("confirmar");
  }

  async function executar() {
    setExecutando(true);
    try {
      await resetFamilyData({
        familyId,
        tipo,
        backupCreated: backupFeito,
        removerDemo: family?.is_demo ? removerDemo : false,
      });
      await queryClient.invalidateQueries();
      setEtapa("fechado");
      toast.success("Dados resetados com sucesso.");
      if (tipo === "FAMILIA_COMPLETA") await navigate({ to: "/dashboard" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExecutando(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <h2 className="text-base font-bold text-destructive">Zona de perigo</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Estas ações podem remover permanentemente os dados financeiros da família.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={abrir}
          disabled={!familyId}
          className="rounded-full bg-destructive px-6 py-2.5 text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          Resetar dados da família
        </button>
        <button
          onClick={() => setResetCompras(true)}
          disabled={!familyId}
          className="rounded-full border border-destructive/50 px-6 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
        >
          Resetar Compras e Cartões
        </button>
      </div>

      {resetCompras && (
        <PurchasesCardsResetDialog
          familyId={familyId}
          onGerarBackup={onGerarBackup}
          onClose={() => setResetCompras(false)}
        />
      )}


      {etapa !== "fechado" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-card">
            {etapa === "backup" && (
              <>
                <h3 className="text-lg font-bold">Gerar um backup antes de continuar?</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Recomendamos fortemente salvar uma cópia dos dados antes de resetar.
                </p>
                <div className="mt-5 space-y-2">
                  <button
                    onClick={async () => {
                      const r = await onGerarBackup();
                      if (!r) return;
                      downloadBackup(r.backup);
                      setBackupFeito(true);
                      setEtapa("opcoes");
                    }}
                    className="w-full rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground"
                  >
                    Gerar backup e continuar (recomendado)
                  </button>
                  <button
                    onClick={() => setEtapa("opcoes")}
                    className="w-full rounded-full border border-border px-6 py-2.5 text-sm font-semibold"
                  >
                    Continuar sem backup
                  </button>
                  <button
                    onClick={() => setEtapa("fechado")}
                    className="w-full rounded-full px-6 py-2.5 text-sm font-semibold text-muted-foreground"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )}

            {etapa === "opcoes" && (
              <>
                <h3 className="text-lg font-bold">O que você quer resetar?</h3>
                <div className="mt-4 space-y-3">
                  <label className="flex cursor-pointer gap-3 rounded-2xl border border-border p-4 text-sm">
                    <input
                      type="radio"
                      className="mt-1"
                      checked={tipo === "FINANCEIRO"}
                      onChange={() => setTipo("FINANCEIRO")}
                    />
                    <span>
                      <strong className="block">Resetar dados financeiros</strong>
                      <span className="text-muted-foreground">
                        Mantém família, membros, permissões e perfis. Remove compras, transações,
                        contas, cartões, faturas, parcelas, recorrências, receitas, importações e
                        histórico.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer gap-3 rounded-2xl border border-destructive/40 p-4 text-sm">
                    <input
                      type="radio"
                      className="mt-1"
                      checked={tipo === "FAMILIA_COMPLETA"}
                      onChange={() => setTipo("FAMILIA_COMPLETA")}
                    />
                    <span>
                      <strong className="block text-destructive">
                        Resetar família completamente
                      </strong>
                      <span className="text-muted-foreground">
                        Remove também membros e a própria família. Sua conta de acesso é preservada
                        e você volta ao onboarding.
                      </span>
                    </span>
                  </label>
                </div>

                {family?.is_demo && tipo === "FINANCEIRO" && (
                  <label className="mt-4 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={removerDemo}
                      onChange={(e) => setRemoverDemo(e.target.checked)}
                    />
                    Remover modo demonstração após reset
                  </label>
                )}

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => setEtapa("fechado")}
                    className="rounded-full px-5 py-2.5 text-sm font-semibold text-muted-foreground"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void carregarTotais()}
                    className="rounded-full bg-destructive px-6 py-2.5 text-sm font-semibold text-destructive-foreground"
                  >
                    Continuar
                  </button>
                </div>
              </>
            )}

            {etapa === "confirmar" && (
              <>
                <h3 className="text-lg font-bold text-destructive">Confirmação final</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Os registros abaixo serão removidos permanentemente.
                </p>
                <dl className="mt-4 space-y-1.5 rounded-2xl bg-muted/40 p-4 text-sm">
                  {totais.map((t) => (
                    <div key={t.label} className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">{t.label}</dt>
                      <dd className="font-semibold">{t.total}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-sm">
                  Digite <strong>{alvo}</strong> para confirmar.
                </p>
                <input
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
                  placeholder={alvo}
                />
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => setEtapa("fechado")}
                    className="rounded-full px-5 py-2.5 text-sm font-semibold text-muted-foreground"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void executar()}
                    disabled={!habilitado}
                    className="rounded-full bg-destructive px-6 py-2.5 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
                  >
                    {executando ? "Resetando..." : "Resetar agora"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
