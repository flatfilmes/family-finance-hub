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
      bank_accounts: {
        Row: {
          ativo: boolean
          banco: string
          created_at: string
          created_by: string | null
          family_id: string
          id: string
          member_id: string | null
          nome_conta: string
          saldo_atual: number
          tipo_conta: Database["public"]["Enums"]["bank_account_type"]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          banco: string
          created_at?: string
          created_by?: string | null
          family_id: string
          id?: string
          member_id?: string | null
          nome_conta: string
          saldo_atual?: number
          tipo_conta?: Database["public"]["Enums"]["bank_account_type"]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          banco?: string
          created_at?: string
          created_by?: string | null
          family_id?: string
          id?: string
          member_id?: string | null
          nome_conta?: string
          saldo_atual?: number
          tipo_conta?: Database["public"]["Enums"]["bank_account_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
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
      card_invoices: {
        Row: {
          created_at: string
          credit_card_id: string
          data_fechamento: string
          data_inicio_ciclo: string
          data_vencimento: string
          family_id: string
          id: string
          status: Database["public"]["Enums"]["invoice_status"]
          updated_at: string
          valor_total: number
        }
        Insert: {
          created_at?: string
          credit_card_id: string
          data_fechamento: string
          data_inicio_ciclo: string
          data_vencimento: string
          family_id: string
          id?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          valor_total?: number
        }
        Update: {
          created_at?: string
          credit_card_id?: string
          data_fechamento?: string
          data_inicio_ciclo?: string
          data_vencimento?: string
          family_id?: string
          id?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "card_invoices_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_invoices_family_id_fkey"
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
          member_id: string | null
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
          member_id?: string | null
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
          member_id?: string | null
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
          {
            foreignKeyName: "credit_cards_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_settings: {
        Row: {
          ativo: boolean
          created_at: string
          created_by: string | null
          family_id: string
          id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          family_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          family_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_settings_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          chave_documento: string | null
          codigo_externo: string | null
          created_at: string
          created_by: string | null
          family_id: string
          id: string
          member_id: string | null
          nome_arquivo: string
          purchase_id: string | null
          status: Database["public"]["Enums"]["document_status"]
          tamanho: number | null
          tipo_documento: Database["public"]["Enums"]["document_type"]
          updated_at: string
          url_arquivo: string | null
        }
        Insert: {
          chave_documento?: string | null
          codigo_externo?: string | null
          created_at?: string
          created_by?: string | null
          family_id: string
          id?: string
          member_id?: string | null
          nome_arquivo?: string
          purchase_id?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          tamanho?: number | null
          tipo_documento?: Database["public"]["Enums"]["document_type"]
          updated_at?: string
          url_arquivo?: string | null
        }
        Update: {
          chave_documento?: string | null
          codigo_externo?: string | null
          created_at?: string
          created_by?: string | null
          family_id?: string
          id?: string
          member_id?: string | null
          nome_arquivo?: string
          purchase_id?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          tamanho?: number | null
          tipo_documento?: Database["public"]["Enums"]["document_type"]
          updated_at?: string
          url_arquivo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
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
      expense_installments: {
        Row: {
          card_invoice_id: string | null
          created_at: string
          data_vencimento: string
          expense_id: string
          family_id: string
          id: string
          numero_parcela: number
          status: Database["public"]["Enums"]["installment_status"]
          total_parcelas: number
          updated_at: string
          valor_parcela: number
        }
        Insert: {
          card_invoice_id?: string | null
          created_at?: string
          data_vencimento: string
          expense_id: string
          family_id: string
          id?: string
          numero_parcela?: number
          status?: Database["public"]["Enums"]["installment_status"]
          total_parcelas?: number
          updated_at?: string
          valor_parcela?: number
        }
        Update: {
          card_invoice_id?: string | null
          created_at?: string
          data_vencimento?: string
          expense_id?: string
          family_id?: string
          id?: string
          numero_parcela?: number
          status?: Database["public"]["Enums"]["installment_status"]
          total_parcelas?: number
          updated_at?: string
          valor_parcela?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_installments_card_invoice_id_fkey"
            columns: ["card_invoice_id"]
            isOneToOne: false
            referencedRelation: "card_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_installments_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_installments_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
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
          member_id: string | null
          observacao: string | null
          parcela_atual: number
          parcelas_total: number
          purchase_id: string | null
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
          member_id?: string | null
          observacao?: string | null
          parcela_atual?: number
          parcelas_total?: number
          purchase_id?: string | null
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
          member_id?: string | null
          observacao?: string | null
          parcela_atual?: number
          parcelas_total?: number
          purchase_id?: string | null
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
          {
            foreignKeyName: "expenses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string
          id: string
          is_demo: boolean
          nome_da_familia: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_demo?: boolean
          nome_da_familia: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_demo?: boolean
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
          member_id: string | null
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
          member_id?: string | null
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
          member_id?: string | null
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
          {
            foreignKeyName: "fixed_expenses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
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
          member_id: string | null
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
          member_id?: string | null
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
          member_id?: string | null
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
          {
            foreignKeyName: "incomes_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_financial_profiles: {
        Row: {
          created_at: string
          family_id: string
          family_member_id: string
          id: string
          pode_lancar_despesas: boolean
          pode_ver_proprios_dados: boolean
          tipo_perfil: Database["public"]["Enums"]["member_profile_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          family_id: string
          family_member_id: string
          id?: string
          pode_lancar_despesas?: boolean
          pode_ver_proprios_dados?: boolean
          tipo_perfil?: Database["public"]["Enums"]["member_profile_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          family_id?: string
          family_member_id?: string
          id?: string
          pode_lancar_despesas?: boolean
          pode_ver_proprios_dados?: boolean
          tipo_perfil?: Database["public"]["Enums"]["member_profile_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_financial_profiles_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_financial_profiles_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: true
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          ativo: boolean
          categoria_id: string | null
          created_at: string
          id: string
          nome: string
          unidade_medida: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria_id?: string | null
          created_at?: string
          id?: string
          nome: string
          unidade_medida?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria_id?: string | null
          created_at?: string
          id?: string
          nome?: string
          unidade_medida?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
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
      purchase_import_items: {
        Row: {
          categoria_sugerida: string | null
          created_at: string
          descricao_produto: string
          id: string
          purchase_import_id: string
          quantidade: number
          unidade: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          categoria_sugerida?: string | null
          created_at?: string
          descricao_produto?: string
          id?: string
          purchase_import_id: string
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          categoria_sugerida?: string | null
          created_at?: string
          descricao_produto?: string
          id?: string
          purchase_import_id?: string
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_import_items_categoria_sugerida_fkey"
            columns: ["categoria_sugerida"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_import_items_purchase_import_id_fkey"
            columns: ["purchase_import_id"]
            isOneToOne: false
            referencedRelation: "purchase_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_imports: {
        Row: {
          created_at: string
          dados_extraidos_json: Json | null
          data_compra: string | null
          document_id: string
          estabelecimento: string
          family_id: string
          id: string
          member_id: string | null
          status: Database["public"]["Enums"]["purchase_import_status"]
          updated_at: string
          valor_total: number
        }
        Insert: {
          created_at?: string
          dados_extraidos_json?: Json | null
          data_compra?: string | null
          document_id: string
          estabelecimento?: string
          family_id: string
          id?: string
          member_id?: string | null
          status?: Database["public"]["Enums"]["purchase_import_status"]
          updated_at?: string
          valor_total?: number
        }
        Update: {
          created_at?: string
          dados_extraidos_json?: Json | null
          data_compra?: string | null
          document_id?: string
          estabelecimento?: string
          family_id?: string
          id?: string
          member_id?: string | null
          status?: Database["public"]["Enums"]["purchase_import_status"]
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_imports_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_imports_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_imports_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_items: {
        Row: {
          categoria_id: string | null
          created_at: string
          descricao_produto: string
          id: string
          product_id: string | null
          purchase_id: string
          quantidade: number
          unidade: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          categoria_id?: string | null
          created_at?: string
          descricao_produto: string
          id?: string
          product_id?: string | null
          purchase_id: string
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          categoria_id?: string | null
          created_at?: string
          descricao_produto?: string
          id?: string
          product_id?: string | null
          purchase_id?: string
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          bank_account_id: string | null
          created_at: string
          created_by: string | null
          credit_card_id: string | null
          data_compra: string
          estabelecimento: string
          family_id: string
          forma_pagamento: Database["public"]["Enums"]["payment_method"]
          id: string
          member_id: string | null
          nota_fiscal_tipo: string | null
          nota_fiscal_url: string | null
          observacao: string | null
          ocr_dados: Json | null
          ocr_processado_em: string | null
          ocr_status: string
          status_pagamento: Database["public"]["Enums"]["purchase_payment_status"]
          tipo_compra: Database["public"]["Enums"]["purchase_type"]
          transaction_id: string | null
          updated_at: string
          valor_total: number
        }
        Insert: {
          bank_account_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_id?: string | null
          data_compra?: string
          estabelecimento: string
          family_id: string
          forma_pagamento?: Database["public"]["Enums"]["payment_method"]
          id?: string
          member_id?: string | null
          nota_fiscal_tipo?: string | null
          nota_fiscal_url?: string | null
          observacao?: string | null
          ocr_dados?: Json | null
          ocr_processado_em?: string | null
          ocr_status?: string
          status_pagamento?: Database["public"]["Enums"]["purchase_payment_status"]
          tipo_compra?: Database["public"]["Enums"]["purchase_type"]
          transaction_id?: string | null
          updated_at?: string
          valor_total?: number
        }
        Update: {
          bank_account_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_id?: string | null
          data_compra?: string
          estabelecimento?: string
          family_id?: string
          forma_pagamento?: Database["public"]["Enums"]["payment_method"]
          id?: string
          member_id?: string | null
          nota_fiscal_tipo?: string | null
          nota_fiscal_url?: string | null
          observacao?: string | null
          ocr_dados?: Json | null
          ocr_processado_em?: string | null
          ocr_status?: string
          status_pagamento?: Database["public"]["Enums"]["purchase_payment_status"]
          tipo_compra?: Database["public"]["Enums"]["purchase_type"]
          transaction_id?: string | null
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchases_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expenses: {
        Row: {
          ativo: boolean
          bank_account_id: string | null
          created_at: string
          created_by: string | null
          credit_card_id: string | null
          family_id: string
          id: string
          member_id: string | null
          nome: string
          periodicidade: Database["public"]["Enums"]["expense_recurrence"]
          proxima_cobranca: string
          purchase_id: string | null
          updated_at: string
          valor: number
        }
        Insert: {
          ativo?: boolean
          bank_account_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_id?: string | null
          family_id: string
          id?: string
          member_id?: string | null
          nome: string
          periodicidade?: Database["public"]["Enums"]["expense_recurrence"]
          proxima_cobranca: string
          purchase_id?: string | null
          updated_at?: string
          valor?: number
        }
        Update: {
          ativo?: boolean
          bank_account_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_id?: string | null
          family_id?: string
          id?: string
          member_id?: string | null
          nome?: string
          periodicidade?: Database["public"]["Enums"]["expense_recurrence"]
          proxima_cobranca?: string
          purchase_id?: string | null
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          bank_account_id: string | null
          card_invoice_id: string | null
          created_at: string
          created_by: string | null
          credit_card_id: string | null
          data_movimento: string
          descricao: string
          family_id: string
          id: string
          member_id: string | null
          purchase_id: string | null
          status: Database["public"]["Enums"]["transaction_status"]
          tipo: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          valor: number
        }
        Insert: {
          bank_account_id?: string | null
          card_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_id?: string | null
          data_movimento?: string
          descricao?: string
          family_id: string
          id?: string
          member_id?: string | null
          purchase_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          tipo: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          valor?: number
        }
        Update: {
          bank_account_id?: string | null
          card_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_id?: string | null
          data_movimento?: string
          descricao?: string
          family_id?: string
          id?: string
          member_id?: string | null
          purchase_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          tipo?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_card_invoice_id_fkey"
            columns: ["card_invoice_id"]
            isOneToOne: false
            referencedRelation: "card_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage_member_record: {
        Args: { _family_id: string; _member_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_member_record: {
        Args: { _family_id: string; _member_id: string; _user_id: string }
        Returns: boolean
      }
      delete_demo_data: { Args: never; Returns: number }
      is_family_admin: {
        Args: { _family_id: string; _user_id: string }
        Returns: boolean
      }
      is_family_member: {
        Args: { _family_id: string; _user_id: string }
        Returns: boolean
      }
      is_own_family_member: {
        Args: { _member_id: string; _user_id: string }
        Returns: boolean
      }
      pay_card_invoice: {
        Args: { _bank_account_id: string; _data?: string; _invoice_id: string }
        Returns: string
      }
    }
    Enums: {
      bank_account_type: "CORRENTE" | "POUPANCA" | "PAGAMENTO" | "INVESTIMENTO"
      budget_period: "MENSAL"
      document_status:
        | "ENVIADO"
        | "PROCESSANDO"
        | "PROCESSADO"
        | "CONFIRMADO"
        | "ERRO"
      document_type:
        | "NOTA_FISCAL"
        | "QR_CODE"
        | "PDF_FATURA"
        | "COMPROVANTE"
        | "OUTRO"
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
      installment_status: "PENDENTE" | "PAGO"
      invoice_status: "ABERTA" | "FECHADA" | "PAGA"
      member_profile_type:
        | "ADMIN_FAMILIAR"
        | "MEMBRO"
        | "DEPENDENTE"
        | "VISUALIZADOR"
      payment_method:
        | "DINHEIRO"
        | "PIX"
        | "DEBITO"
        | "CREDITO"
        | "BOLETO"
        | "TRANSFERENCIA"
        | "OUTRO"
      purchase_import_status: "PENDENTE_APROVACAO" | "APROVADO" | "REJEITADO"
      purchase_payment_status:
        | "PAGO"
        | "COMPROMETIDO"
        | "PENDENTE"
        | "CANCELADO"
      purchase_type:
        | "A_VISTA"
        | "CARTAO_CREDITO"
        | "PARCELADO"
        | "COMPRA_NORMAL"
        | "COMPRA_RECORRENTE"
        | "COMPRA_PARCELADA"
        | "CONTA_RECORRENTE"
      transaction_status: "CONFIRMADA" | "PENDENTE" | "CANCELADA"
      transaction_type:
        | "ENTRADA"
        | "SAIDA"
        | "TRANSFERENCIA"
        | "PAGAMENTO_CARTAO"
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
      bank_account_type: ["CORRENTE", "POUPANCA", "PAGAMENTO", "INVESTIMENTO"],
      budget_period: ["MENSAL"],
      document_status: [
        "ENVIADO",
        "PROCESSANDO",
        "PROCESSADO",
        "CONFIRMADO",
        "ERRO",
      ],
      document_type: [
        "NOTA_FISCAL",
        "QR_CODE",
        "PDF_FATURA",
        "COMPROVANTE",
        "OUTRO",
      ],
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
      installment_status: ["PENDENTE", "PAGO"],
      invoice_status: ["ABERTA", "FECHADA", "PAGA"],
      member_profile_type: [
        "ADMIN_FAMILIAR",
        "MEMBRO",
        "DEPENDENTE",
        "VISUALIZADOR",
      ],
      payment_method: [
        "DINHEIRO",
        "PIX",
        "DEBITO",
        "CREDITO",
        "BOLETO",
        "TRANSFERENCIA",
        "OUTRO",
      ],
      purchase_import_status: ["PENDENTE_APROVACAO", "APROVADO", "REJEITADO"],
      purchase_payment_status: [
        "PAGO",
        "COMPROMETIDO",
        "PENDENTE",
        "CANCELADO",
      ],
      purchase_type: [
        "A_VISTA",
        "CARTAO_CREDITO",
        "PARCELADO",
        "COMPRA_NORMAL",
        "COMPRA_RECORRENTE",
        "COMPRA_PARCELADA",
        "CONTA_RECORRENTE",
      ],
      transaction_status: ["CONFIRMADA", "PENDENTE", "CANCELADA"],
      transaction_type: [
        "ENTRADA",
        "SAIDA",
        "TRANSFERENCIA",
        "PAGAMENTO_CARTAO",
      ],
    },
  },
} as const
