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
      bank_statement_imports: {
        Row: {
          bank_account_id: string
          confirmado_em: string | null
          created_at: string
          created_by: string | null
          dados_brutos_json: Json | null
          erro_mensagem: string | null
          family_id: string
          formato: Database["public"]["Enums"]["bank_statement_format"]
          id: string
          member_id: string | null
          nome_arquivo: string
          parser: string
          periodo_fim: string | null
          periodo_inicio: string | null
          quantidade_lancamentos: number
          saldo_final: number | null
          saldo_inicial: number | null
          status: Database["public"]["Enums"]["bank_statement_status"]
          total_entradas: number
          total_saidas: number
          updated_at: string
        }
        Insert: {
          bank_account_id: string
          confirmado_em?: string | null
          created_at?: string
          created_by?: string | null
          dados_brutos_json?: Json | null
          erro_mensagem?: string | null
          family_id: string
          formato?: Database["public"]["Enums"]["bank_statement_format"]
          id?: string
          member_id?: string | null
          nome_arquivo: string
          parser?: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
          quantidade_lancamentos?: number
          saldo_final?: number | null
          saldo_inicial?: number | null
          status?: Database["public"]["Enums"]["bank_statement_status"]
          total_entradas?: number
          total_saidas?: number
          updated_at?: string
        }
        Update: {
          bank_account_id?: string
          confirmado_em?: string | null
          created_at?: string
          created_by?: string | null
          dados_brutos_json?: Json | null
          erro_mensagem?: string | null
          family_id?: string
          formato?: Database["public"]["Enums"]["bank_statement_format"]
          id?: string
          member_id?: string | null
          nome_arquivo?: string
          parser?: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
          quantidade_lancamentos?: number
          saldo_final?: number | null
          saldo_inicial?: number | null
          status?: Database["public"]["Enums"]["bank_statement_status"]
          total_entradas?: number
          total_saidas?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_imports_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_imports_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_imports_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_items: {
        Row: {
          bank_account_id: string
          card_invoice_id_matched: string | null
          confidence_score: number | null
          created_at: string
          data_movimento: string | null
          descricao_normalizada: string
          descricao_original: string
          erro_mensagem: string | null
          family_id: string
          id: string
          import_id: string
          incluir: boolean
          match_status: Database["public"]["Enums"]["bank_statement_match"]
          ordem: number
          purchase_id_matched: string | null
          tipo_sugerido: Database["public"]["Enums"]["bank_movement_kind"]
          transaction_id_criada: string | null
          transaction_id_matched: string | null
          transfer_account_id: string | null
          updated_at: string
          valor: number
        }
        Insert: {
          bank_account_id: string
          card_invoice_id_matched?: string | null
          confidence_score?: number | null
          created_at?: string
          data_movimento?: string | null
          descricao_normalizada: string
          descricao_original: string
          erro_mensagem?: string | null
          family_id: string
          id?: string
          import_id: string
          incluir?: boolean
          match_status?: Database["public"]["Enums"]["bank_statement_match"]
          ordem?: number
          purchase_id_matched?: string | null
          tipo_sugerido?: Database["public"]["Enums"]["bank_movement_kind"]
          transaction_id_criada?: string | null
          transaction_id_matched?: string | null
          transfer_account_id?: string | null
          updated_at?: string
          valor: number
        }
        Update: {
          bank_account_id?: string
          card_invoice_id_matched?: string | null
          confidence_score?: number | null
          created_at?: string
          data_movimento?: string | null
          descricao_normalizada?: string
          descricao_original?: string
          erro_mensagem?: string | null
          family_id?: string
          id?: string
          import_id?: string
          incluir?: boolean
          match_status?: Database["public"]["Enums"]["bank_statement_match"]
          ordem?: number
          purchase_id_matched?: string | null
          tipo_sugerido?: Database["public"]["Enums"]["bank_movement_kind"]
          transaction_id_criada?: string | null
          transaction_id_matched?: string | null
          transfer_account_id?: string | null
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_items_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_items_card_invoice_id_matched_fkey"
            columns: ["card_invoice_id_matched"]
            isOneToOne: false
            referencedRelation: "card_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_items_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_items_purchase_id_matched_fkey"
            columns: ["purchase_id_matched"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_items_transaction_id_criada_fkey"
            columns: ["transaction_id_criada"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_items_transaction_id_matched_fkey"
            columns: ["transaction_id_matched"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_items_transfer_account_id_fkey"
            columns: ["transfer_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
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
      card_statement_imports: {
        Row: {
          confirmado_em: string | null
          created_at: string
          created_by: string | null
          credit_card_id: string
          dados_brutos_json: Json | null
          data_fechamento: string | null
          data_vencimento: string | null
          document_id: string | null
          emissor: string | null
          erro_mensagem: string | null
          family_id: string
          final_cartao: string | null
          fingerprint: string | null
          id: string
          member_id: string | null
          nome_arquivo: string
          parser: string
          periodo_fim: string | null
          periodo_inicio: string | null
          quantidade_lancamentos: number
          status: Database["public"]["Enums"]["card_statement_status"]
          titular: string | null
          total_extraido: number
          updated_at: string
          valor_total_fatura: number
        }
        Insert: {
          confirmado_em?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_id: string
          dados_brutos_json?: Json | null
          data_fechamento?: string | null
          data_vencimento?: string | null
          document_id?: string | null
          emissor?: string | null
          erro_mensagem?: string | null
          family_id: string
          final_cartao?: string | null
          fingerprint?: string | null
          id?: string
          member_id?: string | null
          nome_arquivo: string
          parser?: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
          quantidade_lancamentos?: number
          status?: Database["public"]["Enums"]["card_statement_status"]
          titular?: string | null
          total_extraido?: number
          updated_at?: string
          valor_total_fatura?: number
        }
        Update: {
          confirmado_em?: string | null
          created_at?: string
          created_by?: string | null
          credit_card_id?: string
          dados_brutos_json?: Json | null
          data_fechamento?: string | null
          data_vencimento?: string | null
          document_id?: string | null
          emissor?: string | null
          erro_mensagem?: string | null
          family_id?: string
          final_cartao?: string | null
          fingerprint?: string | null
          id?: string
          member_id?: string | null
          nome_arquivo?: string
          parser?: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
          quantidade_lancamentos?: number
          status?: Database["public"]["Enums"]["card_statement_status"]
          titular?: string | null
          total_extraido?: number
          updated_at?: string
          valor_total_fatura?: number
        }
        Relationships: [
          {
            foreignKeyName: "card_statement_imports_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_statement_imports_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_statement_imports_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_statement_imports_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      card_statement_items: {
        Row: {
          card_last4: string | null
          categoria_sugerida_id: string | null
          confidence_score: number | null
          created_at: string
          credit_card_id: string
          data_lancamento: string | null
          decisao: string | null
          descricao_normalizada: string
          descricao_original: string
          diferenca: number | null
          erro_mensagem: string | null
          estabelecimento_sugerido: string | null
          family_id: string
          id: string
          import_id: string
          installment_id_matched: string | null
          match_status: Database["public"]["Enums"]["statement_match_status"]
          ordem: number
          parcela_atual: number | null
          purchase_id_criada: string | null
          purchase_id_matched: string | null
          recurring_expense_id_matched: string | null
          tipo_sugerido: Database["public"]["Enums"]["statement_item_kind"]
          total_parcelas: number | null
          updated_at: string
          user_action: Database["public"]["Enums"]["statement_item_action"]
          valor: number
        }
        Insert: {
          card_last4?: string | null
          categoria_sugerida_id?: string | null
          confidence_score?: number | null
          created_at?: string
          credit_card_id: string
          data_lancamento?: string | null
          decisao?: string | null
          descricao_normalizada?: string
          descricao_original: string
          diferenca?: number | null
          erro_mensagem?: string | null
          estabelecimento_sugerido?: string | null
          family_id: string
          id?: string
          import_id: string
          installment_id_matched?: string | null
          match_status?: Database["public"]["Enums"]["statement_match_status"]
          ordem?: number
          parcela_atual?: number | null
          purchase_id_criada?: string | null
          purchase_id_matched?: string | null
          recurring_expense_id_matched?: string | null
          tipo_sugerido?: Database["public"]["Enums"]["statement_item_kind"]
          total_parcelas?: number | null
          updated_at?: string
          user_action?: Database["public"]["Enums"]["statement_item_action"]
          valor?: number
        }
        Update: {
          card_last4?: string | null
          categoria_sugerida_id?: string | null
          confidence_score?: number | null
          created_at?: string
          credit_card_id?: string
          data_lancamento?: string | null
          decisao?: string | null
          descricao_normalizada?: string
          descricao_original?: string
          diferenca?: number | null
          erro_mensagem?: string | null
          estabelecimento_sugerido?: string | null
          family_id?: string
          id?: string
          import_id?: string
          installment_id_matched?: string | null
          match_status?: Database["public"]["Enums"]["statement_match_status"]
          ordem?: number
          parcela_atual?: number | null
          purchase_id_criada?: string | null
          purchase_id_matched?: string | null
          recurring_expense_id_matched?: string | null
          tipo_sugerido?: Database["public"]["Enums"]["statement_item_kind"]
          total_parcelas?: number | null
          updated_at?: string
          user_action?: Database["public"]["Enums"]["statement_item_action"]
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "card_statement_items_categoria_sugerida_id_fkey"
            columns: ["categoria_sugerida_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_statement_items_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_statement_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_statement_items_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "card_statement_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_statement_items_installment_id_matched_fkey"
            columns: ["installment_id_matched"]
            isOneToOne: false
            referencedRelation: "expense_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_statement_items_purchase_id_criada_fkey"
            columns: ["purchase_id_criada"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_statement_items_purchase_id_matched_fkey"
            columns: ["purchase_id_matched"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_statement_items_recurring_expense_id_matched_fkey"
            columns: ["recurring_expense_id_matched"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
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
      document_extraction_items: {
        Row: {
          categoria_sugerida: string | null
          created_at: string
          descricao_produto: string
          extraction_id: string
          id: string
          quantidade: number
          unidade: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          categoria_sugerida?: string | null
          created_at?: string
          descricao_produto: string
          extraction_id: string
          id?: string
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          categoria_sugerida?: string | null
          created_at?: string
          descricao_produto?: string
          extraction_id?: string
          id?: string
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_extraction_items_categoria_sugerida_fkey"
            columns: ["categoria_sugerida"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_extraction_items_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "document_extractions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_extractions: {
        Row: {
          created_at: string
          dados_brutos_json: Json | null
          data_compra: string | null
          document_id: string
          estabelecimento: string | null
          family_id: string
          forma_pagamento: Database["public"]["Enums"]["payment_method"] | null
          id: string
          member_id: string | null
          updated_at: string
          valor_total: number
        }
        Insert: {
          created_at?: string
          dados_brutos_json?: Json | null
          data_compra?: string | null
          document_id: string
          estabelecimento?: string | null
          family_id: string
          forma_pagamento?: Database["public"]["Enums"]["payment_method"] | null
          id?: string
          member_id?: string | null
          updated_at?: string
          valor_total?: number
        }
        Update: {
          created_at?: string
          dados_brutos_json?: Json | null
          data_compra?: string | null
          document_id?: string
          estabelecimento?: string | null
          family_id?: string
          forma_pagamento?: Database["public"]["Enums"]["payment_method"] | null
          id?: string
          member_id?: string | null
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_extractions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_extractions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      document_test_cases: {
        Row: {
          arquivo_referencia: string | null
          created_at: string
          data_esperada: string | null
          document_type_id: string
          estabelecimento_esperado: string | null
          id: string
          nome_teste: string
          observacoes: string | null
          pagamento_esperado: string | null
          quantidade_itens_esperada: number | null
          resultado: Database["public"]["Enums"]["document_test_status"]
          ultimo_teste_em: string | null
          updated_at: string
          valor_esperado: number | null
        }
        Insert: {
          arquivo_referencia?: string | null
          created_at?: string
          data_esperada?: string | null
          document_type_id: string
          estabelecimento_esperado?: string | null
          id?: string
          nome_teste: string
          observacoes?: string | null
          pagamento_esperado?: string | null
          quantidade_itens_esperada?: number | null
          resultado?: Database["public"]["Enums"]["document_test_status"]
          ultimo_teste_em?: string | null
          updated_at?: string
          valor_esperado?: number | null
        }
        Update: {
          arquivo_referencia?: string | null
          created_at?: string
          data_esperada?: string | null
          document_type_id?: string
          estabelecimento_esperado?: string | null
          id?: string
          nome_teste?: string
          observacoes?: string | null
          pagamento_esperado?: string | null
          quantidade_itens_esperada?: number | null
          resultado?: Database["public"]["Enums"]["document_test_status"]
          ultimo_teste_em?: string | null
          updated_at?: string
          valor_esperado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_test_cases_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
        ]
      }
      document_types: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          descricao: string
          estrategia_leitura: Database["public"]["Enums"]["document_read_strategy"]
          id: string
          nome: string
          prioridade: number
          requires_ocr: boolean
          status_inicial: Database["public"]["Enums"]["document_test_status"]
          supports_qr_code: boolean
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          descricao?: string
          estrategia_leitura?: Database["public"]["Enums"]["document_read_strategy"]
          id?: string
          nome: string
          prioridade?: number
          requires_ocr?: boolean
          status_inicial?: Database["public"]["Enums"]["document_test_status"]
          supports_qr_code?: boolean
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          descricao?: string
          estrategia_leitura?: Database["public"]["Enums"]["document_read_strategy"]
          id?: string
          nome?: string
          prioridade?: number
          requires_ocr?: boolean
          status_inicial?: Database["public"]["Enums"]["document_test_status"]
          supports_qr_code?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          chave_documento: string | null
          codigo_externo: string | null
          created_at: string
          created_by: string | null
          document_type_confidence: number
          document_type_id: string | null
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
          document_type_confidence?: number
          document_type_id?: string | null
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
          document_type_confidence?: number
          document_type_id?: string | null
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
            foreignKeyName: "documents_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
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
          credit_card_id: string | null
          data_vencimento: string
          expense_id: string
          family_id: string
          id: string
          member_id: string | null
          numero_parcela: number
          purchase_id: string | null
          status: Database["public"]["Enums"]["installment_status"]
          total_parcelas: number
          updated_at: string
          valor_parcela: number
        }
        Insert: {
          card_invoice_id?: string | null
          created_at?: string
          credit_card_id?: string | null
          data_vencimento: string
          expense_id: string
          family_id: string
          id?: string
          member_id?: string | null
          numero_parcela?: number
          purchase_id?: string | null
          status?: Database["public"]["Enums"]["installment_status"]
          total_parcelas?: number
          updated_at?: string
          valor_parcela?: number
        }
        Update: {
          card_invoice_id?: string | null
          created_at?: string
          credit_card_id?: string | null
          data_vencimento?: string
          expense_id?: string
          family_id?: string
          id?: string
          member_id?: string | null
          numero_parcela?: number
          purchase_id?: string | null
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
            foreignKeyName: "expense_installments_credit_card_id_fkey"
            columns: ["credit_card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
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
          {
            foreignKeyName: "expense_installments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_installments_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
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
      family_reset_logs: {
        Row: {
          backup_created: boolean
          created_at: string
          family_id: string
          family_nome: string | null
          id: string
          reset_type: string
          totais: Json | null
          user_id: string | null
        }
        Insert: {
          backup_created?: boolean
          created_at?: string
          family_id: string
          family_nome?: string | null
          id?: string
          reset_type: string
          totais?: Json | null
          user_id?: string | null
        }
        Update: {
          backup_created?: boolean
          created_at?: string
          family_id?: string
          family_nome?: string | null
          id?: string
          reset_type?: string
          totais?: Json | null
          user_id?: string | null
        }
        Relationships: []
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
          dia_recebimento: number | null
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
          dia_recebimento?: number | null
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
          dia_recebimento?: number | null
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
      monthly_closing_logs: {
        Row: {
          acao: string
          ano: number
          created_at: string
          created_by: string | null
          family_id: string
          id: string
          member_id: string | null
          mes: number
          motivo: string | null
          snapshot_id: string | null
        }
        Insert: {
          acao: string
          ano: number
          created_at?: string
          created_by?: string | null
          family_id: string
          id?: string
          member_id?: string | null
          mes: number
          motivo?: string | null
          snapshot_id?: string | null
        }
        Update: {
          acao?: string
          ano?: number
          created_at?: string
          created_by?: string | null
          family_id?: string
          id?: string
          member_id?: string | null
          mes?: number
          motivo?: string | null
          snapshot_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_closing_logs_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_closing_logs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_closing_logs_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "monthly_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_snapshots: {
        Row: {
          ano: number
          compras_cartao: number
          compras_pix_debito_dinheiro: number
          comprometido_final: number
          contas_recorrentes_do_mes: number
          created_at: string
          dinheiro_livre_final: number
          family_id: string
          faturas_em_aberto: number
          faturas_pagas: number
          fechado: boolean
          fechado_em: string
          fechado_por: string | null
          gastos_realizados: number
          id: string
          member_id: string | null
          mes: number
          motivo_reabertura: string | null
          parcelas_do_mes: number
          reaberto_em: string | null
          reaberto_por: string | null
          receita_total_real: number
          recorrencias_do_mes: number
          renda_fixa: number
          renda_variavel_prevista: number
          renda_variavel_recebida: number
          reserva_final: number
          saldo_bancario_final: number
          status_saude_financeira: string
          updated_at: string
        }
        Insert: {
          ano: number
          compras_cartao?: number
          compras_pix_debito_dinheiro?: number
          comprometido_final?: number
          contas_recorrentes_do_mes?: number
          created_at?: string
          dinheiro_livre_final?: number
          family_id: string
          faturas_em_aberto?: number
          faturas_pagas?: number
          fechado?: boolean
          fechado_em?: string
          fechado_por?: string | null
          gastos_realizados?: number
          id?: string
          member_id?: string | null
          mes: number
          motivo_reabertura?: string | null
          parcelas_do_mes?: number
          reaberto_em?: string | null
          reaberto_por?: string | null
          receita_total_real?: number
          recorrencias_do_mes?: number
          renda_fixa?: number
          renda_variavel_prevista?: number
          renda_variavel_recebida?: number
          reserva_final?: number
          saldo_bancario_final?: number
          status_saude_financeira?: string
          updated_at?: string
        }
        Update: {
          ano?: number
          compras_cartao?: number
          compras_pix_debito_dinheiro?: number
          comprometido_final?: number
          contas_recorrentes_do_mes?: number
          created_at?: string
          dinheiro_livre_final?: number
          family_id?: string
          faturas_em_aberto?: number
          faturas_pagas?: number
          fechado?: boolean
          fechado_em?: string
          fechado_por?: string | null
          gastos_realizados?: number
          id?: string
          member_id?: string | null
          mes?: number
          motivo_reabertura?: string | null
          parcelas_do_mes?: number
          reaberto_em?: string | null
          reaberto_por?: string | null
          receita_total_real?: number
          recorrencias_do_mes?: number
          renda_fixa?: number
          renda_variavel_prevista?: number
          renda_variavel_recebida?: number
          reserva_final?: number
          saldo_bancario_final?: number
          status_saude_financeira?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_snapshots_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_snapshots_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
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
          categoria_ajustada: boolean
          categoria_id: string | null
          categoria_sugerida: string | null
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
          categoria_ajustada?: boolean
          categoria_id?: string | null
          categoria_sugerida?: string | null
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
          categoria_ajustada?: boolean
          categoria_id?: string | null
          categoria_sugerida?: string | null
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
            foreignKeyName: "purchase_items_categoria_sugerida_fkey"
            columns: ["categoria_sugerida"]
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
          data_pagamento_real: string | null
          data_prevista_pagamento: string | null
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
          data_pagamento_real?: string | null
          data_prevista_pagamento?: string | null
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
          data_pagamento_real?: string | null
          data_prevista_pagamento?: string | null
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
      reconciliation_audit: {
        Row: {
          campo: string
          created_at: string
          created_by: string | null
          entidade: string
          entidade_id: string
          family_id: string
          id: string
          origem: string
          valor_anterior: string | null
          valor_novo: string | null
        }
        Insert: {
          campo: string
          created_at?: string
          created_by?: string | null
          entidade: string
          entidade_id: string
          family_id: string
          id?: string
          origem?: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Update: {
          campo?: string
          created_at?: string
          created_by?: string | null
          entidade?: string
          entidade_id?: string
          family_id?: string
          id?: string
          origem?: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_audit_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliations: {
        Row: {
          confidence_score: number | null
          created_at: string
          family_id: string
          id: string
          observacao: string | null
          reconciled_at: string
          reconciled_by: string | null
          source_id: string
          source_type: string
          status: Database["public"]["Enums"]["reconciliation_status"]
          target_id: string
          target_type: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          family_id: string
          id?: string
          observacao?: string | null
          reconciled_at?: string
          reconciled_by?: string | null
          source_id: string
          source_type: string
          status?: Database["public"]["Enums"]["reconciliation_status"]
          target_id: string
          target_type: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          family_id?: string
          id?: string
          observacao?: string | null
          reconciled_at?: string
          reconciled_by?: string | null
          source_id?: string
          source_type?: string
          status?: Database["public"]["Enums"]["reconciliation_status"]
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliations_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
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
          data_cancelamento: string | null
          data_inicio: string
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
          data_cancelamento?: string | null
          data_inicio?: string
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
          data_cancelamento?: string | null
          data_inicio?: string
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
          transfer_group_id: string | null
          transfer_role: string | null
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
          transfer_group_id?: string | null
          transfer_role?: string | null
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
          transfer_group_id?: string | null
          transfer_role?: string | null
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
      adjust_bank_account_balance: {
        Args: { _account_id: string; _motivo?: string; _novo_saldo: number }
        Returns: string
      }
      archive_bank_account: {
        Args: { _account_id: string; _ativo: boolean }
        Returns: undefined
      }
      archive_credit_card: {
        Args: { _ativo: boolean; _card_id: string }
        Returns: undefined
      }
      can_manage_member_record: {
        Args: { _family_id: string; _member_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_member_record: {
        Args: { _family_id: string; _member_id: string; _user_id: string }
        Returns: boolean
      }
      create_family_with_owner: {
        Args: { p_family_name: string; p_first_member_name?: string }
        Returns: Json
      }
      delete_bank_account_if_unused: {
        Args: { _account_id: string }
        Returns: undefined
      }
      delete_credit_card_if_unused: {
        Args: { _card_id: string }
        Returns: undefined
      }
      delete_demo_data: { Args: never; Returns: number }
      ensure_invoice_for_due: {
        Args: { _card_id: string; _venc: string }
        Returns: string
      }
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
      purge_demo_families: { Args: { demo_ids: string[] }; Returns: number }
      purge_family_records: {
        Args: { _family_id: string; _keep_structure: boolean }
        Returns: Json
      }
      reset_family_completely: {
        Args: { _backup_created?: boolean; _family_id: string }
        Returns: Json
      }
      reset_family_financial_data: {
        Args: {
          _backup_created?: boolean
          _family_id: string
          _remover_demo?: boolean
        }
        Returns: Json
      }
      sync_installment_invoices: {
        Args: { _family_id?: string }
        Returns: number
      }
      transfer_between_accounts: {
        Args: {
          _data?: string
          _descricao?: string
          _destino_id: string
          _origem_id: string
          _valor: number
        }
        Returns: string
      }
    }
    Enums: {
      bank_account_type: "CORRENTE" | "POUPANCA" | "PAGAMENTO" | "INVESTIMENTO"
      bank_movement_kind:
        | "ENTRADA"
        | "SAIDA"
        | "TRANSFERENCIA"
        | "TARIFA"
        | "JUROS"
        | "ESTORNO"
        | "AJUSTE"
        | "OUTRO"
      bank_statement_format: "PDF" | "CSV" | "OFX" | "IMAGEM"
      bank_statement_match: "MATCHED" | "POSSIBLE_MATCH" | "NEW" | "IGNORED"
      bank_statement_status:
        | "UPLOADED"
        | "PROCESSING"
        | "READY_FOR_REVIEW"
        | "CONFIRMED"
        | "CANCELLED"
        | "ERROR"
      budget_period: "MENSAL"
      card_statement_status:
        | "UPLOADED"
        | "PROCESSING"
        | "READY_FOR_REVIEW"
        | "CONFIRMED"
        | "CANCELLED"
        | "ERROR"
      document_read_strategy:
        | "DANFE_PDF_TABULAR"
        | "NFCE_QRCODE"
        | "OCR_CUPOM"
        | "OCR_GENERICO"
        | "MANUAL"
      document_status:
        | "ENVIADO"
        | "PROCESSANDO"
        | "PROCESSADO"
        | "CONFIRMADO"
        | "ERRO"
        | "REJEITADO"
      document_test_status:
        | "AGUARDANDO_TESTE"
        | "EM_TESTE"
        | "APROVADO"
        | "FALHOU"
        | "REGRESSAO"
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
        | "A_DEFINIR"
      purchase_import_status: "PENDENTE_APROVACAO" | "APROVADO" | "REJEITADO"
      purchase_payment_status:
        | "PAGO"
        | "COMPROMETIDO"
        | "PENDENTE"
        | "CANCELADO"
        | "PENDENTE_PAGAMENTO"
        | "PARCIALMENTE_PAGA"
      purchase_type:
        | "A_VISTA"
        | "CARTAO_CREDITO"
        | "PARCELADO"
        | "COMPRA_NORMAL"
        | "COMPRA_RECORRENTE"
        | "COMPRA_PARCELADA"
        | "CONTA_RECORRENTE"
      reconciliation_status: "PENDENTE" | "CONFIRMADA" | "DESFEITA"
      statement_item_action: "PENDENTE" | "PROCESSANDO" | "CONCLUIDO" | "ERRO"
      statement_item_kind:
        | "COMPRA"
        | "PAGAMENTO"
        | "ESTORNO"
        | "JUROS"
        | "TAXA"
        | "AJUSTE"
        | "OUTRO"
      statement_match_status:
        | "MATCHED"
        | "UNMATCHED"
        | "DIVERGENT"
        | "POSSIBLE_MATCH"
        | "IGNORED"
        | "CONFIRMED_NEW"
      transaction_status: "CONFIRMADA" | "PENDENTE" | "CANCELADA"
      transaction_type:
        | "ENTRADA"
        | "SAIDA"
        | "TRANSFERENCIA"
        | "PAGAMENTO_CARTAO"
        | "AJUSTE_SALDO"
        | "ABERTURA_SALDO"
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
      bank_movement_kind: [
        "ENTRADA",
        "SAIDA",
        "TRANSFERENCIA",
        "TARIFA",
        "JUROS",
        "ESTORNO",
        "AJUSTE",
        "OUTRO",
      ],
      bank_statement_format: ["PDF", "CSV", "OFX", "IMAGEM"],
      bank_statement_match: ["MATCHED", "POSSIBLE_MATCH", "NEW", "IGNORED"],
      bank_statement_status: [
        "UPLOADED",
        "PROCESSING",
        "READY_FOR_REVIEW",
        "CONFIRMED",
        "CANCELLED",
        "ERROR",
      ],
      budget_period: ["MENSAL"],
      card_statement_status: [
        "UPLOADED",
        "PROCESSING",
        "READY_FOR_REVIEW",
        "CONFIRMED",
        "CANCELLED",
        "ERROR",
      ],
      document_read_strategy: [
        "DANFE_PDF_TABULAR",
        "NFCE_QRCODE",
        "OCR_CUPOM",
        "OCR_GENERICO",
        "MANUAL",
      ],
      document_status: [
        "ENVIADO",
        "PROCESSANDO",
        "PROCESSADO",
        "CONFIRMADO",
        "ERRO",
        "REJEITADO",
      ],
      document_test_status: [
        "AGUARDANDO_TESTE",
        "EM_TESTE",
        "APROVADO",
        "FALHOU",
        "REGRESSAO",
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
        "A_DEFINIR",
      ],
      purchase_import_status: ["PENDENTE_APROVACAO", "APROVADO", "REJEITADO"],
      purchase_payment_status: [
        "PAGO",
        "COMPROMETIDO",
        "PENDENTE",
        "CANCELADO",
        "PENDENTE_PAGAMENTO",
        "PARCIALMENTE_PAGA",
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
      reconciliation_status: ["PENDENTE", "CONFIRMADA", "DESFEITA"],
      statement_item_action: ["PENDENTE", "PROCESSANDO", "CONCLUIDO", "ERRO"],
      statement_item_kind: [
        "COMPRA",
        "PAGAMENTO",
        "ESTORNO",
        "JUROS",
        "TAXA",
        "AJUSTE",
        "OUTRO",
      ],
      statement_match_status: [
        "MATCHED",
        "UNMATCHED",
        "DIVERGENT",
        "POSSIBLE_MATCH",
        "IGNORED",
        "CONFIRMED_NEW",
      ],
      transaction_status: ["CONFIRMADA", "PENDENTE", "CANCELADA"],
      transaction_type: [
        "ENTRADA",
        "SAIDA",
        "TRANSFERENCIA",
        "PAGAMENTO_CARTAO",
        "AJUSTE_SALDO",
        "ABERTURA_SALDO",
      ],
    },
  },
} as const
