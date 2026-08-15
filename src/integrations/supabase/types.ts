export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      budgets: {
        Row: {
          ano_referencia: number
          category_id: string | null
          created_at: string
          created_by: string | null
          family_id: string
          id: string
          mes_referencia: number
          periodo: Database["public"]["Enums"]["budget_period"]
          updated_at: string
          valor_planejado: number
        }
        Insert: {
          ano_referencia?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          family_id: string
          id?: string
          mes_referencia?: number
          periodo?: Database["public"]["Enums"]["budget_period"]
          updated_at?: string
          valor_planejado?: number
        }
        Update: {
          ano_referencia?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          family_id?: string
          id?: string
          mes_referencia?: number
          periodo?: Database["public"]["Enums"]["budget_period"]
          updated_at?: string
          valor_planejado?: number
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_cards: {
        Row: {
          ativo: boolean
          banco: string
          created_at: string
          created_by: string | null
          dia_fechamento: number
          dia_vencimento: number
          family_id: string
          id: string
          limite: number
          nome_cartao: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          banco: string
          created_at?: string
          created_by?: string | null
          dia_fechamento?: number
          dia_vencimento?: number
          family_id: string
          id?: string
          limite?: number
          nome_cartao: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          banco?: string
          created_at?: string
          created_by?: string | null
          dia_fechamento?: number
          dia_vencimento?: number
          family_id?: string
          id?: string
          limite?: number
          nome_cartao?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_cards_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          ativo: boolean
          created_at: string
          icone: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          icone?: string
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          icone?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          cartao_id: string | null
          categoria_id: string | null
          created_at: string
          created_by: string | null
          data_compra: string
          descricao: string
          family_id: string
          forma_pagamento: Database["public"]["Enums"]["payment_method"]
          id: string
          observacao: string | null
          parcela_atual: number
          parcelas_total: number
          tipo_compra: Database["public"]["Enums"]["purchase_type"]
          updated_at: string
          valor: number
        }
        Insert: {
          cartao_id?: string | null
          categoria_id?: string | null
          created_at?: string
          created_by?: string | null
          data_compra?: string
          descricao: string
          family_id: string
          forma_pagamento?: Database["public"]["Enums"]["payment_method"]
          id?: string
          observacao?: string | null
          parcela_atual?: number
          parcelas_total?: number
          tipo_compra?: Database["public"]["Enums"]["purchase_type"]
          updated_at?: string
          valor?: number
        }
        Update: {
          cartao_id?: string | null
          categoria_id?: string | null
          created_at?: string
          created_by?: string | null
          data_compra?: string
          descricao?: string
          family_id?: string
          forma_pagamento?: Database["public"]["Enums"]["payment_method"]
          id?: string
          observacao?: string | null
          parcela_atual?: number
          parcelas_total?: number
          tipo_compra?: Database["public"]["Enums"]["purchase_type"]
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "expenses_cartao_id_fkey"
            columns: ["cartao_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string
          id: string
          nome_da_familia: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome_da_familia: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          nome_da_familia?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      family_members: {
        Row: {
          created_at: string
          family_id: string
          id: string
          nome: string
          permissao: Database["public"]["Enums"]["family_permission"]
          relacionamento: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          nome: string
          permissao?: Database["public"]["Enums"]["family_permission"]
          relacionamento?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          nome?: string
          permissao?: Database["public"]["Enums"]["family_permission"]
          relacionamento?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_profiles: {
        Row: {
          created_at: string
          family_id: string
          id: string
          objetivo_principal:
            | Database["public"]["Enums"]["financial_goal"]
            | null
          possui_renda_variavel: boolean
          quantidade_dependentes: number
          renda_principal: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          objetivo_principal?:
            | Database["public"]["Enums"]["financial_goal"]
            | null
          possui_renda_variavel?: boolean
          quantidade_dependentes?: number
          renda_principal?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          objetivo_principal?:
            | Database["public"]["Enums"]["financial_goal"]
            | null
          possui_renda_variavel?: boolean
          quantidade_dependentes?: number
          renda_principal?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_profiles_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_settings: {
        Row: {
          created_at: string
          family_id: string
          id: string
          limite_alerta_cartao: number
          percentual_reserva: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          limite_alerta_cartao?: number
          percentual_reserva?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          limite_alerta_cartao?: number
          percentual_reserva?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_settings_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_expenses: {
        Row: {
          ativo: boolean
          categoria: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by: string | null
          descricao: string
          family_id: string
          id: string
          recorrencia: Database["public"]["Enums"]["expense_recurrence"]
          updated_at: string
          valor: number
          vencimento: number
        }
        Insert: {
          ativo?: boolean
          categoria?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          descricao: string
          family_id: string
          id?: string
          recorrencia?: Database["public"]["Enums"]["expense_recurrence"]
          updated_at?: string
          valor?: number
          vencimento?: number
        }
        Update: {
          ativo?: boolean
          categoria?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          descricao?: string
          family_id?: string
          id?: string
          recorrencia?: Database["public"]["Enums"]["expense_recurrence"]
          updated_at?: string
          valor?: number
          vencimento?: number
        }
        Relationships: [
          {
            foreignKeyName: "fixed_expenses_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      incomes: {
        Row: {
          ativo: boolean
          created_at: string
          created_by: string | null
          data_recebimento: string | null
          descricao: string
          family_id: string
          frequencia: Database["public"]["Enums"]["income_frequency"]
          id: string
          tipo: Database["public"]["Enums"]["income_type"]
          updated_at: string
          valor: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          data_recebimento?: string | null
          descricao: string
          family_id: string
          frequencia?: Database["public"]["Enums"]["income_frequency"]
          id?: string
          tipo?: Database["public"]["Enums"]["income_type"]
          updated_at?: string
          valor?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          data_recebimento?: string | null
          descricao?: string
          family_id?: string
          frequencia?: Database["public"]["Enums"]["income_frequency"]
          id?: string
          tipo?: Database["public"]["Enums"]["income_type"]
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "incomes_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          nome_completo: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string
          id: string
          nome_completo?: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nome_completo?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_family_admin: {
        Args: { _family_id: string; _user_id: string }
        Returns: boolean
      }
      is_family_member: {
        Args: { _family_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      budget_period: "MENSAL"
      expense_category:
        | "ENERGIA"
        | "AGUA"
        | "INTERNET"
        | "ALUGUEL"
        | "FINANCIAMENTO"
        | "ASSINATURAS"
        | "TELEFONE"
        | "EDUCACAO"
        | "SAUDE"
        | "TRANSPORTE"
        | "OUTROS"
      expense_recurrence:
        | "MENSAL"
        | "BIMESTRAL"
        | "TRIMESTRAL"
        | "SEMESTRAL"
        | "ANUAL"
      family_permission: "ADMIN" | "MEMBER" | "VIEWER"
      financial_goal:
        | "organizar_financas"
        | "sair_de_dividas"
        | "economizar"
        | "comprar_bem"
        | "investir"
      income_frequency:
        | "MENSAL"
        | "SEMANAL"
        | "QUINZENAL"
        | "ANUAL"
        | "EVENTUAL"
      income_type: "FIXA" | "VARIAVEL"
      payment_method:
        | "DINHEIRO"
        | "PIX"
        | "DEBITO"
        | "CREDITO"
        | "BOLETO"
        | "TRANSFERENCIA"
        | "OUTRO"
      purchase_type: "A_VISTA" | "CARTAO_CREDITO" | "PARCELADO"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      budget_period: ["MENSAL"],
      expense_category: [
        "ENERGIA",
        "AGUA",
        "INTERNET",
        "ALUGUEL",
        "FINANCIAMENTO",
        "ASSINATURAS",
        "TELEFONE",
        "EDUCACAO",
        "SAUDE",
        "TRANSPORTE",
        "OUTROS",
      ],
      expense_recurrence: [
        "MENSAL",
        "BIMESTRAL",
        "TRIMESTRAL",
        "SEMESTRAL",
        "ANUAL",
      ],
      family_permission: ["ADMIN", "MEMBER", "VIEWER"],
      financial_goal: [
        "organizar_financas",
        "sair_de_dividas",
        "economizar",
        "comprar_bem",
        "investir",
      ],
      income_frequency: ["MENSAL", "SEMANAL", "QUINZENAL", "ANUAL", "EVENTUAL"],
      income_type: ["FIXA", "VARIAVEL"],
      payment_method: [
        "DINHEIRO",
        "PIX",
        "DEBITO",
        "CREDITO",
        "BOLETO",
        "TRANSFERENCIA",
        "OUTRO",
      ],
      purchase_type: ["A_VISTA", "CARTAO_CREDITO", "PARCELADO"],
    },
  },
} as const
