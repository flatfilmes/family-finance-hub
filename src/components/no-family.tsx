import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, Field, inputClass, PageHeader, PrimaryButton } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useFamilyData";
import { createFamily } from "@/lib/family";

/**
 * Onboarding do primeiro acesso: enquanto o usuário não pertence a nenhuma família,
 * qualquer página operacional oferece a criação da família real (sem dados fictícios).
 */
export function NoFamily() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();

  const [nomeFamilia, setNomeFamilia] = useState("");
  const [responsavel, setResponsavel] = useState("");

  const criar = useMutation({
    mutationFn: () =>
      createFamily({
        nome: nomeFamilia.trim(),
        ownerNome: responsavel.trim() || profile?.nome_completo || "",
      }),
    onSuccess: () => {
      toast.success("Família criada! Agora cadastre renda, contas e cartões.");
      setNomeFamilia("");
      setResponsavel("");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Vamos configurar sua família"
        subtitle="Comece criando sua família. Depois cadastre renda, contas bancárias e cartões."
      />
      <Card className="max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            criar.mutate();
          }}
        >
          <Field label="Nome da família">
            <input
              required
              value={nomeFamilia}
              onChange={(e) => setNomeFamilia(e.target.value)}
              className={inputClass}
              placeholder="Família Souza"
            />
          </Field>
          <Field label="Primeiro responsável">
            <input
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              className={inputClass}
              placeholder={profile?.nome_completo || "Seu nome"}
            />
          </Field>
          <PrimaryButton type="submit" disabled={criar.isPending || !user}>
            {criar.isPending ? "Criando..." : "Criar minha família"}
          </PrimaryButton>
        </form>
        <ol className="mt-6 space-y-1 text-sm text-muted-foreground">
          <li>1. Criar a família e o primeiro responsável</li>
          <li>2. Cadastrar a renda</li>
          <li>3. Cadastrar contas bancárias</li>
          <li>4. Cadastrar cartões de crédito</li>
        </ol>
      </Card>
    </div>
  );
}
