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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agenda_eventos: {
        Row: {
          atualizado_em: string
          cor: string | null
          descricao: string | null
          dia: string
          dia_inteiro: boolean
          eh_pagamento: boolean
          event_id: string
          id: string
          link: string | null
          rotulo: string
          titulo: string
          valor: number | null
        }
        Insert: {
          atualizado_em?: string
          cor?: string | null
          descricao?: string | null
          dia: string
          dia_inteiro?: boolean
          eh_pagamento?: boolean
          event_id: string
          id?: string
          link?: string | null
          rotulo: string
          titulo: string
          valor?: number | null
        }
        Update: {
          atualizado_em?: string
          cor?: string | null
          descricao?: string | null
          dia?: string
          dia_inteiro?: boolean
          eh_pagamento?: boolean
          event_id?: string
          id?: string
          link?: string | null
          rotulo?: string
          titulo?: string
          valor?: number | null
        }
        Relationships: []
      }
      agente_excecoes: {
        Row: {
          agente_id: string
          atribuido_a: string | null
          atualizado_em: string
          criado_em: string
          descricao: string | null
          entidade: string | null
          entidade_id: string | null
          execucao_id: string | null
          id: string
          resolucao: string | null
          resolvido_em: string | null
          resolvido_por: string | null
          severidade: string
          sla_horas: number
          status: string
          tipo: string
          titulo: string
          valor: number | null
          vence_em: string | null
        }
        Insert: {
          agente_id: string
          atribuido_a?: string | null
          atualizado_em?: string
          criado_em?: string
          descricao?: string | null
          entidade?: string | null
          entidade_id?: string | null
          execucao_id?: string | null
          id?: string
          resolucao?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          severidade?: string
          sla_horas?: number
          status?: string
          tipo: string
          titulo: string
          valor?: number | null
          vence_em?: string | null
        }
        Update: {
          agente_id?: string
          atribuido_a?: string | null
          atualizado_em?: string
          criado_em?: string
          descricao?: string | null
          entidade?: string | null
          entidade_id?: string | null
          execucao_id?: string | null
          id?: string
          resolucao?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          severidade?: string
          sla_horas?: number
          status?: string
          tipo?: string
          titulo?: string
          valor?: number | null
          vence_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agente_excecoes_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agente_excecoes_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "vw_agente_saude"
            referencedColumns: ["agente_id"]
          },
          {
            foreignKeyName: "agente_excecoes_atribuido_a_fkey"
            columns: ["atribuido_a"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agente_excecoes_execucao_id_fkey"
            columns: ["execucao_id"]
            isOneToOne: false
            referencedRelation: "agente_execucoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agente_excecoes_resolvido_por_fkey"
            columns: ["resolvido_por"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_execucoes: {
        Row: {
          agente_id: string
          alcada: string | null
          confianca: number | null
          correcao: Json | null
          corrigido_em: string | null
          corrigido_por: string | null
          corrigido_por_humano: boolean
          entidade: string | null
          entidade_id: string | null
          entrada: Json | null
          erro: string | null
          executado_em: string
          id: string
          latencia_ms: number | null
          regra_id: string | null
          resultado: string
          saida: Json | null
          tarefa: string
        }
        Insert: {
          agente_id: string
          alcada?: string | null
          confianca?: number | null
          correcao?: Json | null
          corrigido_em?: string | null
          corrigido_por?: string | null
          corrigido_por_humano?: boolean
          entidade?: string | null
          entidade_id?: string | null
          entrada?: Json | null
          erro?: string | null
          executado_em?: string
          id?: string
          latencia_ms?: number | null
          regra_id?: string | null
          resultado: string
          saida?: Json | null
          tarefa: string
        }
        Update: {
          agente_id?: string
          alcada?: string | null
          confianca?: number | null
          correcao?: Json | null
          corrigido_em?: string | null
          corrigido_por?: string | null
          corrigido_por_humano?: boolean
          entidade?: string | null
          entidade_id?: string | null
          entrada?: Json | null
          erro?: string | null
          executado_em?: string
          id?: string
          latencia_ms?: number | null
          regra_id?: string | null
          resultado?: string
          saida?: Json | null
          tarefa?: string
        }
        Relationships: [
          {
            foreignKeyName: "agente_execucoes_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agente_execucoes_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "vw_agente_saude"
            referencedColumns: ["agente_id"]
          },
          {
            foreignKeyName: "agente_execucoes_corrigido_por_fkey"
            columns: ["corrigido_por"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agente_execucoes_regra_id_fkey"
            columns: ["regra_id"]
            isOneToOne: false
            referencedRelation: "regras_decisao"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_obrigacoes: {
        Row: {
          agente_id: string
          atualizado_em: string
          chave_nfe: string | null
          cod_omie: string | null
          codigo_integracao: string | null
          criado_em: string
          documento_norm: string
          email_message_id: string | null
          email_uid: string | null
          estado: string
          fornecedor_id: string | null
          id: string
          numero_documento: string | null
          observacao: string | null
          origem_cobranca: string | null
          origem_nota: string | null
          valor: number
          vencimento: string
          vinculado_em: string | null
        }
        Insert: {
          agente_id: string
          atualizado_em?: string
          chave_nfe?: string | null
          cod_omie?: string | null
          codigo_integracao?: string | null
          criado_em?: string
          documento_norm: string
          email_message_id?: string | null
          email_uid?: string | null
          estado?: string
          fornecedor_id?: string | null
          id?: string
          numero_documento?: string | null
          observacao?: string | null
          origem_cobranca?: string | null
          origem_nota?: string | null
          valor: number
          vencimento: string
          vinculado_em?: string | null
        }
        Update: {
          agente_id?: string
          atualizado_em?: string
          chave_nfe?: string | null
          cod_omie?: string | null
          codigo_integracao?: string | null
          criado_em?: string
          documento_norm?: string
          email_message_id?: string | null
          email_uid?: string | null
          estado?: string
          fornecedor_id?: string | null
          id?: string
          numero_documento?: string | null
          observacao?: string | null
          origem_cobranca?: string | null
          origem_nota?: string | null
          valor?: number
          vencimento?: string
          vinculado_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agente_obrigacoes_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agente_obrigacoes_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "vw_agente_saude"
            referencedColumns: ["agente_id"]
          },
          {
            foreignKeyName: "agente_obrigacoes_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "lib_fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes: {
        Row: {
          alcada_maxima: string
          ativo: boolean
          atualizado_em: string
          automacao_id: string | null
          criado_em: string
          descricao: string | null
          id: string
          nome: string
        }
        Insert: {
          alcada_maxima?: string
          ativo?: boolean
          atualizado_em?: string
          automacao_id?: string | null
          criado_em?: string
          descricao?: string | null
          id: string
          nome: string
        }
        Update: {
          alcada_maxima?: string
          ativo?: boolean
          atualizado_em?: string
          automacao_id?: string | null
          criado_em?: string
          descricao?: string | null
          id?: string
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "agentes_automacao_id_fkey"
            columns: ["automacao_id"]
            isOneToOne: false
            referencedRelation: "automacoes_catalogo"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          titulo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          titulo?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          titulo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_dashboard_cache: {
        Row: {
          created_at: string
          id: string
          insights: Json
          periodo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          insights?: Json
          periodo: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          insights?: Json
          periodo?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          imagens: Json
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          imagens?: Json
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          imagens?: Json
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_model_pricing: {
        Row: {
          input_per_1m_usd: number
          model: string
          output_per_1m_usd: number
          updated_at: string
        }
        Insert: {
          input_per_1m_usd?: number
          model: string
          output_per_1m_usd?: number
          updated_at?: string
        }
        Update: {
          input_per_1m_usd?: number
          model?: string
          output_per_1m_usd?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          completion_tokens: number
          cost_usd: number
          created_at: string
          feature: string
          id: string
          model: string
          prompt_tokens: number
          total_tokens: number
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          feature: string
          id?: string
          model: string
          prompt_tokens?: number
          total_tokens?: number
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          feature?: string
          id?: string
          model?: string
          prompt_tokens?: number
          total_tokens?: number
          user_id?: string | null
        }
        Relationships: []
      }
      asaas_cache: {
        Row: {
          assinatura_ref: string | null
          atualizado_em: string
          ciclo: string | null
          cliente_ref: string | null
          confirmado_em: string | null
          dados: Json
          data_credito: string | null
          data_criacao: string | null
          data_efetiva: string | null
          data_pagamento: string | null
          data_vencimento: string | null
          descricao: string | null
          documento: string | null
          email: string | null
          estornos: number | null
          forma: string | null
          id_asaas: string
          nome: string | null
          nota_numero: string | null
          pagamento_ref: string | null
          pago_cliente_em: string | null
          status: string | null
          tipo: string
          valor: number | null
          valor_liquido: number | null
        }
        Insert: {
          assinatura_ref?: string | null
          atualizado_em?: string
          ciclo?: string | null
          cliente_ref?: string | null
          confirmado_em?: string | null
          dados: Json
          data_credito?: string | null
          data_criacao?: string | null
          data_efetiva?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          descricao?: string | null
          documento?: string | null
          email?: string | null
          estornos?: number | null
          forma?: string | null
          id_asaas: string
          nome?: string | null
          nota_numero?: string | null
          pagamento_ref?: string | null
          pago_cliente_em?: string | null
          status?: string | null
          tipo: string
          valor?: number | null
          valor_liquido?: number | null
        }
        Update: {
          assinatura_ref?: string | null
          atualizado_em?: string
          ciclo?: string | null
          cliente_ref?: string | null
          confirmado_em?: string | null
          dados?: Json
          data_credito?: string | null
          data_criacao?: string | null
          data_efetiva?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          descricao?: string | null
          documento?: string | null
          email?: string | null
          estornos?: number | null
          forma?: string | null
          id_asaas?: string
          nome?: string | null
          nota_numero?: string | null
          pagamento_ref?: string | null
          pago_cliente_em?: string | null
          status?: string | null
          tipo?: string
          valor?: number | null
          valor_liquido?: number | null
        }
        Relationships: []
      }
      asaas_extrato: {
        Row: {
          contraparte_documento: string | null
          contraparte_nome: string | null
          criado_em: string
          data_movimento: string | null
          historico: string | null
          id: string
          id_transacao: string
          numero_documento: string | null
          tipo: string | null
          valor: number | null
        }
        Insert: {
          contraparte_documento?: string | null
          contraparte_nome?: string | null
          criado_em?: string
          data_movimento?: string | null
          historico?: string | null
          id?: string
          id_transacao: string
          numero_documento?: string | null
          tipo?: string | null
          valor?: number | null
        }
        Update: {
          contraparte_documento?: string | null
          contraparte_nome?: string | null
          criado_em?: string
          data_movimento?: string | null
          historico?: string | null
          id?: string
          id_transacao?: string
          numero_documento?: string | null
          tipo?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      asaas_nf_config: {
        Row: {
          assinatura: string
          erro: string | null
          lido_em: string
          periodo: string | null
          tem_config: boolean | null
        }
        Insert: {
          assinatura: string
          erro?: string | null
          lido_em?: string
          periodo?: string | null
          tem_config?: boolean | null
        }
        Update: {
          assinatura?: string
          erro?: string | null
          lido_em?: string
          periodo?: string | null
          tem_config?: boolean | null
        }
        Relationships: []
      }
      asaas_saldo: {
        Row: {
          atualizado_em: string | null
          conta: string | null
          id: string
          saldo: number | null
          saldo_bloqueado: number | null
          saldo_disponivel: number | null
        }
        Insert: {
          atualizado_em?: string | null
          conta?: string | null
          id?: string
          saldo?: number | null
          saldo_bloqueado?: number | null
          saldo_disponivel?: number | null
        }
        Update: {
          atualizado_em?: string | null
          conta?: string | null
          id?: string
          saldo?: number | null
          saldo_bloqueado?: number | null
          saldo_disponivel?: number | null
        }
        Relationships: []
      }
      asaas_snapshots: {
        Row: {
          dados: Json
          gerado_em: string
          id: string
          referencia: string
        }
        Insert: {
          dados?: Json
          gerado_em?: string
          id?: string
          referencia: string
        }
        Update: {
          dados?: Json
          gerado_em?: string
          id?: string
          referencia?: string
        }
        Relationships: []
      }
      asaas_sync_estado: {
        Row: {
          detalhe: Json | null
          escopo: string
          ultima_completa: string | null
          ultima_incremental: string | null
        }
        Insert: {
          detalhe?: Json | null
          escopo: string
          ultima_completa?: string | null
          ultima_incremental?: string | null
        }
        Update: {
          detalhe?: Json | null
          escopo?: string
          ultima_completa?: string | null
          ultima_incremental?: string | null
        }
        Relationships: []
      }
      assinaturas_snapshot: {
        Row: {
          competencia: string
          dados: Json
          gerado_em: string
          insights: Json | null
          mes_label: string
          sincronizado_em: string | null
        }
        Insert: {
          competencia: string
          dados: Json
          gerado_em?: string
          insights?: Json | null
          mes_label: string
          sincronizado_em?: string | null
        }
        Update: {
          competencia?: string
          dados?: Json
          gerado_em?: string
          insights?: Json | null
          mes_label?: string
          sincronizado_em?: string | null
        }
        Relationships: []
      }
      assistente_execucao: {
        Row: {
          avisos: Json
          consulta: string | null
          conversa_id: string | null
          criado_em: string
          id: string
          latencia_ms: number | null
          numeros: Json
          ok: boolean
          pergunta: string
          resposta: string | null
          user_id: string
        }
        Insert: {
          avisos?: Json
          consulta?: string | null
          conversa_id?: string | null
          criado_em?: string
          id?: string
          latencia_ms?: number | null
          numeros?: Json
          ok?: boolean
          pergunta: string
          resposta?: string | null
          user_id: string
        }
        Update: {
          avisos?: Json
          consulta?: string | null
          conversa_id?: string | null
          criado_em?: string
          id?: string
          latencia_ms?: number | null
          numeros?: Json
          ok?: boolean
          pergunta?: string
          resposta?: string | null
          user_id?: string
        }
        Relationships: []
      }
      assistente_memoria: {
        Row: {
          conversa_id: string | null
          criado_em: string
          id: string
          origem: string
          texto: string
          texto_norm: string | null
          tipo: string
          user_id: string
        }
        Insert: {
          conversa_id?: string | null
          criado_em?: string
          id?: string
          origem?: string
          texto: string
          texto_norm?: string | null
          tipo?: string
          user_id: string
        }
        Update: {
          conversa_id?: string | null
          criado_em?: string
          id?: string
          origem?: string
          texto?: string
          texto_norm?: string | null
          tipo?: string
          user_id?: string
        }
        Relationships: []
      }
      auditoria: {
        Row: {
          area: string
          categoria: string | null
          competencia: string
          created_at: string
          data_lancamento: string | null
          descricao: string | null
          ia_aprovado_em: string | null
          ia_arquivo: string | null
          ia_conferido_em: string | null
          ia_leitura: Json | null
          ia_motivo: string | null
          ia_veredito: string | null
          id: number
          id_transacao: string | null
          id_unico: string
          justificativa: string | null
          link_comprovante: string | null
          omie_anexo_enviado_em: string | null
          omie_anexo_nome: string | null
          omie_categoria_codigo: string | null
          omie_categoria_descricao: string | null
          omie_cod_titulo: string | null
          omie_match_confianca: string | null
          omie_matched_em: string | null
          origem: string | null
          regra: string
          responsavel: string | null
          severidade: string
          status: string
          titulo: string
          trilha: Json
          updated_at: string
          valor: number
        }
        Insert: {
          area: string
          categoria?: string | null
          competencia: string
          created_at?: string
          data_lancamento?: string | null
          descricao?: string | null
          ia_aprovado_em?: string | null
          ia_arquivo?: string | null
          ia_conferido_em?: string | null
          ia_leitura?: Json | null
          ia_motivo?: string | null
          ia_veredito?: string | null
          id?: never
          id_transacao?: string | null
          id_unico: string
          justificativa?: string | null
          link_comprovante?: string | null
          omie_anexo_enviado_em?: string | null
          omie_anexo_nome?: string | null
          omie_categoria_codigo?: string | null
          omie_categoria_descricao?: string | null
          omie_cod_titulo?: string | null
          omie_match_confianca?: string | null
          omie_matched_em?: string | null
          origem?: string | null
          regra: string
          responsavel?: string | null
          severidade: string
          status?: string
          titulo: string
          trilha?: Json
          updated_at?: string
          valor?: number
        }
        Update: {
          area?: string
          categoria?: string | null
          competencia?: string
          created_at?: string
          data_lancamento?: string | null
          descricao?: string | null
          ia_aprovado_em?: string | null
          ia_arquivo?: string | null
          ia_conferido_em?: string | null
          ia_leitura?: Json | null
          ia_motivo?: string | null
          ia_veredito?: string | null
          id?: never
          id_transacao?: string | null
          id_unico?: string
          justificativa?: string | null
          link_comprovante?: string | null
          omie_anexo_enviado_em?: string | null
          omie_anexo_nome?: string | null
          omie_categoria_codigo?: string | null
          omie_categoria_descricao?: string | null
          omie_cod_titulo?: string | null
          omie_match_confianca?: string | null
          omie_matched_em?: string | null
          origem?: string | null
          regra?: string
          responsavel?: string | null
          severidade?: string
          status?: string
          titulo?: string
          trilha?: Json
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_auditoria_area"
            columns: ["area"]
            isOneToOne: false
            referencedRelation: "lib_departamentos"
            referencedColumns: ["nome"]
          },
        ]
      }
      auditoria_cartao_lancamentos: {
        Row: {
          arquivo_comprovante: string | null
          card_final: string | null
          categoria: string | null
          categoria_auditoria: string | null
          competencia: string
          created_at: string
          data: string | null
          descricao_original: string | null
          estabelecimento: string | null
          gestor: string | null
          id: number
          id_unico: string
          justificativa_lider: string | null
          justificativa_lider_em: string | null
          link_comprovante: string | null
          observacao: string | null
          omie_anexo_enviado_em: string | null
          omie_anexo_nome: string | null
          omie_categoria_codigo: string | null
          omie_categoria_descricao: string | null
          omie_cod_titulo: string | null
          omie_match_confianca: string | null
          omie_matched_em: string | null
          origem: string
          parcela: string | null
          referencia: string
          status_escopo: string | null
          status_nf: string
          time: string | null
          updated_at: string
          valor: number
        }
        Insert: {
          arquivo_comprovante?: string | null
          card_final?: string | null
          categoria?: string | null
          categoria_auditoria?: string | null
          competencia: string
          created_at?: string
          data?: string | null
          descricao_original?: string | null
          estabelecimento?: string | null
          gestor?: string | null
          id?: number
          id_unico: string
          justificativa_lider?: string | null
          justificativa_lider_em?: string | null
          link_comprovante?: string | null
          observacao?: string | null
          omie_anexo_enviado_em?: string | null
          omie_anexo_nome?: string | null
          omie_categoria_codigo?: string | null
          omie_categoria_descricao?: string | null
          omie_cod_titulo?: string | null
          omie_match_confianca?: string | null
          omie_matched_em?: string | null
          origem?: string
          parcela?: string | null
          referencia: string
          status_escopo?: string | null
          status_nf: string
          time?: string | null
          updated_at?: string
          valor?: number
        }
        Update: {
          arquivo_comprovante?: string | null
          card_final?: string | null
          categoria?: string | null
          categoria_auditoria?: string | null
          competencia?: string
          created_at?: string
          data?: string | null
          descricao_original?: string | null
          estabelecimento?: string | null
          gestor?: string | null
          id?: number
          id_unico?: string
          justificativa_lider?: string | null
          justificativa_lider_em?: string | null
          link_comprovante?: string | null
          observacao?: string | null
          omie_anexo_enviado_em?: string | null
          omie_anexo_nome?: string | null
          omie_categoria_codigo?: string | null
          omie_categoria_descricao?: string | null
          omie_cod_titulo?: string | null
          omie_match_confianca?: string | null
          omie_matched_em?: string | null
          origem?: string
          parcela?: string | null
          referencia?: string
          status_escopo?: string | null
          status_nf?: string
          time?: string | null
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      auditoria_pix_lancamentos: {
        Row: {
          anexo_nome: string | null
          anexo_verificado: boolean
          categoria: string | null
          categoria_codigo: string | null
          cnpj_cpf: string | null
          cod_cliente: string | null
          comprovante_url: string | null
          conta_corrente: string | null
          created_at: string
          data: string | null
          descricao: string | null
          favorecido: string | null
          gerado_em: string
          id: number
          id_unico: string
          observacao: string | null
          omie_anexo_enviado_em: string | null
          omie_anexo_nome: string | null
          referencia: string
          status: string
          tem_comprovante: boolean
          updated_at: string
          valor: number
        }
        Insert: {
          anexo_nome?: string | null
          anexo_verificado?: boolean
          categoria?: string | null
          categoria_codigo?: string | null
          cnpj_cpf?: string | null
          cod_cliente?: string | null
          comprovante_url?: string | null
          conta_corrente?: string | null
          created_at?: string
          data?: string | null
          descricao?: string | null
          favorecido?: string | null
          gerado_em?: string
          id?: never
          id_unico: string
          observacao?: string | null
          omie_anexo_enviado_em?: string | null
          omie_anexo_nome?: string | null
          referencia: string
          status?: string
          tem_comprovante?: boolean
          updated_at?: string
          valor?: number
        }
        Update: {
          anexo_nome?: string | null
          anexo_verificado?: boolean
          categoria?: string | null
          categoria_codigo?: string | null
          cnpj_cpf?: string | null
          cod_cliente?: string | null
          comprovante_url?: string | null
          conta_corrente?: string | null
          created_at?: string
          data?: string | null
          descricao?: string | null
          favorecido?: string | null
          gerado_em?: string
          id?: never
          id_unico?: string
          observacao?: string | null
          omie_anexo_enviado_em?: string | null
          omie_anexo_nome?: string | null
          referencia?: string
          status?: string
          tem_comprovante?: boolean
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      automacao_comando_antigo: {
        Row: {
          comando: string
          jobname: string
          salvo_em: string
          schedule: string | null
        }
        Insert: {
          comando: string
          jobname: string
          salvo_em?: string
          schedule?: string | null
        }
        Update: {
          comando?: string
          jobname?: string
          salvo_em?: string
          schedule?: string | null
        }
        Relationships: []
      }
      automacao_diagnostico: {
        Row: {
          amostra: string | null
          assinatura: string
          causa: string | null
          gravidade: string | null
          id: number
          jobname: string
          modelo: string | null
          o_que_fazer: string | null
          ocorrencias: number
          primeira_em: string
          resolvido_em: string | null
          resumo: string
          ultima_em: string
        }
        Insert: {
          amostra?: string | null
          assinatura: string
          causa?: string | null
          gravidade?: string | null
          id?: number
          jobname: string
          modelo?: string | null
          o_que_fazer?: string | null
          ocorrencias?: number
          primeira_em?: string
          resolvido_em?: string | null
          resumo: string
          ultima_em?: string
        }
        Update: {
          amostra?: string | null
          assinatura?: string
          causa?: string | null
          gravidade?: string | null
          id?: number
          jobname?: string
          modelo?: string | null
          o_que_fazer?: string | null
          ocorrencias?: number
          primeira_em?: string
          resolvido_em?: string | null
          resumo?: string
          ultima_em?: string
        }
        Relationships: []
      }
      automacao_execucao: {
        Row: {
          colhido_em: string | null
          disparado_em: string
          id: number
          jobname: string
          request_id: number | null
          resposta: string | null
          status_code: number | null
        }
        Insert: {
          colhido_em?: string | null
          disparado_em?: string
          id?: number
          jobname: string
          request_id?: number | null
          resposta?: string | null
          status_code?: number | null
        }
        Update: {
          colhido_em?: string | null
          disparado_em?: string
          id?: number
          jobname?: string
          request_id?: number | null
          resposta?: string | null
          status_code?: number | null
        }
        Relationships: []
      }
      automacoes_catalogo: {
        Row: {
          automacao: string
          categoria: string | null
          created_at: string
          depende_de: string | null
          dor: string | null
          esforco: string | null
          esteira_ordem: number | null
          esteira_upgrade: boolean
          execucoes: number
          ferramentas: string | null
          horas_mes: number | null
          icone: string | null
          id: string
          impacto: string | null
          nivel: number | null
          observacao: string | null
          ordem: number
          pos_x: number | null
          pos_y: number | null
          responsavel: string | null
          solucao: string | null
          status: string
          tarefa_id: string | null
          ultima_falha: string | null
          updated_at: string
          upgrade: string | null
        }
        Insert: {
          automacao: string
          categoria?: string | null
          created_at?: string
          depende_de?: string | null
          dor?: string | null
          esforco?: string | null
          esteira_ordem?: number | null
          esteira_upgrade?: boolean
          execucoes?: number
          ferramentas?: string | null
          horas_mes?: number | null
          icone?: string | null
          id?: string
          impacto?: string | null
          nivel?: number | null
          observacao?: string | null
          ordem?: number
          pos_x?: number | null
          pos_y?: number | null
          responsavel?: string | null
          solucao?: string | null
          status?: string
          tarefa_id?: string | null
          ultima_falha?: string | null
          updated_at?: string
          upgrade?: string | null
        }
        Update: {
          automacao?: string
          categoria?: string | null
          created_at?: string
          depende_de?: string | null
          dor?: string | null
          esforco?: string | null
          esteira_ordem?: number | null
          esteira_upgrade?: boolean
          execucoes?: number
          ferramentas?: string | null
          horas_mes?: number | null
          icone?: string | null
          id?: string
          impacto?: string | null
          nivel?: number | null
          observacao?: string | null
          ordem?: number
          pos_x?: number | null
          pos_y?: number | null
          responsavel?: string | null
          solucao?: string | null
          status?: string
          tarefa_id?: string | null
          ultima_falha?: string | null
          updated_at?: string
          upgrade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automacoes_catalogo_depende_de_fkey"
            columns: ["depende_de"]
            isOneToOne: false
            referencedRelation: "automacoes_catalogo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automacoes_catalogo_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automacoes_catalogo_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas_rotinas"
            referencedColumns: ["tarefa_modelo_id"]
          },
        ]
      }
      automacoes_niveis: {
        Row: {
          bullets: Json
          created_at: string
          descricao: string | null
          id: string
          n: number
          nome: string
          updated_at: string
        }
        Insert: {
          bullets?: Json
          created_at?: string
          descricao?: string | null
          id?: string
          n: number
          nome: string
          updated_at?: string
        }
        Update: {
          bullets?: Json
          created_at?: string
          descricao?: string | null
          id?: string
          n?: number
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      aviso_dispensado: {
        Row: {
          assinatura: string
          chave: string
          dispensado_em: string
          fonte: string
          user_id: string
        }
        Insert: {
          assinatura: string
          chave: string
          dispensado_em?: string
          fonte: string
          user_id: string
        }
        Update: {
          assinatura?: string
          chave?: string
          dispensado_em?: string
          fonte?: string
          user_id?: string
        }
        Relationships: []
      }
      base_conhecimento: {
        Row: {
          conteudo: string
          created_at: string
          id: string
          tipo: string
          titulo: string
          updated_at: string
        }
        Insert: {
          conteudo: string
          created_at?: string
          id?: string
          tipo?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          conteudo?: string
          created_at?: string
          id?: string
          tipo?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      bp_anual: {
        Row: {
          abas: Json
          ano: number
          created_at: string
          dados: Json
          id: string
          observacao: string | null
          updated_at: string
        }
        Insert: {
          abas?: Json
          ano: number
          created_at?: string
          dados?: Json
          id?: string
          observacao?: string | null
          updated_at?: string
        }
        Update: {
          abas?: Json
          ano?: number
          created_at?: string
          dados?: Json
          id?: string
          observacao?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      briefing_diario: {
        Row: {
          agenda: Json | null
          conteudo_markdown: string
          emails: Json | null
          gerado_em: string
          id: string
          noticias: Json | null
          periodo_fim: string
          periodo_inicio: string
        }
        Insert: {
          agenda?: Json | null
          conteudo_markdown: string
          emails?: Json | null
          gerado_em?: string
          id?: string
          noticias?: Json | null
          periodo_fim: string
          periodo_inicio: string
        }
        Update: {
          agenda?: Json | null
          conteudo_markdown?: string
          emails?: Json | null
          gerado_em?: string
          id?: string
          noticias?: Json | null
          periodo_fim?: string
          periodo_inicio?: string
        }
        Relationships: []
      }
      briefing_noticias: {
        Row: {
          aprendido_em: string | null
          chave: string
          colhido_em: string
          detalhe: Json
          fonte: string | null
          id: number
          lido_em: string | null
          lido_por: string | null
          motivos: string[]
          muda_algo: boolean | null
          pauta: string
          por_que_importa: string | null
          publicado_em: string | null
          relevancia: number
          repete: boolean | null
          resumo: string | null
          titulo: string
          url: string
          voto: number | null
          voto_em: string | null
          voto_por: string | null
        }
        Insert: {
          aprendido_em?: string | null
          chave: string
          colhido_em?: string
          detalhe?: Json
          fonte?: string | null
          id?: number
          lido_em?: string | null
          lido_por?: string | null
          motivos?: string[]
          muda_algo?: boolean | null
          pauta: string
          por_que_importa?: string | null
          publicado_em?: string | null
          relevancia?: number
          repete?: boolean | null
          resumo?: string | null
          titulo: string
          url: string
          voto?: number | null
          voto_em?: string | null
          voto_por?: string | null
        }
        Update: {
          aprendido_em?: string | null
          chave?: string
          colhido_em?: string
          detalhe?: Json
          fonte?: string | null
          id?: number
          lido_em?: string | null
          lido_por?: string | null
          motivos?: string[]
          muda_algo?: boolean | null
          pauta?: string
          por_que_importa?: string | null
          publicado_em?: string | null
          relevancia?: number
          repete?: boolean | null
          resumo?: string | null
          titulo?: string
          url?: string
          voto?: number | null
          voto_em?: string | null
          voto_por?: string | null
        }
        Relationships: []
      }
      briefing_noticias_preferencias: {
        Row: {
          assunto: string
          ativo: boolean
          atualizado_em: string
          criado_em: string
          criado_por: string | null
          exemplos: string[]
          id: number
          pauta: string | null
          peso: number
          rotulo: string
          termos: string[]
          votos: number
        }
        Insert: {
          assunto: string
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          exemplos?: string[]
          id?: number
          pauta?: string | null
          peso?: number
          rotulo: string
          termos?: string[]
          votos?: number
        }
        Update: {
          assunto?: string
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          exemplos?: string[]
          id?: number
          pauta?: string | null
          peso?: number
          rotulo?: string
          termos?: string[]
          votos?: number
        }
        Relationships: []
      }
      cac_linhas: {
        Row: {
          ativo: boolean
          atualizado_em: string
          categorias: string[]
          criado_em: string
          departamentos: string[]
          grupo: string
          id: string
          ordem: number
          regra_nota: string | null
          rotulo: string
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          categorias?: string[]
          criado_em?: string
          departamentos?: string[]
          grupo: string
          id?: string
          ordem: number
          regra_nota?: string | null
          rotulo: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          categorias?: string[]
          criado_em?: string
          departamentos?: string[]
          grupo?: string
          id?: string
          ordem?: number
          regra_nota?: string | null
          rotulo?: string
        }
        Relationships: []
      }
      cac_pessoas: {
        Row: {
          ativo: boolean
          atualizado_em: string
          categoria_omie: string | null
          cnpj: string
          criado_em: string
          departamento: string
          id: string
          nome: string
          observacao: string | null
          planilha_comissao: string | null
          remuneracao: number | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          categoria_omie?: string | null
          cnpj: string
          criado_em?: string
          departamento: string
          id?: string
          nome: string
          observacao?: string | null
          planilha_comissao?: string | null
          remuneracao?: number | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          categoria_omie?: string | null
          cnpj?: string
          criado_em?: string
          departamento?: string
          id?: string
          nome?: string
          observacao?: string | null
          planilha_comissao?: string | null
          remuneracao?: number | null
        }
        Relationships: []
      }
      cac_valores_manuais: {
        Row: {
          ano: number
          atualizado_em: string
          autor: string | null
          autor_nome: string | null
          criado_em: string
          linha_id: string
          mes: number
          nota: string | null
          valor: number
        }
        Insert: {
          ano: number
          atualizado_em?: string
          autor?: string | null
          autor_nome?: string | null
          criado_em?: string
          linha_id: string
          mes: number
          nota?: string | null
          valor: number
        }
        Update: {
          ano?: number
          atualizado_em?: string
          autor?: string | null
          autor_nome?: string | null
          criado_em?: string
          linha_id?: string
          mes?: number
          nota?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "cac_valores_manuais_linha_id_fkey"
            columns: ["linha_id"]
            isOneToOne: false
            referencedRelation: "cac_linhas"
            referencedColumns: ["id"]
          },
        ]
      }
      cadastro_autorizado: {
        Row: {
          autorizado_em: string
          autorizado_por: string | null
          email: string
          usado_em: string | null
        }
        Insert: {
          autorizado_em?: string
          autorizado_por?: string | null
          email: string
          usado_em?: string | null
        }
        Update: {
          autorizado_em?: string
          autorizado_por?: string | null
          email?: string
          usado_em?: string | null
        }
        Relationships: []
      }
      calendario_financeiro: {
        Row: {
          agente_dono: string | null
          antecedencia_dias: number
          ativo: boolean
          atualizado_em: string
          automacao_id: string | null
          criado_em: string
          descricao: string | null
          dia: number | null
          evento: string
          id: string
          regra_data: string
          responsavel_id: string | null
        }
        Insert: {
          agente_dono?: string | null
          antecedencia_dias?: number
          ativo?: boolean
          atualizado_em?: string
          automacao_id?: string | null
          criado_em?: string
          descricao?: string | null
          dia?: number | null
          evento: string
          id?: string
          regra_data: string
          responsavel_id?: string | null
        }
        Update: {
          agente_dono?: string | null
          antecedencia_dias?: number
          ativo?: boolean
          atualizado_em?: string
          automacao_id?: string | null
          criado_em?: string
          descricao?: string | null
          dia?: number | null
          evento?: string
          id?: string
          regra_data?: string
          responsavel_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendario_financeiro_automacao_id_fkey"
            columns: ["automacao_id"]
            isOneToOne: false
            referencedRelation: "automacoes_catalogo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendario_financeiro_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      cambio_dia: {
        Row: {
          data: string
          fonte: string
          lido_em: string
          moeda: string
          venda: number
        }
        Insert: {
          data: string
          fonte?: string
          lido_em?: string
          moeda: string
          venda: number
        }
        Update: {
          data?: string
          fonte?: string
          lido_em?: string
          moeda?: string
          venda?: number
        }
        Relationships: []
      }
      cap_notas_config: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          id: number
          limiar_grave: number
          limiar_medio: number
          limiar_urgente: number
          releitura_dias: number
          releitura_max_dias: number
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          id?: number
          limiar_grave?: number
          limiar_medio?: number
          limiar_urgente?: number
          releitura_dias?: number
          releitura_max_dias?: number
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          id?: number
          limiar_grave?: number
          limiar_medio?: number
          limiar_urgente?: number
          releitura_dias?: number
          releitura_max_dias?: number
        }
        Relationships: []
      }
      cap_notas_diagnostico_texto: {
        Row: {
          ate: string | null
          de: string | null
          gerado_em: string
          gerado_por: string | null
          id: number
          modelo: string | null
          planos: Json
          resumo: string
          sinal: Json
        }
        Insert: {
          ate?: string | null
          de?: string | null
          gerado_em?: string
          gerado_por?: string | null
          id?: number
          modelo?: string | null
          planos?: Json
          resumo: string
          sinal: Json
        }
        Update: {
          ate?: string | null
          de?: string | null
          gerado_em?: string
          gerado_por?: string | null
          id?: number
          modelo?: string | null
          planos?: Json
          resumo?: string
          sinal?: Json
        }
        Relationships: []
      }
      cartao_contestacoes: {
        Row: {
          card_final: string
          criado_em: string
          id: string
          id_unico: string
          motivo: string
          resolvido_em: string | null
          resolvido_por: string | null
          responsavel: string | null
          resposta: string | null
          status: string
          texto: string | null
        }
        Insert: {
          card_final: string
          criado_em?: string
          id?: string
          id_unico: string
          motivo: string
          resolvido_em?: string | null
          resolvido_por?: string | null
          responsavel?: string | null
          resposta?: string | null
          status?: string
          texto?: string | null
        }
        Update: {
          card_final?: string
          criado_em?: string
          id?: string
          id_unico?: string
          motivo?: string
          resolvido_em?: string | null
          resolvido_por?: string | null
          responsavel?: string | null
          resposta?: string | null
          status?: string
          texto?: string | null
        }
        Relationships: []
      }
      cartao_envios_omie: {
        Row: {
          chave: string | null
          cod_titulo: string | null
          codigo_categoria: string | null
          competencia: string
          competencia_fatura: string
          enviado_em: string
          enviado_por: string | null
          erro: string | null
          estabelecimento: string | null
          fitid: string
          integracao: string
          parcela_de: number | null
          parcela_n: number | null
          status: string
          valor: number
          vencimento: string | null
        }
        Insert: {
          chave?: string | null
          cod_titulo?: string | null
          codigo_categoria?: string | null
          competencia: string
          competencia_fatura: string
          enviado_em?: string
          enviado_por?: string | null
          erro?: string | null
          estabelecimento?: string | null
          fitid: string
          integracao: string
          parcela_de?: number | null
          parcela_n?: number | null
          status?: string
          valor: number
          vencimento?: string | null
        }
        Update: {
          chave?: string | null
          cod_titulo?: string | null
          codigo_categoria?: string | null
          competencia?: string
          competencia_fatura?: string
          enviado_em?: string
          enviado_por?: string | null
          erro?: string | null
          estabelecimento?: string | null
          fitid?: string
          integracao?: string
          parcela_de?: number | null
          parcela_n?: number | null
          status?: string
          valor?: number
          vencimento?: string | null
        }
        Relationships: []
      }
      cartao_faturas: {
        Row: {
          arquivo: string | null
          competencia: string
          fechamento: string | null
          importado_em: string
          importado_por: string | null
          mes_label: string
          provisionamento: string
        }
        Insert: {
          arquivo?: string | null
          competencia: string
          fechamento?: string | null
          importado_em?: string
          importado_por?: string | null
          mes_label: string
          provisionamento?: string
        }
        Update: {
          arquivo?: string | null
          competencia?: string
          fechamento?: string | null
          importado_em?: string
          importado_por?: string | null
          mes_label?: string
          provisionamento?: string
        }
        Relationships: []
      }
      cartao_lancamentos: {
        Row: {
          categoria: string
          cidade: string | null
          competencia: string
          data: string | null
          descricao: string | null
          estabelecimento: string
          fitid: string | null
          id: string
          parcela: string | null
          tipo: string
          valor: number
        }
        Insert: {
          categoria: string
          cidade?: string | null
          competencia: string
          data?: string | null
          descricao?: string | null
          estabelecimento: string
          fitid?: string | null
          id?: string
          parcela?: string | null
          tipo?: string
          valor: number
        }
        Update: {
          categoria?: string
          cidade?: string | null
          competencia?: string
          data?: string | null
          descricao?: string | null
          estabelecimento?: string
          fitid?: string | null
          id?: string
          parcela?: string | null
          tipo?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "cartao_lancamentos_competencia_fkey"
            columns: ["competencia"]
            isOneToOne: false
            referencedRelation: "cartao_faturas"
            referencedColumns: ["competencia"]
          },
        ]
      }
      cartao_marcacoes: {
        Row: {
          estabelecimento: string
          marcado_em: string
          marcado_por: string | null
          nota: string | null
        }
        Insert: {
          estabelecimento: string
          marcado_em?: string
          marcado_por?: string | null
          nota?: string | null
        }
        Update: {
          estabelecimento?: string
          marcado_em?: string
          marcado_por?: string | null
          nota?: string | null
        }
        Relationships: []
      }
      cartao_omie_map: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          codigo_categoria: string
          descricao_categoria: string | null
          examinados: number
          exemplos: string[]
          origem: string
          votos: number
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          codigo_categoria: string
          descricao_categoria?: string | null
          examinados?: number
          exemplos?: string[]
          origem?: string
          votos?: number
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          codigo_categoria?: string
          descricao_categoria?: string | null
          examinados?: number
          exemplos?: string[]
          origem?: string
          votos?: number
        }
        Relationships: []
      }
      cartao_portadores: {
        Row: {
          acesso_ate: string | null
          atualizado_em: string
          card_final: string
          criado_em: string
          encerrado_em: string | null
          encerrado_por: string | null
          id: string
          motivo: string | null
          nome: string
          status: string
          time: string | null
        }
        Insert: {
          acesso_ate?: string | null
          atualizado_em?: string
          card_final: string
          criado_em?: string
          encerrado_em?: string | null
          encerrado_por?: string | null
          id?: string
          motivo?: string | null
          nome: string
          status?: string
          time?: string | null
        }
        Update: {
          acesso_ate?: string | null
          atualizado_em?: string
          card_final?: string
          criado_em?: string
          encerrado_em?: string | null
          encerrado_por?: string | null
          id?: string
          motivo?: string | null
          nome?: string
          status?: string
          time?: string | null
        }
        Relationships: []
      }
      cartao_recomendacoes: {
        Row: {
          acao: string | null
          atualizado_em: string
          com_quem: string | null
          competencia: string
          confianca: string | null
          editado_em: string | null
          editado_por: string | null
          estabelecimento: string
          fatos: Json
          gerado_em: string
          id: string
          lancamentos: number | null
          modelo: string | null
          nivel: string
          razao: number | null
          serie: Json
          sinal: string
          status: string
          tarefa_id: string | null
          texto: string
          texto_editado: string | null
          titulo: string
          valor: number | null
          valor_referencia: number | null
        }
        Insert: {
          acao?: string | null
          atualizado_em?: string
          com_quem?: string | null
          competencia: string
          confianca?: string | null
          editado_em?: string | null
          editado_por?: string | null
          estabelecimento: string
          fatos?: Json
          gerado_em?: string
          id?: string
          lancamentos?: number | null
          modelo?: string | null
          nivel?: string
          razao?: number | null
          serie?: Json
          sinal: string
          status?: string
          tarefa_id?: string | null
          texto: string
          texto_editado?: string | null
          titulo: string
          valor?: number | null
          valor_referencia?: number | null
        }
        Update: {
          acao?: string | null
          atualizado_em?: string
          com_quem?: string | null
          competencia?: string
          confianca?: string | null
          editado_em?: string | null
          editado_por?: string | null
          estabelecimento?: string
          fatos?: Json
          gerado_em?: string
          id?: string
          lancamentos?: number | null
          modelo?: string | null
          nivel?: string
          razao?: number | null
          serie?: Json
          sinal?: string
          status?: string
          tarefa_id?: string | null
          texto?: string
          texto_editado?: string | null
          titulo?: string
          valor?: number | null
          valor_referencia?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cartao_recomendacoes_competencia_fkey"
            columns: ["competencia"]
            isOneToOne: false
            referencedRelation: "cartao_faturas"
            referencedColumns: ["competencia"]
          },
          {
            foreignKeyName: "cartao_recomendacoes_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cartao_recomendacoes_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas_rotinas"
            referencedColumns: ["tarefa_modelo_id"]
          },
        ]
      }
      cenarios: {
        Row: {
          analise: string | null
          created_at: string
          descricao: string | null
          graficos: Json | null
          id: string
          meses_projecao: number
          nome: string
          periodo_base: string | null
          premissas: Json
          projecao: Json | null
          sensibilidade: Json | null
          updated_at: string
        }
        Insert: {
          analise?: string | null
          created_at?: string
          descricao?: string | null
          graficos?: Json | null
          id?: string
          meses_projecao?: number
          nome: string
          periodo_base?: string | null
          premissas?: Json
          projecao?: Json | null
          sensibilidade?: Json | null
          updated_at?: string
        }
        Update: {
          analise?: string | null
          created_at?: string
          descricao?: string | null
          graficos?: Json | null
          id?: string
          meses_projecao?: number
          nome?: string
          periodo_base?: string | null
          premissas?: Json
          projecao?: Json | null
          sensibilidade?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      churn_sinais: {
        Row: {
          cliente_nome: string | null
          cliente_ref: string
          conferido_em: string | null
          conferido_por: string | null
          desfecho: string | null
          dias_atraso: number | null
          documento: string | null
          evidencia: Json
          id: number
          procurado_em: string
          resumo: string | null
          sinal: string
          valor_aberto: number | null
        }
        Insert: {
          cliente_nome?: string | null
          cliente_ref: string
          conferido_em?: string | null
          conferido_por?: string | null
          desfecho?: string | null
          dias_atraso?: number | null
          documento?: string | null
          evidencia?: Json
          id?: number
          procurado_em?: string
          resumo?: string | null
          sinal?: string
          valor_aberto?: number | null
        }
        Update: {
          cliente_nome?: string | null
          cliente_ref?: string
          conferido_em?: string | null
          conferido_por?: string | null
          desfecho?: string | null
          dias_atraso?: number | null
          documento?: string | null
          evidencia?: Json
          id?: number
          procurado_em?: string
          resumo?: string | null
          sinal?: string
          valor_aberto?: number | null
        }
        Relationships: []
      }
      churn_snapshot: {
        Row: {
          competencia: string
          dados: Json
          gerado_em: string
          mes_label: string
          sincronizado_em: string | null
        }
        Insert: {
          competencia: string
          dados: Json
          gerado_em?: string
          mes_label: string
          sincronizado_em?: string | null
        }
        Update: {
          competencia?: string
          dados?: Json
          gerado_em?: string
          mes_label?: string
          sincronizado_em?: string | null
        }
        Relationships: []
      }
      cnpj_publico_cache: {
        Row: {
          dados: Json
          doc: string
          fonte: string | null
          lido_em: string
        }
        Insert: {
          dados: Json
          doc: string
          fonte?: string | null
          lido_em?: string
        }
        Update: {
          dados?: Json
          doc?: string
          fonte?: string | null
          lido_em?: string
        }
        Relationships: []
      }
      comprovantes_drive: {
        Row: {
          atualizado_em: string
          candidatos: Json | null
          cartao_data: string | null
          cartao_descricao: string | null
          cartao_estabelecimento: string | null
          cartao_valor: number | null
          casado_em: string | null
          casamento: string | null
          chave_fiscal: string | null
          cnpj_norm: string | null
          cod_titulo: string | null
          confianca: string | null
          criado_em: string
          data: string | null
          descricao: string | null
          drive_id: string
          drive_modificado_em: string | null
          emitente: string | null
          erro: string | null
          id: string
          itens: Json | null
          lido_como: string | null
          lido_em: string | null
          mes: string | null
          mime: string | null
          nome_arquivo: string
          notas: number | null
          omie_anexo_enviado_em: string | null
          omie_anexo_nome: string | null
          pasta: string
          tipo_documento: string | null
          valor: number | null
        }
        Insert: {
          atualizado_em?: string
          candidatos?: Json | null
          cartao_data?: string | null
          cartao_descricao?: string | null
          cartao_estabelecimento?: string | null
          cartao_valor?: number | null
          casado_em?: string | null
          casamento?: string | null
          chave_fiscal?: string | null
          cnpj_norm?: string | null
          cod_titulo?: string | null
          confianca?: string | null
          criado_em?: string
          data?: string | null
          descricao?: string | null
          drive_id: string
          drive_modificado_em?: string | null
          emitente?: string | null
          erro?: string | null
          id?: string
          itens?: Json | null
          lido_como?: string | null
          lido_em?: string | null
          mes?: string | null
          mime?: string | null
          nome_arquivo: string
          notas?: number | null
          omie_anexo_enviado_em?: string | null
          omie_anexo_nome?: string | null
          pasta: string
          tipo_documento?: string | null
          valor?: number | null
        }
        Update: {
          atualizado_em?: string
          candidatos?: Json | null
          cartao_data?: string | null
          cartao_descricao?: string | null
          cartao_estabelecimento?: string | null
          cartao_valor?: number | null
          casado_em?: string | null
          casamento?: string | null
          chave_fiscal?: string | null
          cnpj_norm?: string | null
          cod_titulo?: string | null
          confianca?: string | null
          criado_em?: string
          data?: string | null
          descricao?: string | null
          drive_id?: string
          drive_modificado_em?: string | null
          emitente?: string | null
          erro?: string | null
          id?: string
          itens?: Json | null
          lido_como?: string | null
          lido_em?: string | null
          mes?: string | null
          mime?: string | null
          nome_arquivo?: string
          notas?: number | null
          omie_anexo_enviado_em?: string | null
          omie_anexo_nome?: string | null
          pasta?: string
          tipo_documento?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      comprovantes_index: {
        Row: {
          chave_nfe: string | null
          cnpj_emitente: string | null
          cod_titulo: number | null
          confianca_match: number | null
          created_time: string | null
          data_doc: string | null
          file_id: string
          fonte: string
          fornecedor_id: string | null
          hash_conteudo: string | null
          lancamento_id: string | null
          metodo_match: string | null
          referencia_casada: string | null
          status: string
          texto_ocr: string | null
          tipo: string | null
          titulo: string | null
          ts_index: string
          ts_update: string
          valor: number | null
        }
        Insert: {
          chave_nfe?: string | null
          cnpj_emitente?: string | null
          cod_titulo?: number | null
          confianca_match?: number | null
          created_time?: string | null
          data_doc?: string | null
          file_id: string
          fonte: string
          fornecedor_id?: string | null
          hash_conteudo?: string | null
          lancamento_id?: string | null
          metodo_match?: string | null
          referencia_casada?: string | null
          status?: string
          texto_ocr?: string | null
          tipo?: string | null
          titulo?: string | null
          ts_index?: string
          ts_update?: string
          valor?: number | null
        }
        Update: {
          chave_nfe?: string | null
          cnpj_emitente?: string | null
          cod_titulo?: number | null
          confianca_match?: number | null
          created_time?: string | null
          data_doc?: string | null
          file_id?: string
          fonte?: string
          fornecedor_id?: string | null
          hash_conteudo?: string | null
          lancamento_id?: string | null
          metodo_match?: string | null
          referencia_casada?: string | null
          status?: string
          texto_ocr?: string | null
          tipo?: string | null
          titulo?: string | null
          ts_index?: string
          ts_update?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "comprovantes_index_cod_titulo_fkey"
            columns: ["cod_titulo"]
            isOneToOne: false
            referencedRelation: "omie_titulos"
            referencedColumns: ["cod_titulo"]
          },
          {
            foreignKeyName: "comprovantes_index_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "lib_fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      conciliacao: {
        Row: {
          alcada: string
          atualizado_em: string
          cod_titulo: number | null
          comprovante_file_id: string | null
          conciliado_em: string | null
          conciliado_por: string
          confianca: number
          criado_em: string
          data_movimento: string | null
          divergencia_valor: number | null
          extrato_id: string
          id: string
          metodo: string
          observacao: string | null
          origem: string
          revisado_em: string | null
          revisado_por: string | null
          status: string
          valor_extrato: number | null
          valor_titulo: number | null
        }
        Insert: {
          alcada?: string
          atualizado_em?: string
          cod_titulo?: number | null
          comprovante_file_id?: string | null
          conciliado_em?: string | null
          conciliado_por?: string
          confianca?: number
          criado_em?: string
          data_movimento?: string | null
          divergencia_valor?: number | null
          extrato_id: string
          id?: string
          metodo: string
          observacao?: string | null
          origem: string
          revisado_em?: string | null
          revisado_por?: string | null
          status?: string
          valor_extrato?: number | null
          valor_titulo?: number | null
        }
        Update: {
          alcada?: string
          atualizado_em?: string
          cod_titulo?: number | null
          comprovante_file_id?: string | null
          conciliado_em?: string | null
          conciliado_por?: string
          confianca?: number
          criado_em?: string
          data_movimento?: string | null
          divergencia_valor?: number | null
          extrato_id?: string
          id?: string
          metodo?: string
          observacao?: string | null
          origem?: string
          revisado_em?: string | null
          revisado_por?: string | null
          status?: string
          valor_extrato?: number | null
          valor_titulo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conciliacao_cod_titulo_fkey"
            columns: ["cod_titulo"]
            isOneToOne: false
            referencedRelation: "omie_titulos"
            referencedColumns: ["cod_titulo"]
          },
          {
            foreignKeyName: "conciliacao_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      contrapartes_alias: {
        Row: {
          alias: string
          alias_norm: string | null
          atualizado_em: string
          confianca: number
          criado_em: string
          documento_norm: string | null
          fonte: string
          fornecedor_id: string
          id: string
          origem: string
        }
        Insert: {
          alias: string
          alias_norm?: string | null
          atualizado_em?: string
          confianca?: number
          criado_em?: string
          documento_norm?: string | null
          fonte: string
          fornecedor_id: string
          id?: string
          origem?: string
        }
        Update: {
          alias?: string
          alias_norm?: string | null
          atualizado_em?: string
          confianca?: number
          criado_em?: string
          documento_norm?: string | null
          fonte?: string
          fornecedor_id?: string
          id?: string
          origem?: string
        }
        Relationships: [
          {
            foreignKeyName: "contrapartes_alias_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "lib_fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      de_para_rules: {
        Row: {
          categoria: string | null
          centro_custo: string | null
          cliente_fornecedor: string | null
          conta: string | null
          created_at: string
          id: string
          keyword: string
          observacao: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          categoria?: string | null
          centro_custo?: string | null
          cliente_fornecedor?: string | null
          conta?: string | null
          created_at?: string
          id?: string
          keyword: string
          observacao?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          categoria?: string | null
          centro_custo?: string | null
          cliente_fornecedor?: string | null
          conta?: string | null
          created_at?: string
          id?: string
          keyword?: string
          observacao?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      demonstracoes_apresentacao_modelos: {
        Row: {
          atualizado_em: string
          criado_em: string
          criado_por: string | null
          descricao: string | null
          id: string
          nome: string
          periodo_tipo: string
          roteiro: Json
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          nome: string
          periodo_tipo?: string
          roteiro?: Json
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          periodo_tipo?: string
          roteiro?: Json
        }
        Relationships: []
      }
      demonstracoes_apresentacoes: {
        Row: {
          atualizada_em: string
          congelado: Json | null
          criada_em: string
          criada_por: string | null
          id: string
          mes: string
          nome: string
          periodo_tipo: string
          publicada_em: string | null
          publicada_por: string | null
          roteiro: Json
          status: string
          textos: Json
        }
        Insert: {
          atualizada_em?: string
          congelado?: Json | null
          criada_em?: string
          criada_por?: string | null
          id?: string
          mes: string
          nome: string
          periodo_tipo?: string
          publicada_em?: string | null
          publicada_por?: string | null
          roteiro?: Json
          status?: string
          textos?: Json
        }
        Update: {
          atualizada_em?: string
          congelado?: Json | null
          criada_em?: string
          criada_por?: string | null
          id?: string
          mes?: string
          nome?: string
          periodo_tipo?: string
          publicada_em?: string | null
          publicada_por?: string | null
          roteiro?: Json
          status?: string
          textos?: Json
        }
        Relationships: []
      }
      demonstracoes_contabeis: {
        Row: {
          created_at: string
          dados: Json
          id: string
          observacao: string | null
          pdf_path: string | null
          periodo: string
          tipo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dados?: Json
          id?: string
          observacao?: string | null
          pdf_path?: string | null
          periodo: string
          tipo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dados?: Json
          id?: string
          observacao?: string | null
          pdf_path?: string | null
          periodo?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      demonstracoes_ebitda_ajuste: {
        Row: {
          atualizado_em: string
          autor: string | null
          autor_email: string | null
          cod_titulo: string | null
          cods: string[] | null
          col_key: string
          contraparte: string | null
          data: string | null
          decidido_em: string
          descricao: string
          grupo: string | null
          id: string
          motivo_sugestao: string | null
          origem: string
          regra: string | null
          rubrica: string | null
          status: string
          valor: number
          valor_lancamento: number | null
        }
        Insert: {
          atualizado_em?: string
          autor?: string | null
          autor_email?: string | null
          cod_titulo?: string | null
          cods?: string[] | null
          col_key: string
          contraparte?: string | null
          data?: string | null
          decidido_em?: string
          descricao: string
          grupo?: string | null
          id?: string
          motivo_sugestao?: string | null
          origem?: string
          regra?: string | null
          rubrica?: string | null
          status: string
          valor: number
          valor_lancamento?: number | null
        }
        Update: {
          atualizado_em?: string
          autor?: string | null
          autor_email?: string | null
          cod_titulo?: string | null
          cods?: string[] | null
          col_key?: string
          contraparte?: string | null
          data?: string | null
          decidido_em?: string
          descricao?: string
          grupo?: string | null
          id?: string
          motivo_sugestao?: string | null
          origem?: string
          regra?: string | null
          rubrica?: string | null
          status?: string
          valor?: number
          valor_lancamento?: number | null
        }
        Relationships: []
      }
      demonstracoes_justificativas: {
        Row: {
          atualizado_em: string
          cobertura: number | null
          confianca: string | null
          delta: number | null
          delta_pct: number | null
          despesa: boolean
          drivers: Json
          editado_em: string | null
          editado_por: string | null
          gerado_em: string
          id: string
          mes: string
          mes_anterior: string | null
          modelo: string | null
          origem: string
          pergunta_id: string | null
          rubrica: string
          sinais: Json
          status: string
          texto: string
          texto_editado: string | null
          tipo: string
          valor: number | null
          valor_anterior: number | null
        }
        Insert: {
          atualizado_em?: string
          cobertura?: number | null
          confianca?: string | null
          delta?: number | null
          delta_pct?: number | null
          despesa?: boolean
          drivers?: Json
          editado_em?: string | null
          editado_por?: string | null
          gerado_em?: string
          id?: string
          mes: string
          mes_anterior?: string | null
          modelo?: string | null
          origem?: string
          pergunta_id?: string | null
          rubrica: string
          sinais?: Json
          status?: string
          texto: string
          texto_editado?: string | null
          tipo: string
          valor?: number | null
          valor_anterior?: number | null
        }
        Update: {
          atualizado_em?: string
          cobertura?: number | null
          confianca?: string | null
          delta?: number | null
          delta_pct?: number | null
          despesa?: boolean
          drivers?: Json
          editado_em?: string | null
          editado_por?: string | null
          gerado_em?: string
          id?: string
          mes?: string
          mes_anterior?: string | null
          modelo?: string | null
          origem?: string
          pergunta_id?: string | null
          rubrica?: string
          sinais?: Json
          status?: string
          texto?: string
          texto_editado?: string | null
          tipo?: string
          valor?: number | null
          valor_anterior?: number | null
        }
        Relationships: []
      }
      demonstracoes_lancamento_nota: {
        Row: {
          atualizado_em: string
          autor: string | null
          autor_nome: string | null
          cod_titulo: string
          contraparte: string | null
          criado_em: string
          id: string
          origem_mes: string | null
          origem_rubrica: string | null
          origem_tipo: string | null
          texto: string
        }
        Insert: {
          atualizado_em?: string
          autor?: string | null
          autor_nome?: string | null
          cod_titulo: string
          contraparte?: string | null
          criado_em?: string
          id?: string
          origem_mes?: string | null
          origem_rubrica?: string | null
          origem_tipo?: string | null
          texto: string
        }
        Update: {
          atualizado_em?: string
          autor?: string | null
          autor_nome?: string | null
          cod_titulo?: string
          contraparte?: string | null
          criado_em?: string
          id?: string
          origem_mes?: string | null
          origem_rubrica?: string | null
          origem_tipo?: string | null
          texto?: string
        }
        Relationships: []
      }
      demonstracoes_mes_trancado: {
        Row: {
          col_key: string
          origem: string | null
          trancado_em: string
        }
        Insert: {
          col_key: string
          origem?: string | null
          trancado_em?: string
        }
        Update: {
          col_key?: string
          origem?: string | null
          trancado_em?: string
        }
        Relationships: []
      }
      demonstracoes_perguntas: {
        Row: {
          autor_email: string | null
          autor_id: string | null
          confianca: string | null
          criado_em: string
          dados: Json
          drivers: Json
          id: string
          mes: string
          mes_anterior: string | null
          modelo: string | null
          pergunta: string
          resposta: string
          rubrica: string
          tipo: string
          travado: boolean
          valor: number | null
          valor_anterior: number | null
        }
        Insert: {
          autor_email?: string | null
          autor_id?: string | null
          confianca?: string | null
          criado_em?: string
          dados?: Json
          drivers?: Json
          id?: string
          mes: string
          mes_anterior?: string | null
          modelo?: string | null
          pergunta: string
          resposta: string
          rubrica: string
          tipo: string
          travado?: boolean
          valor?: number | null
          valor_anterior?: number | null
        }
        Update: {
          autor_email?: string | null
          autor_id?: string | null
          confianca?: string | null
          criado_em?: string
          dados?: Json
          drivers?: Json
          id?: string
          mes?: string
          mes_anterior?: string | null
          modelo?: string | null
          pergunta?: string
          resposta?: string
          rubrica?: string
          tipo?: string
          travado?: boolean
          valor?: number | null
          valor_anterior?: number | null
        }
        Relationships: []
      }
      demonstracoes_revisao: {
        Row: {
          atualizado_em: string
          decisoes: Json
          destaques: Json
          detalhe: string
          editado: Json | null
          editado_em: string | null
          editado_por: string | null
          fecho: string | null
          gerado_em: string
          id: string
          mes: string
          modelo: string | null
          rubricas: Json
          sinal: Json
          status: string
          veredicto_nivel: string | null
          veredicto_resumo: string | null
          veredicto_titulo: string | null
        }
        Insert: {
          atualizado_em?: string
          decisoes?: Json
          destaques?: Json
          detalhe?: string
          editado?: Json | null
          editado_em?: string | null
          editado_por?: string | null
          fecho?: string | null
          gerado_em?: string
          id?: string
          mes: string
          modelo?: string | null
          rubricas?: Json
          sinal?: Json
          status?: string
          veredicto_nivel?: string | null
          veredicto_resumo?: string | null
          veredicto_titulo?: string | null
        }
        Update: {
          atualizado_em?: string
          decisoes?: Json
          destaques?: Json
          detalhe?: string
          editado?: Json | null
          editado_em?: string | null
          editado_por?: string | null
          fecho?: string | null
          gerado_em?: string
          id?: string
          mes?: string
          modelo?: string | null
          rubricas?: Json
          sinal?: Json
          status?: string
          veredicto_nivel?: string | null
          veredicto_resumo?: string | null
          veredicto_titulo?: string | null
        }
        Relationships: []
      }
      demonstracoes_valor_manual: {
        Row: {
          atualizado_em: string
          autor: string | null
          autor_email: string | null
          col_key: string
          criado_em: string
          id: string
          modo: string
          rubrica: string
          tipo: string
          valor: number
          valor_aplicado: number | null
          valor_base: number | null
        }
        Insert: {
          atualizado_em?: string
          autor?: string | null
          autor_email?: string | null
          col_key: string
          criado_em?: string
          id?: string
          modo?: string
          rubrica: string
          tipo: string
          valor: number
          valor_aplicado?: number | null
          valor_base?: number | null
        }
        Update: {
          atualizado_em?: string
          autor?: string | null
          autor_email?: string | null
          col_key?: string
          criado_em?: string
          id?: string
          modo?: string
          rubrica?: string
          tipo?: string
          valor?: number
          valor_aplicado?: number | null
          valor_base?: number | null
        }
        Relationships: []
      }
      editais: {
        Row: {
          categoria: string | null
          confidence_score: number
          created_at: string
          criterios_elegibilidade: string | null
          data_abertura: string | null
          data_captura: string
          data_publicacao: string | null
          documentos: Json | null
          exclusion_reason: string | null
          external_id: string | null
          fonte: string | null
          hash_dedupe: string | null
          id: string
          lifecycle_status: string
          link: string | null
          match_score: number | null
          modalidade: string | null
          numero: string | null
          objeto: string | null
          observacao: string | null
          opportunity_type: string | null
          orgao: string | null
          pdf_path: string | null
          pipeline_stage: string
          prazo_envio: string | null
          prioridade: string
          proximos_passos: string | null
          regiao: string | null
          relevance_reason: string | null
          responsavel: string | null
          resumo_ia: string | null
          riscos: string | null
          source_priority: number
          status: string
          titulo: string
          updated_at: string
          valor_estimado: number | null
          visibility_status: string
        }
        Insert: {
          categoria?: string | null
          confidence_score?: number
          created_at?: string
          criterios_elegibilidade?: string | null
          data_abertura?: string | null
          data_captura?: string
          data_publicacao?: string | null
          documentos?: Json | null
          exclusion_reason?: string | null
          external_id?: string | null
          fonte?: string | null
          hash_dedupe?: string | null
          id?: string
          lifecycle_status?: string
          link?: string | null
          match_score?: number | null
          modalidade?: string | null
          numero?: string | null
          objeto?: string | null
          observacao?: string | null
          opportunity_type?: string | null
          orgao?: string | null
          pdf_path?: string | null
          pipeline_stage?: string
          prazo_envio?: string | null
          prioridade?: string
          proximos_passos?: string | null
          regiao?: string | null
          relevance_reason?: string | null
          responsavel?: string | null
          resumo_ia?: string | null
          riscos?: string | null
          source_priority?: number
          status?: string
          titulo: string
          updated_at?: string
          valor_estimado?: number | null
          visibility_status?: string
        }
        Update: {
          categoria?: string | null
          confidence_score?: number
          created_at?: string
          criterios_elegibilidade?: string | null
          data_abertura?: string | null
          data_captura?: string
          data_publicacao?: string | null
          documentos?: Json | null
          exclusion_reason?: string | null
          external_id?: string | null
          fonte?: string | null
          hash_dedupe?: string | null
          id?: string
          lifecycle_status?: string
          link?: string | null
          match_score?: number | null
          modalidade?: string | null
          numero?: string | null
          objeto?: string | null
          observacao?: string | null
          opportunity_type?: string | null
          orgao?: string | null
          pdf_path?: string | null
          pipeline_stage?: string
          prazo_envio?: string | null
          prioridade?: string
          proximos_passos?: string | null
          regiao?: string | null
          relevance_reason?: string | null
          responsavel?: string | null
          resumo_ia?: string | null
          riscos?: string | null
          source_priority?: number
          status?: string
          titulo?: string
          updated_at?: string
          valor_estimado?: number | null
          visibility_status?: string
        }
        Relationships: []
      }
      editais_blacklist: {
        Row: {
          created_at: string
          external_id: string | null
          hash_dedupe: string | null
          id: string
          motivo: string | null
          titulo_norm: string | null
          url: string | null
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          hash_dedupe?: string | null
          id?: string
          motivo?: string | null
          titulo_norm?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string
          external_id?: string | null
          hash_dedupe?: string | null
          id?: string
          motivo?: string | null
          titulo_norm?: string | null
          url?: string | null
        }
        Relationships: []
      }
      editais_fontes: {
        Row: {
          ativo: boolean
          config: Json
          created_at: string
          endpoint: string | null
          id: string
          intervalo_horas: number
          nome: string
          proxima_sync: string | null
          slug: string
          tipo: string
          ultima_sync: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          config?: Json
          created_at?: string
          endpoint?: string | null
          id?: string
          intervalo_horas?: number
          nome: string
          proxima_sync?: string | null
          slug: string
          tipo?: string
          ultima_sync?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          config?: Json
          created_at?: string
          endpoint?: string | null
          id?: string
          intervalo_horas?: number
          nome?: string
          proxima_sync?: string | null
          slug?: string
          tipo?: string
          ultima_sync?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      editais_sync_logs: {
        Row: {
          capturados: number
          descartados_filtro: number
          duplicados: number
          duracao_ms: number | null
          erros: Json | null
          finalizado_em: string | null
          fonte_slug: string
          id: string
          iniciado_em: string
          mensagem: string | null
          novos: number
          status: string
        }
        Insert: {
          capturados?: number
          descartados_filtro?: number
          duplicados?: number
          duracao_ms?: number | null
          erros?: Json | null
          finalizado_em?: string | null
          fonte_slug: string
          id?: string
          iniciado_em?: string
          mensagem?: string | null
          novos?: number
          status?: string
        }
        Update: {
          capturados?: number
          descartados_filtro?: number
          duplicados?: number
          duracao_ms?: number | null
          erros?: Json | null
          finalizado_em?: string | null
          fonte_slug?: string
          id?: string
          iniciado_em?: string
          mensagem?: string | null
          novos?: number
          status?: string
        }
        Relationships: []
      }
      edital_filter_settings: {
        Row: {
          created_at: string
          excluded_keywords: string[]
          excluded_sources: string[]
          fapes_priority_boost: number
          id: string
          innovation_priority_boost: number
          min_match_score: number
          notif_diarias: boolean
          notif_prazo: boolean
          opportunity_types: string[]
          perfil_empresa: string | null
          pncp_min_match_score: number
          preferred_keywords: string[]
          preferred_regions: string[]
          preferred_sources: string[]
          show_low_relevance: boolean
          show_pncp_results: boolean
          startup_priority_boost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          excluded_keywords?: string[]
          excluded_sources?: string[]
          fapes_priority_boost?: number
          id?: string
          innovation_priority_boost?: number
          min_match_score?: number
          notif_diarias?: boolean
          notif_prazo?: boolean
          opportunity_types?: string[]
          perfil_empresa?: string | null
          pncp_min_match_score?: number
          preferred_keywords?: string[]
          preferred_regions?: string[]
          preferred_sources?: string[]
          show_low_relevance?: boolean
          show_pncp_results?: boolean
          startup_priority_boost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          excluded_keywords?: string[]
          excluded_sources?: string[]
          fapes_priority_boost?: number
          id?: string
          innovation_priority_boost?: number
          min_match_score?: number
          notif_diarias?: boolean
          notif_prazo?: boolean
          opportunity_types?: string[]
          perfil_empresa?: string | null
          pncp_min_match_score?: number
          preferred_keywords?: string[]
          preferred_regions?: string[]
          preferred_sources?: string[]
          show_low_relevance?: boolean
          show_pncp_results?: boolean
          startup_priority_boost?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_acao: {
        Row: {
          acao: string | null
          assunto: string | null
          chave: string
          criada_em: string
          data_email: string | null
          enviado_em: string | null
          enviado_por: string | null
          erro: string | null
          gmail_id: string | null
          modelo: string | null
          msg_assunto: string | null
          msg_data: string | null
          porque: string | null
          remetente: string
          sugestao: string | null
          tarefa_id: string | null
          thread_id: string | null
          veredito: string
        }
        Insert: {
          acao?: string | null
          assunto?: string | null
          chave: string
          criada_em?: string
          data_email?: string | null
          enviado_em?: string | null
          enviado_por?: string | null
          erro?: string | null
          gmail_id?: string | null
          modelo?: string | null
          msg_assunto?: string | null
          msg_data?: string | null
          porque?: string | null
          remetente: string
          sugestao?: string | null
          tarefa_id?: string | null
          thread_id?: string | null
          veredito?: string
        }
        Update: {
          acao?: string | null
          assunto?: string | null
          chave?: string
          criada_em?: string
          data_email?: string | null
          enviado_em?: string | null
          enviado_por?: string | null
          erro?: string | null
          gmail_id?: string | null
          modelo?: string | null
          msg_assunto?: string | null
          msg_data?: string | null
          porque?: string | null
          remetente?: string
          sugestao?: string | null
          tarefa_id?: string | null
          thread_id?: string | null
          veredito?: string
        }
        Relationships: []
      }
      email_mensagens: {
        Row: {
          anexos: Json
          assunto: string | null
          corpo_chave: string | null
          corpo_cnpj: string | null
          corpo_data: string | null
          corpo_valor: number | null
          data: string | null
          erro: string | null
          fiscal: boolean | null
          gmail_id: string
          lido_em: string
          remetente: string | null
          remetente_email: string | null
          thread_id: string | null
        }
        Insert: {
          anexos?: Json
          assunto?: string | null
          corpo_chave?: string | null
          corpo_cnpj?: string | null
          corpo_data?: string | null
          corpo_valor?: number | null
          data?: string | null
          erro?: string | null
          fiscal?: boolean | null
          gmail_id: string
          lido_em?: string
          remetente?: string | null
          remetente_email?: string | null
          thread_id?: string | null
        }
        Update: {
          anexos?: Json
          assunto?: string | null
          corpo_chave?: string | null
          corpo_cnpj?: string | null
          corpo_data?: string | null
          corpo_valor?: number | null
          data?: string | null
          erro?: string | null
          fiscal?: boolean | null
          gmail_id?: string
          lido_em?: string
          remetente?: string | null
          remetente_email?: string | null
          thread_id?: string | null
        }
        Relationships: []
      }
      embaixador_valores_calculados: {
        Row: {
          bonificacao_total: number
          calculado_em: string
          embaixador: string
          embaixador_normalizado: string
          id: string
          mes: string
          recorrencia_total: number
          soma: number
        }
        Insert: {
          bonificacao_total?: number
          calculado_em?: string
          embaixador: string
          embaixador_normalizado: string
          id?: string
          mes: string
          recorrencia_total?: number
          soma?: number
        }
        Update: {
          bonificacao_total?: number
          calculado_em?: string
          embaixador?: string
          embaixador_normalizado?: string
          id?: string
          mes?: string
          recorrencia_total?: number
          soma?: number
        }
        Relationships: []
      }
      estornos_asaas: {
        Row: {
          assinatura: string | null
          atualizado_em: string
          casamento: string | null
          cliente_documento: string | null
          cliente_id: string | null
          cliente_nome: string | null
          cobranca_indevida: boolean
          competencia: string | null
          comprovante_url: string | null
          dados: Json | null
          data_estorno: string | null
          data_pagamento: string | null
          data_vencimento: string | null
          descarte_origem: string | null
          descricao: string | null
          forma: string | null
          id: string
          id_pagamento: string
          indice: number
          invoice_url: string | null
          linha_planilha: number | null
          motivo: string | null
          parcial: boolean
          status_cobranca: string | null
          status_estorno: string | null
          valor_cobranca: number
          valor_estornado: number
        }
        Insert: {
          assinatura?: string | null
          atualizado_em?: string
          casamento?: string | null
          cliente_documento?: string | null
          cliente_id?: string | null
          cliente_nome?: string | null
          cobranca_indevida?: boolean
          competencia?: string | null
          comprovante_url?: string | null
          dados?: Json | null
          data_estorno?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          descarte_origem?: string | null
          descricao?: string | null
          forma?: string | null
          id: string
          id_pagamento: string
          indice?: number
          invoice_url?: string | null
          linha_planilha?: number | null
          motivo?: string | null
          parcial?: boolean
          status_cobranca?: string | null
          status_estorno?: string | null
          valor_cobranca?: number
          valor_estornado?: number
        }
        Update: {
          assinatura?: string | null
          atualizado_em?: string
          casamento?: string | null
          cliente_documento?: string | null
          cliente_id?: string | null
          cliente_nome?: string | null
          cobranca_indevida?: boolean
          competencia?: string | null
          comprovante_url?: string | null
          dados?: Json | null
          data_estorno?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          descarte_origem?: string | null
          descricao?: string | null
          forma?: string | null
          id?: string
          id_pagamento?: string
          indice?: number
          invoice_url?: string | null
          linha_planilha?: number | null
          motivo?: string | null
          parcial?: boolean
          status_cobranca?: string | null
          status_estorno?: string | null
          valor_cobranca?: number
          valor_estornado?: number
        }
        Relationships: []
      }
      estornos_planilha: {
        Row: {
          atualizado_em: string
          cobranca_indevida: boolean
          data_pagamento: string | null
          data_realizada: string | null
          data_solicitacao: string | null
          estabelecimento: string | null
          executor: string | null
          forma: string | null
          linha: number
          links: string[] | null
          mes: number | null
          motivo: string | null
          observacoes: string | null
          periodo: string | null
          responsavel: string | null
          setor: string | null
          status: string | null
          valor_estornar: number | null
          valor_pago: number | null
        }
        Insert: {
          atualizado_em?: string
          cobranca_indevida?: boolean
          data_pagamento?: string | null
          data_realizada?: string | null
          data_solicitacao?: string | null
          estabelecimento?: string | null
          executor?: string | null
          forma?: string | null
          linha: number
          links?: string[] | null
          mes?: number | null
          motivo?: string | null
          observacoes?: string | null
          periodo?: string | null
          responsavel?: string | null
          setor?: string | null
          status?: string | null
          valor_estornar?: number | null
          valor_pago?: number | null
        }
        Update: {
          atualizado_em?: string
          cobranca_indevida?: boolean
          data_pagamento?: string | null
          data_realizada?: string | null
          data_solicitacao?: string | null
          estabelecimento?: string | null
          executor?: string | null
          forma?: string | null
          linha?: number
          links?: string[] | null
          mes?: number | null
          motivo?: string | null
          observacoes?: string | null
          periodo?: string | null
          responsavel?: string | null
          setor?: string | null
          status?: string | null
          valor_estornar?: number | null
          valor_pago?: number | null
        }
        Relationships: []
      }
      extratos_importados: {
        Row: {
          created_at: string
          filename: string
          id: string
          n8n_response: string | null
          n8n_status: number | null
          nome: string
          status: string
          tipo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          n8n_response?: string | null
          n8n_status?: number | null
          nome: string
          status?: string
          tipo: string
          user_id: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          n8n_response?: string | null
          n8n_status?: number | null
          nome?: string
          status?: string
          tipo?: string
          user_id?: string
        }
        Relationships: []
      }
      facilities_compras: {
        Row: {
          categoria: string | null
          created_at: string
          data: string
          forma_pagamento: string | null
          fornecedor_id: string | null
          fornecedor_nome: string | null
          id: string
          item: string
          nf_arquivo: string | null
          nf_bucket: string | null
          nf_cnpj: string | null
          nf_emissao: string | null
          nf_enviada_em: string | null
          nf_enviada_por: string | null
          nf_ia: Json | null
          nf_ia_em: string | null
          nf_nome: string | null
          nf_numero: string | null
          nf_status: string
          nf_url: string | null
          nf_valor: number | null
          omie_anexo_enviado_em: string | null
          omie_anexo_nome: string | null
          omie_cod_titulo: string | null
          omie_match_confianca: string | null
          omie_matched_em: string | null
          pagamento_status: string
          solicitacao_id: string | null
          valor: number
        }
        Insert: {
          categoria?: string | null
          created_at?: string
          data?: string
          forma_pagamento?: string | null
          fornecedor_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          item: string
          nf_arquivo?: string | null
          nf_bucket?: string | null
          nf_cnpj?: string | null
          nf_emissao?: string | null
          nf_enviada_em?: string | null
          nf_enviada_por?: string | null
          nf_ia?: Json | null
          nf_ia_em?: string | null
          nf_nome?: string | null
          nf_numero?: string | null
          nf_status?: string
          nf_url?: string | null
          nf_valor?: number | null
          omie_anexo_enviado_em?: string | null
          omie_anexo_nome?: string | null
          omie_cod_titulo?: string | null
          omie_match_confianca?: string | null
          omie_matched_em?: string | null
          pagamento_status?: string
          solicitacao_id?: string | null
          valor: number
        }
        Update: {
          categoria?: string | null
          created_at?: string
          data?: string
          forma_pagamento?: string | null
          fornecedor_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          item?: string
          nf_arquivo?: string | null
          nf_bucket?: string | null
          nf_cnpj?: string | null
          nf_emissao?: string | null
          nf_enviada_em?: string | null
          nf_enviada_por?: string | null
          nf_ia?: Json | null
          nf_ia_em?: string | null
          nf_nome?: string | null
          nf_numero?: string | null
          nf_status?: string
          nf_url?: string | null
          nf_valor?: number | null
          omie_anexo_enviado_em?: string | null
          omie_anexo_nome?: string | null
          omie_cod_titulo?: string | null
          omie_match_confianca?: string | null
          omie_matched_em?: string | null
          pagamento_status?: string
          solicitacao_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "facilities_compras_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "facilities_fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilities_compras_solicitacao_id_fkey"
            columns: ["solicitacao_id"]
            isOneToOne: false
            referencedRelation: "facilities_solicitacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities_contratos: {
        Row: {
          categoria: string | null
          created_at: string
          descricao: string | null
          fornecedor_id: string | null
          fornecedor_nome: string
          id: string
          renova_em: string | null
          sem_prazo: boolean
          status: string
          updated_at: string
          valor_mensal: number
          vence_em: string | null
        }
        Insert: {
          categoria?: string | null
          created_at?: string
          descricao?: string | null
          fornecedor_id?: string | null
          fornecedor_nome: string
          id?: string
          renova_em?: string | null
          sem_prazo?: boolean
          status?: string
          updated_at?: string
          valor_mensal: number
          vence_em?: string | null
        }
        Update: {
          categoria?: string | null
          created_at?: string
          descricao?: string | null
          fornecedor_id?: string | null
          fornecedor_nome?: string
          id?: string
          renova_em?: string | null
          sem_prazo?: boolean
          status?: string
          updated_at?: string
          valor_mensal?: number
          vence_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facilities_contratos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "facilities_fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities_cotacoes: {
        Row: {
          anexo_url: string | null
          anexos: Json
          created_at: string
          escolhida: boolean
          fornecedor_id: string | null
          fornecedor_nome: string | null
          id: string
          link_url: string | null
          observacao: string | null
          solicitacao_id: string
          valor: number
        }
        Insert: {
          anexo_url?: string | null
          anexos?: Json
          created_at?: string
          escolhida?: boolean
          fornecedor_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          link_url?: string | null
          observacao?: string | null
          solicitacao_id: string
          valor: number
        }
        Update: {
          anexo_url?: string | null
          anexos?: Json
          created_at?: string
          escolhida?: boolean
          fornecedor_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          link_url?: string | null
          observacao?: string | null
          solicitacao_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "facilities_cotacoes_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "facilities_fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilities_cotacoes_solicitacao_id_fkey"
            columns: ["solicitacao_id"]
            isOneToOne: false
            referencedRelation: "facilities_solicitacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities_fornecedores: {
        Row: {
          categoria: string | null
          cnpj: string | null
          contato: string | null
          contratos: Json
          created_at: string
          id: string
          nome: string
          observacao: string | null
          status: string
          tem_contrato: boolean
          updated_at: string
        }
        Insert: {
          categoria?: string | null
          cnpj?: string | null
          contato?: string | null
          contratos?: Json
          created_at?: string
          id?: string
          nome: string
          observacao?: string | null
          status?: string
          tem_contrato?: boolean
          updated_at?: string
        }
        Update: {
          categoria?: string | null
          cnpj?: string | null
          contato?: string | null
          contratos?: Json
          created_at?: string
          id?: string
          nome?: string
          observacao?: string | null
          status?: string
          tem_contrato?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      facilities_nf_auditoria: {
        Row: {
          alvo_id_unico: string
          alvo_tipo: string
          aplicado_em: string | null
          aplicado_por: string | null
          compra_id: string
          confianca: string
          created_at: string
          criterio: Json
          decidido_em: string | null
          decidido_por: string | null
          id: number
          score: number | null
          status: string
          updated_at: string
        }
        Insert: {
          alvo_id_unico: string
          alvo_tipo: string
          aplicado_em?: string | null
          aplicado_por?: string | null
          compra_id: string
          confianca: string
          created_at?: string
          criterio?: Json
          decidido_em?: string | null
          decidido_por?: string | null
          id?: number
          score?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          alvo_id_unico?: string
          alvo_tipo?: string
          aplicado_em?: string | null
          aplicado_por?: string | null
          compra_id?: string
          confianca?: string
          created_at?: string
          criterio?: Json
          decidido_em?: string | null
          decidido_por?: string | null
          id?: number
          score?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilities_nf_auditoria_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "facilities_compras"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities_radar_alertas: {
        Row: {
          alvo_id: string
          cotacao_id: string | null
          created_at: string
          economia: number | null
          frete_valor: number | null
          id: number
          oferta_id: number
          preco: number
          preco_alvo: number
          preco_total: number | null
          status: string
          tentativas: number
          texto: string
          tipo: string
          visto_em: string | null
          visto_por: string | null
        }
        Insert: {
          alvo_id: string
          cotacao_id?: string | null
          created_at?: string
          economia?: number | null
          frete_valor?: number | null
          id?: number
          oferta_id: number
          preco: number
          preco_alvo: number
          preco_total?: number | null
          status?: string
          tentativas?: number
          texto: string
          tipo: string
          visto_em?: string | null
          visto_por?: string | null
        }
        Update: {
          alvo_id?: string
          cotacao_id?: string | null
          created_at?: string
          economia?: number | null
          frete_valor?: number | null
          id?: number
          oferta_id?: number
          preco?: number
          preco_alvo?: number
          preco_total?: number | null
          status?: string
          tentativas?: number
          texto?: string
          tipo?: string
          visto_em?: string | null
          visto_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facilities_radar_alertas_alvo_id_fkey"
            columns: ["alvo_id"]
            isOneToOne: false
            referencedRelation: "facilities_radar_alvos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilities_radar_alertas_oferta_id_fkey"
            columns: ["oferta_id"]
            isOneToOne: false
            referencedRelation: "facilities_radar_ofertas"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities_radar_alvos: {
        Row: {
          ativo: boolean
          cadencia_dias: number
          categoria: string
          created_at: string
          criado_por: string | null
          favorito: boolean
          fontes: string[]
          id: string
          link_ref: string | null
          pedido: string
          preco_alvo: number
          quantidade: number
          rodadas: number
          solicitacao_id: string | null
          specs: Json
          titulo: string
          ultima_varredura: string | null
          ultimo_erro: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cadencia_dias?: number
          categoria?: string
          created_at?: string
          criado_por?: string | null
          favorito?: boolean
          fontes?: string[]
          id?: string
          link_ref?: string | null
          pedido: string
          preco_alvo: number
          quantidade?: number
          rodadas?: number
          solicitacao_id?: string | null
          specs?: Json
          titulo: string
          ultima_varredura?: string | null
          ultimo_erro?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cadencia_dias?: number
          categoria?: string
          created_at?: string
          criado_por?: string | null
          favorito?: boolean
          fontes?: string[]
          id?: string
          link_ref?: string | null
          pedido?: string
          preco_alvo?: number
          quantidade?: number
          rodadas?: number
          solicitacao_id?: string | null
          specs?: Json
          titulo?: string
          ultima_varredura?: string | null
          ultimo_erro?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilities_radar_alvos_solicitacao_id_fkey"
            columns: ["solicitacao_id"]
            isOneToOne: false
            referencedRelation: "facilities_solicitacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities_radar_execucoes: {
        Row: {
          alertas: number
          alvos: number
          detalhe: Json
          id: number
          iniciado_em: string
          ofertas: number
          terminado_em: string | null
        }
        Insert: {
          alertas?: number
          alvos?: number
          detalhe?: Json
          id?: number
          iniciado_em?: string
          ofertas?: number
          terminado_em?: string | null
        }
        Update: {
          alertas?: number
          alvos?: number
          detalhe?: Json
          id?: number
          iniciado_em?: string
          ofertas?: number
          terminado_em?: string | null
        }
        Relationships: []
      }
      facilities_radar_ofertas: {
        Row: {
          alvo_id: string
          ativo: boolean
          avaliacao: number | null
          avaliacoes: number | null
          condicao: string
          conferir: string[]
          confirmado_em: string | null
          dentro_do_teto: boolean
          disponivel: boolean | null
          embalagem_qtd: number | null
          embalagem_texto: string | null
          embalagem_unidade: string | null
          ficha: string | null
          fonte: string
          frete_gratis: boolean
          frete_texto: string | null
          frete_valor: number | null
          id: number
          id_externo: string
          imagem_url: string | null
          motivos: string[]
          porque_barato: string | null
          preco: number
          preco_min: number | null
          preco_total: number | null
          preco_unitario: number | null
          primeiro_visto_em: string
          reclamacoes: string | null
          score: number
          specs_lidas: Json
          titulo: string
          url: string
          vendedor: string | null
          visto_em: string
        }
        Insert: {
          alvo_id: string
          ativo?: boolean
          avaliacao?: number | null
          avaliacoes?: number | null
          condicao?: string
          conferir?: string[]
          confirmado_em?: string | null
          dentro_do_teto?: boolean
          disponivel?: boolean | null
          embalagem_qtd?: number | null
          embalagem_texto?: string | null
          embalagem_unidade?: string | null
          ficha?: string | null
          fonte: string
          frete_gratis?: boolean
          frete_texto?: string | null
          frete_valor?: number | null
          id?: number
          id_externo: string
          imagem_url?: string | null
          motivos?: string[]
          porque_barato?: string | null
          preco: number
          preco_min?: number | null
          preco_total?: number | null
          preco_unitario?: number | null
          primeiro_visto_em?: string
          reclamacoes?: string | null
          score?: number
          specs_lidas?: Json
          titulo: string
          url: string
          vendedor?: string | null
          visto_em?: string
        }
        Update: {
          alvo_id?: string
          ativo?: boolean
          avaliacao?: number | null
          avaliacoes?: number | null
          condicao?: string
          conferir?: string[]
          confirmado_em?: string | null
          dentro_do_teto?: boolean
          disponivel?: boolean | null
          embalagem_qtd?: number | null
          embalagem_texto?: string | null
          embalagem_unidade?: string | null
          ficha?: string | null
          fonte?: string
          frete_gratis?: boolean
          frete_texto?: string | null
          frete_valor?: number | null
          id?: number
          id_externo?: string
          imagem_url?: string | null
          motivos?: string[]
          porque_barato?: string | null
          preco?: number
          preco_min?: number | null
          preco_total?: number | null
          preco_unitario?: number | null
          primeiro_visto_em?: string
          reclamacoes?: string | null
          score?: number
          specs_lidas?: Json
          titulo?: string
          url?: string
          vendedor?: string | null
          visto_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilities_radar_ofertas_alvo_id_fkey"
            columns: ["alvo_id"]
            isOneToOne: false
            referencedRelation: "facilities_radar_alvos"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities_radar_precos: {
        Row: {
          coletado_em: string
          id: number
          oferta_id: number
          preco: number
        }
        Insert: {
          coletado_em?: string
          id?: number
          oferta_id: number
          preco: number
        }
        Update: {
          coletado_em?: string
          id?: number
          oferta_id?: number
          preco?: number
        }
        Relationships: [
          {
            foreignKeyName: "facilities_radar_precos_oferta_id_fkey"
            columns: ["oferta_id"]
            isOneToOne: false
            referencedRelation: "facilities_radar_ofertas"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities_solicitacoes: {
        Row: {
          categoria: string | null
          created_at: string
          decidido_em: string | null
          decidido_por: string | null
          id: string
          observacao: string | null
          solicitante: string | null
          status: string
          titulo: string
          updated_at: string
          valor: number | null
        }
        Insert: {
          categoria?: string | null
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          id?: string
          observacao?: string | null
          solicitante?: string | null
          status?: string
          titulo: string
          updated_at?: string
          valor?: number | null
        }
        Update: {
          categoria?: string | null
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          id?: string
          observacao?: string | null
          solicitante?: string | null
          status?: string
          titulo?: string
          updated_at?: string
          valor?: number | null
        }
        Relationships: []
      }
      firecrawl_consumo: {
        Row: {
          consumidor: string
          creditos: number
          detalhe: Json
          id: number
          medido: boolean
          quando: string
        }
        Insert: {
          consumidor: string
          creditos: number
          detalhe?: Json
          id?: number
          medido?: boolean
          quando?: string
        }
        Update: {
          consumidor?: string
          creditos?: number
          detalhe?: Json
          id?: number
          medido?: boolean
          quando?: string
        }
        Relationships: []
      }
      firecrawl_orcamento: {
        Row: {
          ativo: boolean
          atualizado_em: string
          consumidor: string
          para_que: string | null
          piso_saldo: number
          rotulo: string
          teto_mes: number
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          consumidor: string
          para_que?: string | null
          piso_saldo: number
          rotulo: string
          teto_mes: number
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          consumidor?: string
          para_que?: string | null
          piso_saldo?: number
          rotulo?: string
          teto_mes?: number
        }
        Relationships: []
      }
      folha_ajustes_log: {
        Row: {
          campo: string
          codigo_rh: string
          de: number | null
          de_texto: string | null
          feito_em: string
          feito_por: string | null
          id: number
          motivo: string | null
          nome: string | null
          para: number | null
          para_texto: string | null
          valor_rh: number | null
        }
        Insert: {
          campo?: string
          codigo_rh: string
          de?: number | null
          de_texto?: string | null
          feito_em?: string
          feito_por?: string | null
          id?: number
          motivo?: string | null
          nome?: string | null
          para?: number | null
          para_texto?: string | null
          valor_rh?: number | null
        }
        Update: {
          campo?: string
          codigo_rh?: string
          de?: number | null
          de_texto?: string | null
          feito_em?: string
          feito_por?: string | null
          id?: number
          motivo?: string | null
          nome?: string | null
          para?: number | null
          para_texto?: string | null
          valor_rh?: number | null
        }
        Relationships: []
      }
      folha_depara: {
        Row: {
          ajustado_em: string | null
          ajustado_por: string | null
          ajuste_motivo: string | null
          atualizado_em: string
          categoria_descricao: string | null
          codigo_rh: string
          confirmado_em: string | null
          confirmado_por: string | null
          criado_em: string
          departamento: string | null
          documento_ajustado: string | null
          documento_ajustado_em: string | null
          documento_motivo: string | null
          documento_rh_no_ajuste: string | null
          justificativa_ia: string | null
          nome: string
          origem: string
          valor_ajustado: number | null
          valor_referencia: number | null
          valor_referencia_competencia: string | null
          valor_rh_no_ajuste: number | null
        }
        Insert: {
          ajustado_em?: string | null
          ajustado_por?: string | null
          ajuste_motivo?: string | null
          atualizado_em?: string
          categoria_descricao?: string | null
          codigo_rh: string
          confirmado_em?: string | null
          confirmado_por?: string | null
          criado_em?: string
          departamento?: string | null
          documento_ajustado?: string | null
          documento_ajustado_em?: string | null
          documento_motivo?: string | null
          documento_rh_no_ajuste?: string | null
          justificativa_ia?: string | null
          nome: string
          origem?: string
          valor_ajustado?: number | null
          valor_referencia?: number | null
          valor_referencia_competencia?: string | null
          valor_rh_no_ajuste?: number | null
        }
        Update: {
          ajustado_em?: string | null
          ajustado_por?: string | null
          ajuste_motivo?: string | null
          atualizado_em?: string
          categoria_descricao?: string | null
          codigo_rh?: string
          confirmado_em?: string | null
          confirmado_por?: string | null
          criado_em?: string
          departamento?: string | null
          documento_ajustado?: string | null
          documento_ajustado_em?: string | null
          documento_motivo?: string | null
          documento_rh_no_ajuste?: string | null
          justificativa_ia?: string | null
          nome?: string
          origem?: string
          valor_ajustado?: number | null
          valor_referencia?: number | null
          valor_referencia_competencia?: string | null
          valor_rh_no_ajuste?: number | null
        }
        Relationships: []
      }
      folha_envios_omie: {
        Row: {
          atualizado_em: string
          competencia: string
          criado_em: string
          enviado_em: string | null
          enviado_por: string | null
          estado: string
          previsao_ajustada: string | null
          previsao_motivo: string | null
          resposta: Json | null
          titulos: number
          valor_total: number
        }
        Insert: {
          atualizado_em?: string
          competencia: string
          criado_em?: string
          enviado_em?: string | null
          enviado_por?: string | null
          estado?: string
          previsao_ajustada?: string | null
          previsao_motivo?: string | null
          resposta?: Json | null
          titulos?: number
          valor_total?: number
        }
        Update: {
          atualizado_em?: string
          competencia?: string
          criado_em?: string
          enviado_em?: string | null
          enviado_por?: string | null
          estado?: string
          previsao_ajustada?: string | null
          previsao_motivo?: string | null
          resposta?: Json | null
          titulos?: number
          valor_total?: number
        }
        Relationships: []
      }
      folha_recusas: {
        Row: {
          codigo_rh: string
          competencia: string
          integracao: string
          motivo: string
          nome: string
          origem: string
          resolvido_em: string | null
          tentado_em: string
          tentado_por: string | null
          tentativas: number
        }
        Insert: {
          codigo_rh: string
          competencia: string
          integracao: string
          motivo: string
          nome: string
          origem: string
          resolvido_em?: string | null
          tentado_em?: string
          tentado_por?: string | null
          tentativas?: number
        }
        Update: {
          codigo_rh?: string
          competencia?: string
          integracao?: string
          motivo?: string
          nome?: string
          origem?: string
          resolvido_em?: string | null
          tentado_em?: string
          tentado_por?: string | null
          tentativas?: number
        }
        Relationships: []
      }
      fornecedor_regra_nota: {
        Row: {
          criado_em: string
          criado_por: string | null
          doc: string
          meses_depois: number
          nome: string | null
          observacao: string | null
          regra: string
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          doc: string
          meses_depois?: number
          nome?: string | null
          observacao?: string | null
          regra: string
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          doc?: string
          meses_depois?: number
          nome?: string | null
          observacao?: string | null
          regra?: string
        }
        Relationships: []
      }
      fornecedor_sem_nf: {
        Row: {
          criado_em: string
          criado_por: string | null
          id: number
          motivo: string
          padrao_nome: string
          resolvido_em: string | null
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          id?: number
          motivo: string
          padrao_nome: string
          resolvido_em?: string | null
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          id?: number
          motivo?: string
          padrao_nome?: string
          resolvido_em?: string | null
        }
        Relationships: []
      }
      historico_financeiro: {
        Row: {
          ano: number
          created_at: string
          id: string
          mes: number
          metrica: string
          origem: string | null
          updated_at: string
          valor: number
        }
        Insert: {
          ano: number
          created_at?: string
          id?: string
          mes: number
          metrica: string
          origem?: string | null
          updated_at?: string
          valor?: number
        }
        Update: {
          ano?: number
          created_at?: string
          id?: string
          mes?: number
          metrica?: string
          origem?: string | null
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      hub_novidades: {
        Row: {
          commits: Json
          dia: string
          gerado_em: string
          itens: Json
          n_commits: number
          redigido_por: string
          resumo: string | null
        }
        Insert: {
          commits?: Json
          dia: string
          gerado_em?: string
          itens?: Json
          n_commits?: number
          redigido_por?: string
          resumo?: string | null
        }
        Update: {
          commits?: Json
          dia?: string
          gerado_em?: string
          itens?: Json
          n_commits?: number
          redigido_por?: string
          resumo?: string | null
        }
        Relationships: []
      }
      hub_novidades_leitura: {
        Row: {
          atualizado_em: string
          user_id: string
          visto_ate: string
        }
        Insert: {
          atualizado_em?: string
          user_id: string
          visto_ate: string
        }
        Update: {
          atualizado_em?: string
          user_id?: string
          visto_ate?: string
        }
        Relationships: []
      }
      ia_orcamento: {
        Row: {
          ativo: boolean
          atualizado_em: string
          consumidor: string
          para_que: string | null
          rotulo: string
          teto_dia: number
          teto_mes_usd: number
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          consumidor: string
          para_que?: string | null
          rotulo: string
          teto_dia?: number
          teto_mes_usd?: number
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          consumidor?: string
          para_que?: string | null
          rotulo?: string
          teto_dia?: number
          teto_mes_usd?: number
        }
        Relationships: []
      }
      integracao_estado: {
        Row: {
          assinatura: string | null
          causa: string | null
          chave: string
          conectado: boolean | null
          detalhe: string | null
          gravidade: string
          nome: string
          o_que_fazer: string | null
          para_que: string | null
          primeira_em: string
          ultima_em: string
          verificado_em: string
        }
        Insert: {
          assinatura?: string | null
          causa?: string | null
          chave: string
          conectado?: boolean | null
          detalhe?: string | null
          gravidade?: string
          nome: string
          o_que_fazer?: string | null
          para_que?: string | null
          primeira_em?: string
          ultima_em?: string
          verificado_em?: string
        }
        Update: {
          assinatura?: string | null
          causa?: string | null
          chave?: string
          conectado?: boolean | null
          detalhe?: string | null
          gravidade?: string
          nome?: string
          o_que_fazer?: string | null
          para_que?: string | null
          primeira_em?: string
          ultima_em?: string
          verificado_em?: string
        }
        Relationships: []
      }
      internal_cron_tokens: {
        Row: {
          criado_em: string
          name: string
          token: string
        }
        Insert: {
          criado_em?: string
          name: string
          token?: string
        }
        Update: {
          criado_em?: string
          name?: string
          token?: string
        }
        Relationships: []
      }
      internal_secrets: {
        Row: {
          criado_em: string
          nome: string
          observacao: string | null
          valor: string
        }
        Insert: {
          criado_em?: string
          nome: string
          observacao?: string | null
          valor: string
        }
        Update: {
          criado_em?: string
          nome?: string
          observacao?: string | null
          valor?: string
        }
        Relationships: []
      }
      investimentos_snapshot: {
        Row: {
          atualizado_em: string
          dados: Json
          entity: string
        }
        Insert: {
          atualizado_em?: string
          dados: Json
          entity: string
        }
        Update: {
          atualizado_em?: string
          dados?: Json
          entity?: string
        }
        Relationships: []
      }
      lib_cargos: {
        Row: {
          created_at: string
          descricao: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      lib_centros_custo: {
        Row: {
          ativo: boolean
          atualizado_em: string
          codigo: string | null
          created_at: string
          departamento_id: string | null
          descricao: string | null
          id: string
          nome: string
          omie_codigo: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          codigo?: string | null
          created_at?: string
          departamento_id?: string | null
          descricao?: string | null
          id?: string
          nome: string
          omie_codigo?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          codigo?: string | null
          created_at?: string
          departamento_id?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          omie_codigo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lib_centros_custo_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "lib_departamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      lib_colaboradores: {
        Row: {
          cargo_id: string | null
          centro_custo_id: string | null
          created_at: string
          data_admissao: string | null
          departamento_id: string | null
          email: string | null
          gestor_id: string | null
          id: string
          nome: string
          observacao: string | null
          status: string
          tags: string[]
          telefone: string | null
          updated_at: string
        }
        Insert: {
          cargo_id?: string | null
          centro_custo_id?: string | null
          created_at?: string
          data_admissao?: string | null
          departamento_id?: string | null
          email?: string | null
          gestor_id?: string | null
          id?: string
          nome: string
          observacao?: string | null
          status?: string
          tags?: string[]
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          cargo_id?: string | null
          centro_custo_id?: string | null
          created_at?: string
          data_admissao?: string | null
          departamento_id?: string | null
          email?: string | null
          gestor_id?: string | null
          id?: string
          nome?: string
          observacao?: string | null
          status?: string
          tags?: string[]
          telefone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lib_colaboradores_cargo_id_fkey"
            columns: ["cargo_id"]
            isOneToOne: false
            referencedRelation: "lib_cargos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lib_colaboradores_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "lib_centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lib_colaboradores_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "lib_departamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lib_colaboradores_gestor_id_fkey"
            columns: ["gestor_id"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      lib_departamentos: {
        Row: {
          created_at: string
          descricao: string | null
          gestor_id: string | null
          id: string
          nome: string
          telefone_whatsapp: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          gestor_id?: string | null
          id?: string
          nome: string
          telefone_whatsapp?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          descricao?: string | null
          gestor_id?: string | null
          id?: string
          nome?: string
          telefone_whatsapp?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lib_departamentos_gestor_fk"
            columns: ["gestor_id"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      lib_fornecedores: {
        Row: {
          apelido: string | null
          apelido_em: string | null
          apelido_por: string | null
          atualizado_em: string
          categoria: string | null
          categoria_omie_codigo: string | null
          centro_custo_id: string | null
          confianca: number
          contato_email: string | null
          contato_nome: string | null
          contato_telefone: string | null
          created_at: string
          departamento_id: string | null
          documento: string | null
          documento_norm: string | null
          dono_id: string | null
          exige_nf: boolean
          gestor_aprovador_id: string | null
          id: string
          n_ocorrencias: number
          nome: string
          o_que_e: string | null
          observacao: string | null
          omie_id: string | null
          origem: string
          periodicidade: string | null
          permite_auto_lancamento: boolean
          prazo_pagamento_dias: number | null
          revisar: boolean
          status: string
          tags: string[]
          updated_at: string
          valor_max: number | null
          valor_min: number | null
        }
        Insert: {
          apelido?: string | null
          apelido_em?: string | null
          apelido_por?: string | null
          atualizado_em?: string
          categoria?: string | null
          categoria_omie_codigo?: string | null
          centro_custo_id?: string | null
          confianca?: number
          contato_email?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          departamento_id?: string | null
          documento?: string | null
          documento_norm?: string | null
          dono_id?: string | null
          exige_nf?: boolean
          gestor_aprovador_id?: string | null
          id?: string
          n_ocorrencias?: number
          nome: string
          o_que_e?: string | null
          observacao?: string | null
          omie_id?: string | null
          origem?: string
          periodicidade?: string | null
          permite_auto_lancamento?: boolean
          prazo_pagamento_dias?: number | null
          revisar?: boolean
          status?: string
          tags?: string[]
          updated_at?: string
          valor_max?: number | null
          valor_min?: number | null
        }
        Update: {
          apelido?: string | null
          apelido_em?: string | null
          apelido_por?: string | null
          atualizado_em?: string
          categoria?: string | null
          categoria_omie_codigo?: string | null
          centro_custo_id?: string | null
          confianca?: number
          contato_email?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          departamento_id?: string | null
          documento?: string | null
          documento_norm?: string | null
          dono_id?: string | null
          exige_nf?: boolean
          gestor_aprovador_id?: string | null
          id?: string
          n_ocorrencias?: number
          nome?: string
          o_que_e?: string | null
          observacao?: string | null
          omie_id?: string | null
          origem?: string
          periodicidade?: string | null
          permite_auto_lancamento?: boolean
          prazo_pagamento_dias?: number | null
          revisar?: boolean
          status?: string
          tags?: string[]
          updated_at?: string
          valor_max?: number | null
          valor_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lib_fornecedores_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "lib_centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lib_fornecedores_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "lib_departamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lib_fornecedores_dono_id_fkey"
            columns: ["dono_id"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lib_fornecedores_gestor_aprovador_id_fkey"
            columns: ["gestor_aprovador_id"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      lib_politicas: {
        Row: {
          aplica_a: string[]
          ativa: boolean
          atualizado_em: string
          categoria: string | null
          conteudo: string
          created_at: string
          id: string
          mantenedor_id: string | null
          regras: Json
          tags: string[]
          titulo: string
          updated_at: string
          versao: number
          vigente_desde: string | null
        }
        Insert: {
          aplica_a?: string[]
          ativa?: boolean
          atualizado_em?: string
          categoria?: string | null
          conteudo: string
          created_at?: string
          id?: string
          mantenedor_id?: string | null
          regras?: Json
          tags?: string[]
          titulo: string
          updated_at?: string
          versao?: number
          vigente_desde?: string | null
        }
        Update: {
          aplica_a?: string[]
          ativa?: boolean
          atualizado_em?: string
          categoria?: string | null
          conteudo?: string
          created_at?: string
          id?: string
          mantenedor_id?: string | null
          regras?: Json
          tags?: string[]
          titulo?: string
          updated_at?: string
          versao?: number
          vigente_desde?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lib_politicas_mantenedor_id_fkey"
            columns: ["mantenedor_id"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      magic_tokens: {
        Row: {
          acessos: number
          card_final: string | null
          colaborador_id: string | null
          criado_em: string
          criado_por: string | null
          enviado_para: string | null
          expira_em: string | null
          fatura_abertura_em: string | null
          fatura_bloqueio_ate: string | null
          fatura_erros: number
          id_unicos: Json
          ip_ultimo_acesso: string | null
          qtd_itens: number
          responsavel: string
          status: string
          token: string
          ultimo_acesso: string | null
          valor_total: number
        }
        Insert: {
          acessos?: number
          card_final?: string | null
          colaborador_id?: string | null
          criado_em?: string
          criado_por?: string | null
          enviado_para?: string | null
          expira_em?: string | null
          fatura_abertura_em?: string | null
          fatura_bloqueio_ate?: string | null
          fatura_erros?: number
          id_unicos?: Json
          ip_ultimo_acesso?: string | null
          qtd_itens?: number
          responsavel: string
          status?: string
          token: string
          ultimo_acesso?: string | null
          valor_total?: number
        }
        Update: {
          acessos?: number
          card_final?: string | null
          colaborador_id?: string | null
          criado_em?: string
          criado_por?: string | null
          enviado_para?: string | null
          expira_em?: string | null
          fatura_abertura_em?: string | null
          fatura_bloqueio_ate?: string | null
          fatura_erros?: number
          id_unicos?: Json
          ip_ultimo_acesso?: string | null
          qtd_itens?: number
          responsavel?: string
          status?: string
          token?: string
          ultimo_acesso?: string | null
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "magic_tokens_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_pedidos: {
        Row: {
          baixado: boolean
          created_at: string
          item_title: string | null
          order_id: string
          pack_id: string | null
          periodo: string
          seller: string | null
          status: string | null
          valor: number | null
        }
        Insert: {
          baixado?: boolean
          created_at?: string
          item_title?: string | null
          order_id: string
          pack_id?: string | null
          periodo: string
          seller?: string | null
          status?: string | null
          valor?: number | null
        }
        Update: {
          baixado?: boolean
          created_at?: string
          item_title?: string | null
          order_id?: string
          pack_id?: string | null
          periodo?: string
          seller?: string | null
          status?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      ml_tokens: {
        Row: {
          access_token: string | null
          id: number
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          id?: never
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          id?: never
          refresh_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      nf_cadastro_correcoes: {
        Row: {
          alvos: string[]
          criado_em: string
          doc: string
          fonte: string | null
          id: string
          id_customer: string | null
          ids_cobranca: string[] | null
          n_cod_cli: number | null
          nome: string | null
          operador: string | null
          origem: string
          proposta: Json | null
          resultado: Json | null
        }
        Insert: {
          alvos: string[]
          criado_em?: string
          doc: string
          fonte?: string | null
          id?: string
          id_customer?: string | null
          ids_cobranca?: string[] | null
          n_cod_cli?: number | null
          nome?: string | null
          operador?: string | null
          origem?: string
          proposta?: Json | null
          resultado?: Json | null
        }
        Update: {
          alvos?: string[]
          criado_em?: string
          doc?: string
          fonte?: string | null
          id?: string
          id_customer?: string | null
          ids_cobranca?: string[] | null
          n_cod_cli?: number | null
          nome?: string | null
          operador?: string | null
          origem?: string
          proposta?: Json | null
          resultado?: Json | null
        }
        Relationships: []
      }
      nf_config: {
        Row: {
          atualizado_em: string
          avulsa_sem_asaas_desde: string | null
          cadastro_auto: string
          cadastro_auto_teto: number
          data_corte: string
          emissao_automatica: string
          etapa_faturamento: string
          etapa_isolamento: string
          id: number
          paralelo_asaas: boolean
          teto_dia: number
          teto_lote: number
          teto_rodada: number
        }
        Insert: {
          atualizado_em?: string
          avulsa_sem_asaas_desde?: string | null
          cadastro_auto?: string
          cadastro_auto_teto?: number
          data_corte?: string
          emissao_automatica?: string
          etapa_faturamento?: string
          etapa_isolamento?: string
          id?: number
          paralelo_asaas?: boolean
          teto_dia?: number
          teto_lote?: number
          teto_rodada?: number
        }
        Update: {
          atualizado_em?: string
          avulsa_sem_asaas_desde?: string | null
          cadastro_auto?: string
          cadastro_auto_teto?: number
          data_corte?: string
          emissao_automatica?: string
          etapa_faturamento?: string
          etapa_isolamento?: string
          id?: number
          paralelo_asaas?: boolean
          teto_dia?: number
          teto_lote?: number
          teto_rodada?: number
        }
        Relationships: []
      }
      nf_emissoes: {
        Row: {
          acao: string
          avulsa: boolean
          criado_em: string
          erro: string | null
          id: string
          id_asaas: string
          n_cod_os: number | null
          nfse_numero: string | null
          operador: string | null
          payload: Json | null
          resultado: string
          usuario: string | null
        }
        Insert: {
          acao: string
          avulsa?: boolean
          criado_em?: string
          erro?: string | null
          id?: string
          id_asaas: string
          n_cod_os?: number | null
          nfse_numero?: string | null
          operador?: string | null
          payload?: Json | null
          resultado: string
          usuario?: string | null
        }
        Update: {
          acao?: string
          avulsa?: boolean
          criado_em?: string
          erro?: string | null
          id?: string
          id_asaas?: string
          n_cod_os?: number | null
          nfse_numero?: string | null
          operador?: string | null
          payload?: Json | null
          resultado?: string
          usuario?: string | null
        }
        Relationships: []
      }
      nf_execucoes: {
        Row: {
          bloqueadas: number
          concluida_em: string | null
          detalhe: Json | null
          emitidas: number
          erro: string | null
          falhas: number
          fila: number
          id: string
          iniciada_em: string
          lote: number | null
          modo: string
          origem: string
          pulada: string | null
        }
        Insert: {
          bloqueadas?: number
          concluida_em?: string | null
          detalhe?: Json | null
          emitidas?: number
          erro?: string | null
          falhas?: number
          fila?: number
          id?: string
          iniciada_em?: string
          lote?: number | null
          modo: string
          origem: string
          pulada?: string | null
        }
        Update: {
          bloqueadas?: number
          concluida_em?: string | null
          detalhe?: Json | null
          emitidas?: number
          erro?: string | null
          falhas?: number
          fila?: number
          id?: string
          iniciada_em?: string
          lote?: number | null
          modo?: string
          origem?: string
          pulada?: string | null
        }
        Relationships: []
      }
      nf_os_omie: {
        Row: {
          asaas_anexado_em: string | null
          asaas_anexo_erro: string | null
          asaas_anexos: Json
          atualizado_em: string
          c_cod_int_os: string | null
          c_num_os: string | null
          cancelada: boolean
          cnpj_cpf: string | null
          dados: Json | null
          data_faturamento: string | null
          data_previsao: string | null
          email_destino: string | null
          email_envio: boolean | null
          etapa: string | null
          faturada: boolean
          n_cod_cli: number | null
          n_cod_os: number
          nfse_lote: number | null
          nfse_mensagem: string | null
          nfse_numero: string | null
          nfse_rps: string | null
          nfse_status: string | null
          nfse_verificacao: string | null
          nfse_xml: string | null
          status_lido_em: string | null
          valor: number | null
        }
        Insert: {
          asaas_anexado_em?: string | null
          asaas_anexo_erro?: string | null
          asaas_anexos?: Json
          atualizado_em?: string
          c_cod_int_os?: string | null
          c_num_os?: string | null
          cancelada?: boolean
          cnpj_cpf?: string | null
          dados?: Json | null
          data_faturamento?: string | null
          data_previsao?: string | null
          email_destino?: string | null
          email_envio?: boolean | null
          etapa?: string | null
          faturada?: boolean
          n_cod_cli?: number | null
          n_cod_os: number
          nfse_lote?: number | null
          nfse_mensagem?: string | null
          nfse_numero?: string | null
          nfse_rps?: string | null
          nfse_status?: string | null
          nfse_verificacao?: string | null
          nfse_xml?: string | null
          status_lido_em?: string | null
          valor?: number | null
        }
        Update: {
          asaas_anexado_em?: string | null
          asaas_anexo_erro?: string | null
          asaas_anexos?: Json
          atualizado_em?: string
          c_cod_int_os?: string | null
          c_num_os?: string | null
          cancelada?: boolean
          cnpj_cpf?: string | null
          dados?: Json | null
          data_faturamento?: string | null
          data_previsao?: string | null
          email_destino?: string | null
          email_envio?: boolean | null
          etapa?: string | null
          faturada?: boolean
          n_cod_cli?: number | null
          n_cod_os?: number
          nfse_lote?: number | null
          nfse_mensagem?: string | null
          nfse_numero?: string | null
          nfse_rps?: string | null
          nfse_status?: string | null
          nfse_verificacao?: string | null
          nfse_xml?: string | null
          status_lido_em?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      nfse_preparo_fila: {
        Row: {
          cobrancas: number | null
          codigo: number | null
          doc: string
          falta: string | null
          id_customer: string | null
          montada_em: string
          motivo: string | null
          nome: string | null
          situacao: string
          tentativas: number
          tratada_em: string | null
          valor: number | null
        }
        Insert: {
          cobrancas?: number | null
          codigo?: number | null
          doc: string
          falta?: string | null
          id_customer?: string | null
          montada_em?: string
          motivo?: string | null
          nome?: string | null
          situacao?: string
          tentativas?: number
          tratada_em?: string | null
          valor?: number | null
        }
        Update: {
          cobrancas?: number | null
          codigo?: number | null
          doc?: string
          falta?: string | null
          id_customer?: string | null
          montada_em?: string
          motivo?: string | null
          nome?: string | null
          situacao?: string
          tentativas?: number
          tratada_em?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      nota_fonte_bloqueada: {
        Row: {
          acao: string
          criado_em: string
          id: number
          motivo: string
          onde: string | null
          padrao_nome: string
          resolvido_em: string | null
        }
        Insert: {
          acao: string
          criado_em?: string
          id?: number
          motivo: string
          onde?: string | null
          padrao_nome: string
          resolvido_em?: string | null
        }
        Update: {
          acao?: string
          criado_em?: string
          id?: number
          motivo?: string
          onde?: string | null
          padrao_nome?: string
          resolvido_em?: string | null
        }
        Relationships: []
      }
      nota_taxa_do_lote: {
        Row: {
          calculado_em: string
          data: string
          espalhamento: number
          id: number
          moeda: string
          quem: string
          taxa: number
          titulos: number
        }
        Insert: {
          calculado_em?: string
          data: string
          espalhamento: number
          id?: number
          moeda: string
          quem: string
          taxa: number
          titulos: number
        }
        Update: {
          calculado_em?: string
          data?: string
          espalhamento?: number
          id?: number
          moeda?: string
          quem?: string
          taxa?: number
          titulos?: number
        }
        Relationships: []
      }
      notas_externas: {
        Row: {
          alvo_decidido_por: string | null
          alvo_id_unico: string | null
          alvo_manual: boolean
          alvo_tipo: string | null
          arquivo_bucket: string | null
          arquivo_bytes: number | null
          arquivo_em: string | null
          arquivo_erro: string | null
          atualizado_em: string
          candidatos: Json | null
          casamento: string | null
          chave: string
          chave_fiscal: string | null
          cnpj: string | null
          competencia: string | null
          conferencia: string | null
          conferido_em: string | null
          confianca: string | null
          copia_de: number | null
          detalhe: string | null
          diz_anexado: boolean
          documento: string | null
          drive_id: string | null
          enviado_em: string | null
          enviado_erp_em: string | null
          erp_anexos: number | null
          erro_erp: string | null
          fila_erp: boolean
          fonte: string
          forma_pagamento: string | null
          id: number
          ignorado_em: string | null
          ignorado_motivo: string | null
          leitura_erro: string | null
          lido_do_arquivo_em: string | null
          linha: number | null
          link: string
          link_documento: string | null
          moeda: string | null
          nao_casou_em: string | null
          nao_casou_motivo: string | null
          nao_casou_por: string | null
          nome: string | null
          o_que_e: string | null
          ordem: number
          parece_nota: boolean | null
          status_planilha: string | null
          sugestao_em: string | null
          sugestao_ia: Json | null
          tem_arquivo: boolean
          tipo_documento: string | null
          valor: number | null
          valor_moeda: number | null
          valor_parcela: number | null
          vencimento: string | null
          visto_em: string
        }
        Insert: {
          alvo_decidido_por?: string | null
          alvo_id_unico?: string | null
          alvo_manual?: boolean
          alvo_tipo?: string | null
          arquivo_bucket?: string | null
          arquivo_bytes?: number | null
          arquivo_em?: string | null
          arquivo_erro?: string | null
          atualizado_em?: string
          candidatos?: Json | null
          casamento?: string | null
          chave: string
          chave_fiscal?: string | null
          cnpj?: string | null
          competencia?: string | null
          conferencia?: string | null
          conferido_em?: string | null
          confianca?: string | null
          copia_de?: number | null
          detalhe?: string | null
          diz_anexado?: boolean
          documento?: string | null
          drive_id?: string | null
          enviado_em?: string | null
          enviado_erp_em?: string | null
          erp_anexos?: number | null
          erro_erp?: string | null
          fila_erp?: boolean
          fonte: string
          forma_pagamento?: string | null
          id?: never
          ignorado_em?: string | null
          ignorado_motivo?: string | null
          leitura_erro?: string | null
          lido_do_arquivo_em?: string | null
          linha?: number | null
          link: string
          link_documento?: string | null
          moeda?: string | null
          nao_casou_em?: string | null
          nao_casou_motivo?: string | null
          nao_casou_por?: string | null
          nome?: string | null
          o_que_e?: string | null
          ordem?: number
          parece_nota?: boolean | null
          status_planilha?: string | null
          sugestao_em?: string | null
          sugestao_ia?: Json | null
          tem_arquivo?: boolean
          tipo_documento?: string | null
          valor?: number | null
          valor_moeda?: number | null
          valor_parcela?: number | null
          vencimento?: string | null
          visto_em?: string
        }
        Update: {
          alvo_decidido_por?: string | null
          alvo_id_unico?: string | null
          alvo_manual?: boolean
          alvo_tipo?: string | null
          arquivo_bucket?: string | null
          arquivo_bytes?: number | null
          arquivo_em?: string | null
          arquivo_erro?: string | null
          atualizado_em?: string
          candidatos?: Json | null
          casamento?: string | null
          chave?: string
          chave_fiscal?: string | null
          cnpj?: string | null
          competencia?: string | null
          conferencia?: string | null
          conferido_em?: string | null
          confianca?: string | null
          copia_de?: number | null
          detalhe?: string | null
          diz_anexado?: boolean
          documento?: string | null
          drive_id?: string | null
          enviado_em?: string | null
          enviado_erp_em?: string | null
          erp_anexos?: number | null
          erro_erp?: string | null
          fila_erp?: boolean
          fonte?: string
          forma_pagamento?: string | null
          id?: never
          ignorado_em?: string | null
          ignorado_motivo?: string | null
          leitura_erro?: string | null
          lido_do_arquivo_em?: string | null
          linha?: number | null
          link?: string
          link_documento?: string | null
          moeda?: string | null
          nao_casou_em?: string | null
          nao_casou_motivo?: string | null
          nao_casou_por?: string | null
          nome?: string | null
          o_que_e?: string | null
          ordem?: number
          parece_nota?: boolean | null
          status_planilha?: string | null
          sugestao_em?: string | null
          sugestao_ia?: Json | null
          tem_arquivo?: boolean
          tipo_documento?: string | null
          valor?: number | null
          valor_moeda?: number | null
          valor_parcela?: number | null
          vencimento?: string | null
          visto_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "notas_externas_copia_de_fkey"
            columns: ["copia_de"]
            isOneToOne: false
            referencedRelation: "notas_externas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_externas_copia_de_fkey"
            columns: ["copia_de"]
            isOneToOne: false
            referencedRelation: "notas_externas_parada"
            referencedColumns: ["id"]
          },
        ]
      }
      notas_janela_erp: {
        Row: {
          atualizado_em: string
          id: number
          inicio: string | null
          titulos: number | null
        }
        Insert: {
          atualizado_em?: string
          id?: number
          inicio?: string | null
          titulos?: number | null
        }
        Update: {
          atualizado_em?: string
          id?: number
          inicio?: string | null
          titulos?: number | null
        }
        Relationships: []
      }
      obra_match: {
        Row: {
          anexo_classe: string | null
          anexos: number | null
          categoria_codigo: string | null
          cod_titulo: number | null
          confianca: string | null
          data_titulo: string | null
          dif_dias: number | null
          dif_valor: number | null
          eh_cartao: boolean | null
          escolhido: boolean | null
          favorecido: string | null
          motivo: string | null
          n: number | null
          prio: number | null
          regra: string | null
          sim_nome: number | null
          valor_bate: boolean | null
          valor_titulo: number | null
          veredito: string | null
        }
        Insert: {
          anexo_classe?: string | null
          anexos?: number | null
          categoria_codigo?: string | null
          cod_titulo?: number | null
          confianca?: string | null
          data_titulo?: string | null
          dif_dias?: number | null
          dif_valor?: number | null
          eh_cartao?: boolean | null
          escolhido?: boolean | null
          favorecido?: string | null
          motivo?: string | null
          n?: number | null
          prio?: number | null
          regra?: string | null
          sim_nome?: number | null
          valor_bate?: boolean | null
          valor_titulo?: number | null
          veredito?: string | null
        }
        Update: {
          anexo_classe?: string | null
          anexos?: number | null
          categoria_codigo?: string | null
          cod_titulo?: number | null
          confianca?: string | null
          data_titulo?: string | null
          dif_dias?: number | null
          dif_valor?: number | null
          eh_cartao?: boolean | null
          escolhido?: boolean | null
          favorecido?: string | null
          motivo?: string | null
          n?: number | null
          prio?: number | null
          regra?: string | null
          sim_nome?: number | null
          valor_bate?: boolean | null
          valor_titulo?: number | null
          veredito?: string | null
        }
        Relationships: []
      }
      obra_notas_stage: {
        Row: {
          bytes: number | null
          chave_fiscal: string | null
          cnpj: string | null
          copia_de: string | null
          data: string | null
          drive_id: string | null
          drive_nome: string | null
          drive_regra: string | null
          emitente: string | null
          lido_por: string | null
          n: number
          pasta_mes: string | null
          rel: string | null
          tipo: string | null
          valor: number | null
        }
        Insert: {
          bytes?: number | null
          chave_fiscal?: string | null
          cnpj?: string | null
          copia_de?: string | null
          data?: string | null
          drive_id?: string | null
          drive_nome?: string | null
          drive_regra?: string | null
          emitente?: string | null
          lido_por?: string | null
          n: number
          pasta_mes?: string | null
          rel?: string | null
          tipo?: string | null
          valor?: number | null
        }
        Update: {
          bytes?: number | null
          chave_fiscal?: string | null
          cnpj?: string | null
          copia_de?: string | null
          data?: string | null
          drive_id?: string | null
          drive_nome?: string | null
          drive_regra?: string | null
          emitente?: string | null
          lido_por?: string | null
          n?: number
          pasta_mes?: string | null
          rel?: string | null
          tipo?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      omie_anexo_envio_log: {
        Row: {
          arquivo: string | null
          canal: string | null
          cod_titulo: string | null
          criado_em: string
          id: number
          motivo: string | null
          origem: string
          ref_id: string
          resultado: string
          rotulo: string | null
        }
        Insert: {
          arquivo?: string | null
          canal?: string | null
          cod_titulo?: string | null
          criado_em?: string
          id?: number
          motivo?: string | null
          origem: string
          ref_id: string
          resultado: string
          rotulo?: string | null
        }
        Update: {
          arquivo?: string | null
          canal?: string | null
          cod_titulo?: string | null
          criado_em?: string
          id?: number
          motivo?: string | null
          origem?: string
          ref_id?: string
          resultado?: string
          rotulo?: string | null
        }
        Relationships: []
      }
      omie_anexo_link: {
        Row: {
          cod_titulo: number
          expira_em: string
          id_anexo: string
          lido_em: string
          nome: string | null
          tipo: string | null
          url: string
        }
        Insert: {
          cod_titulo: number
          expira_em: string
          id_anexo?: string
          lido_em?: string
          nome?: string | null
          tipo?: string | null
          url: string
        }
        Update: {
          cod_titulo?: number
          expira_em?: string
          id_anexo?: string
          lido_em?: string
          nome?: string | null
          tipo?: string | null
          url?: string
        }
        Relationships: []
      }
      omie_cache: {
        Row: {
          atualizado_em: string
          chave: string
          dados: Json
          registros: number | null
        }
        Insert: {
          atualizado_em?: string
          chave: string
          dados: Json
          registros?: number | null
        }
        Update: {
          atualizado_em?: string
          chave?: string
          dados?: Json
          registros?: number | null
        }
        Relationships: []
      }
      omie_caixa_conta: {
        Row: {
          atualizado_em: string
          banco: string | null
          id: number
          incluir: boolean
          ncodcc: string
          nome: string | null
          nome_exibicao: string | null
          ordem: number
          saldo: number
          saldo_inicial: number
          subtitulo: string | null
        }
        Insert: {
          atualizado_em?: string
          banco?: string | null
          id?: never
          incluir?: boolean
          ncodcc: string
          nome?: string | null
          nome_exibicao?: string | null
          ordem?: number
          saldo?: number
          saldo_inicial?: number
          subtitulo?: string | null
        }
        Update: {
          atualizado_em?: string
          banco?: string | null
          id?: never
          incluir?: boolean
          ncodcc?: string
          nome?: string | null
          nome_exibicao?: string | null
          ordem?: number
          saldo?: number
          saldo_inicial?: number
          subtitulo?: string | null
        }
        Relationships: []
      }
      omie_caixa_snapshot: {
        Row: {
          criado_em: string
          dados: Json
          gerado_em: string
          id: number
          sincronizado_em: string | null
        }
        Insert: {
          criado_em?: string
          dados: Json
          gerado_em?: string
          id?: never
          sincronizado_em?: string | null
        }
        Update: {
          criado_em?: string
          dados?: Json
          gerado_em?: string
          id?: never
          sincronizado_em?: string | null
        }
        Relationships: []
      }
      omie_capital_giro_snapshot: {
        Row: {
          criado_em: string
          dados: Json
          gerado_em: string
          id: number
          sincronizado_em: string | null
        }
        Insert: {
          criado_em?: string
          dados: Json
          gerado_em?: string
          id?: never
          sincronizado_em?: string | null
        }
        Update: {
          criado_em?: string
          dados?: Json
          gerado_em?: string
          id?: never
          sincronizado_em?: string | null
        }
        Relationships: []
      }
      omie_categoria_alteracoes: {
        Row: {
          alterado_por: string | null
          alterado_por_email: string | null
          categoria_de: string | null
          categoria_para: string | null
          cod_titulo: string
          contraparte: string | null
          criado_em: string
          data: string | null
          descricao_de: string | null
          descricao_para: string | null
          documento: string | null
          grupo: string | null
          id: string
          mes: string | null
          motivo: string | null
          origem: string | null
          rubrica_dfc_de: string | null
          rubrica_dfc_para: string | null
          rubrica_dre_de: string | null
          rubrica_dre_para: string | null
          valor: number | null
        }
        Insert: {
          alterado_por?: string | null
          alterado_por_email?: string | null
          categoria_de?: string | null
          categoria_para?: string | null
          cod_titulo: string
          contraparte?: string | null
          criado_em?: string
          data?: string | null
          descricao_de?: string | null
          descricao_para?: string | null
          documento?: string | null
          grupo?: string | null
          id?: string
          mes?: string | null
          motivo?: string | null
          origem?: string | null
          rubrica_dfc_de?: string | null
          rubrica_dfc_para?: string | null
          rubrica_dre_de?: string | null
          rubrica_dre_para?: string | null
          valor?: number | null
        }
        Update: {
          alterado_por?: string | null
          alterado_por_email?: string | null
          categoria_de?: string | null
          categoria_para?: string | null
          cod_titulo?: string
          contraparte?: string | null
          criado_em?: string
          data?: string | null
          descricao_de?: string | null
          descricao_para?: string | null
          documento?: string | null
          grupo?: string | null
          id?: string
          mes?: string | null
          motivo?: string | null
          origem?: string | null
          rubrica_dfc_de?: string | null
          rubrica_dfc_para?: string | null
          rubrica_dre_de?: string | null
          rubrica_dre_para?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      omie_categoria_regra: {
        Row: {
          atualizado_em: string
          codigo: string
          definido_por: string | null
          descricao: string | null
          motivo: string | null
          origem: string
          regra: string
        }
        Insert: {
          atualizado_em?: string
          codigo: string
          definido_por?: string | null
          descricao?: string | null
          motivo?: string | null
          origem?: string
          regra?: string
        }
        Update: {
          atualizado_em?: string
          codigo?: string
          definido_por?: string | null
          descricao?: string | null
          motivo?: string | null
          origem?: string
          regra?: string
        }
        Relationships: []
      }
      omie_clientes_criados: {
        Row: {
          atualizado_em: string
          criado_em: string
          doc: string
          fonte_endereco: string | null
          id_asaas: string | null
          motivo: string | null
          n_cod_cli: number | null
          nome: string | null
          origem: string | null
          payload: Json | null
          situacao: string
          tentativas: number
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          doc: string
          fonte_endereco?: string | null
          id_asaas?: string | null
          motivo?: string | null
          n_cod_cli?: number | null
          nome?: string | null
          origem?: string | null
          payload?: Json | null
          situacao: string
          tentativas?: number
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          doc?: string
          fonte_endereco?: string | null
          id_asaas?: string | null
          motivo?: string | null
          n_cod_cli?: number | null
          nome?: string | null
          origem?: string | null
          payload?: Json | null
          situacao?: string
          tentativas?: number
        }
        Relationships: []
      }
      omie_clientes_endereco: {
        Row: {
          bairro: string | null
          cep: string | null
          cep_generico: boolean | null
          cidade: string | null
          cnpj_cpf: string | null
          codigo: number
          complemento: string | null
          email: string | null
          emitivel: boolean | null
          endereco: string | null
          endereco_numero: string | null
          estado: string | null
          lido_em: string
          nome: string | null
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cep_generico?: boolean | null
          cidade?: string | null
          cnpj_cpf?: string | null
          codigo: number
          complemento?: string | null
          email?: string | null
          emitivel?: boolean | null
          endereco?: string | null
          endereco_numero?: string | null
          estado?: string | null
          lido_em?: string
          nome?: string | null
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cep_generico?: boolean | null
          cidade?: string | null
          cnpj_cpf?: string | null
          codigo?: number
          complemento?: string | null
          email?: string | null
          emitivel?: boolean | null
          endereco?: string | null
          endereco_numero?: string | null
          estado?: string | null
          lido_em?: string
          nome?: string | null
        }
        Relationships: []
      }
      omie_clientes_endereco_cursor: {
        Row: {
          atualizado_em: string
          concluido_em: string | null
          id: number
          pagina: number
          total_paginas: number | null
        }
        Insert: {
          atualizado_em?: string
          concluido_em?: string | null
          id?: number
          pagina?: number
          total_paginas?: number | null
        }
        Update: {
          atualizado_em?: string
          concluido_em?: string | null
          id?: number
          pagina?: number
          total_paginas?: number | null
        }
        Relationships: []
      }
      omie_dre_mapa: {
        Row: {
          ativo: boolean
          codigo_categoria: string
          created_at: string
          demonstrativo: string
          descricao_categoria: string | null
          id: string
          rubrica: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo_categoria: string
          created_at?: string
          demonstrativo?: string
          descricao_categoria?: string | null
          id?: string
          rubrica: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo_categoria?: string
          created_at?: string
          demonstrativo?: string
          descricao_categoria?: string | null
          id?: string
          rubrica?: string
          updated_at?: string
        }
        Relationships: []
      }
      omie_parcela_anexo: {
        Row: {
          anexado_em: string | null
          cod_titulo: number
          cod_titulo_origem: number
          confianca: string
          created_at: string
          decidido_em: string | null
          decidido_por: string | null
          erro: string | null
          id: number
          motivo: string
          origem: string
          parcela: string | null
          status: string
        }
        Insert: {
          anexado_em?: string | null
          cod_titulo: number
          cod_titulo_origem: number
          confianca: string
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          erro?: string | null
          id?: number
          motivo: string
          origem: string
          parcela?: string | null
          status?: string
        }
        Update: {
          anexado_em?: string | null
          cod_titulo?: number
          cod_titulo_origem?: number
          confianca?: string
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          erro?: string | null
          id?: number
          motivo?: string
          origem?: string
          parcela?: string | null
          status?: string
        }
        Relationships: []
      }
      omie_reclassificacoes: {
        Row: {
          atualizado_em: string
          cnpj_cpf: string | null
          cod_titulo: string
          data: string | null
          decidido_em: string | null
          decidido_por: string | null
          detectado_em: string
          fornecedor: string | null
          fornecedor_chave: string
          hist_lancamentos: number | null
          hist_no_padrao: number | null
          hist_rubricas: number | null
          id: string
          ignorado_em: string | null
          ignorado_motivo: string | null
          ignorado_por: string | null
          mes: string
          regra_id: string | null
          rubrica: string
          rubrica_final: string | null
          rubrica_padrao: string
          severidade: string
          status: string
          tipo: string
          valor: number | null
          valor_padrao: number | null
          virou_regra: boolean
        }
        Insert: {
          atualizado_em?: string
          cnpj_cpf?: string | null
          cod_titulo: string
          data?: string | null
          decidido_em?: string | null
          decidido_por?: string | null
          detectado_em?: string
          fornecedor?: string | null
          fornecedor_chave: string
          hist_lancamentos?: number | null
          hist_no_padrao?: number | null
          hist_rubricas?: number | null
          id?: string
          ignorado_em?: string | null
          ignorado_motivo?: string | null
          ignorado_por?: string | null
          mes: string
          regra_id?: string | null
          rubrica: string
          rubrica_final?: string | null
          rubrica_padrao: string
          severidade: string
          status?: string
          tipo: string
          valor?: number | null
          valor_padrao?: number | null
          virou_regra?: boolean
        }
        Update: {
          atualizado_em?: string
          cnpj_cpf?: string | null
          cod_titulo?: string
          data?: string | null
          decidido_em?: string | null
          decidido_por?: string | null
          detectado_em?: string
          fornecedor?: string | null
          fornecedor_chave?: string
          hist_lancamentos?: number | null
          hist_no_padrao?: number | null
          hist_rubricas?: number | null
          id?: string
          ignorado_em?: string | null
          ignorado_motivo?: string | null
          ignorado_por?: string | null
          mes?: string
          regra_id?: string | null
          rubrica?: string
          rubrica_final?: string | null
          rubrica_padrao?: string
          severidade?: string
          status?: string
          tipo?: string
          valor?: number | null
          valor_padrao?: number | null
          virou_regra?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "omie_reclassificacoes_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omie_reclassificacoes_regra_id_fkey"
            columns: ["regra_id"]
            isOneToOne: false
            referencedRelation: "regras_decisao"
            referencedColumns: ["id"]
          },
        ]
      }
      omie_reclassificacoes_regras: {
        Row: {
          criado_em: string
          criado_por: string | null
          fornecedor: string | null
          fornecedor_chave: string
          id: string
          motivo: string | null
          rubrica_a: string
          rubrica_b: string
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          fornecedor?: string | null
          fornecedor_chave: string
          id?: string
          motivo?: string | null
          rubrica_a: string
          rubrica_b: string
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          fornecedor?: string | null
          fornecedor_chave?: string
          id?: string
          motivo?: string | null
          rubrica_a?: string
          rubrica_b?: string
        }
        Relationships: []
      }
      omie_sync_log: {
        Row: {
          categorias: number
          concluido_em: string | null
          dfc_linhas: number
          dre_linhas: number
          erro: string | null
          id: string
          iniciado_em: string
          movimentos: number
          nao_mapeadas: number
          periodo_ate: string | null
          periodo_de: string | null
          status: string
        }
        Insert: {
          categorias?: number
          concluido_em?: string | null
          dfc_linhas?: number
          dre_linhas?: number
          erro?: string | null
          id?: string
          iniciado_em?: string
          movimentos?: number
          nao_mapeadas?: number
          periodo_ate?: string | null
          periodo_de?: string | null
          status?: string
        }
        Update: {
          categorias?: number
          concluido_em?: string | null
          dfc_linhas?: number
          dre_linhas?: number
          erro?: string | null
          id?: string
          iniciado_em?: string
          movimentos?: number
          nao_mapeadas?: number
          periodo_ate?: string | null
          periodo_de?: string | null
          status?: string
        }
        Relationships: []
      }
      omie_titulo_anexo: {
        Row: {
          anexos: Json
          c_tabela: string | null
          classe: string | null
          cod_titulo: number
          erro: string | null
          ia_arquivo: string | null
          ia_conferido_em: string | null
          ia_leitura: Json | null
          ia_motivo: string | null
          ia_veredito: string | null
          lido_em: string
          parece_nota: boolean | null
          qtd: number
          retentar: boolean
          revisado_em: string | null
          revisado_por: string | null
          revisao: string | null
          virou_nota_em: string | null
        }
        Insert: {
          anexos?: Json
          c_tabela?: string | null
          classe?: string | null
          cod_titulo: number
          erro?: string | null
          ia_arquivo?: string | null
          ia_conferido_em?: string | null
          ia_leitura?: Json | null
          ia_motivo?: string | null
          ia_veredito?: string | null
          lido_em?: string
          parece_nota?: boolean | null
          qtd?: number
          retentar?: boolean
          revisado_em?: string | null
          revisado_por?: string | null
          revisao?: string | null
          virou_nota_em?: string | null
        }
        Update: {
          anexos?: Json
          c_tabela?: string | null
          classe?: string | null
          cod_titulo?: number
          erro?: string | null
          ia_arquivo?: string | null
          ia_conferido_em?: string | null
          ia_leitura?: Json | null
          ia_motivo?: string | null
          ia_veredito?: string | null
          lido_em?: string
          parece_nota?: boolean | null
          qtd?: number
          retentar?: boolean
          revisado_em?: string | null
          revisado_por?: string | null
          revisao?: string | null
          virou_nota_em?: string | null
        }
        Relationships: []
      }
      omie_titulo_nome_cartao: {
        Row: {
          atualizado_em: string
          cod_titulo: number
          documento: string | null
          erro: string | null
          escrito_em: string | null
          lojista: string | null
          origem: string | null
          tentativas: number
        }
        Insert: {
          atualizado_em?: string
          cod_titulo: number
          documento?: string | null
          erro?: string | null
          escrito_em?: string | null
          lojista?: string | null
          origem?: string | null
          tentativas?: number
        }
        Update: {
          atualizado_em?: string
          cod_titulo?: number
          documento?: string | null
          erro?: string | null
          escrito_em?: string | null
          lojista?: string | null
          origem?: string | null
          tentativas?: number
        }
        Relationships: []
      }
      omie_titulo_texto: {
        Row: {
          cod_titulo: number
          documento: string | null
          favorecido: string | null
          lido_em: string
          nota_fiscal: string | null
          observacao: string | null
        }
        Insert: {
          cod_titulo: number
          documento?: string | null
          favorecido?: string | null
          lido_em?: string
          nota_fiscal?: string | null
          observacao?: string | null
        }
        Update: {
          cod_titulo?: number
          documento?: string | null
          favorecido?: string | null
          lido_em?: string
          nota_fiscal?: string | null
          observacao?: string | null
        }
        Relationships: []
      }
      omie_titulos: {
        Row: {
          atualizado_em: string
          categoria_codigo: string | null
          centro_custo_id: string | null
          cod_titulo: number
          competencia: string | null
          criado_em: string
          data_emissao: string | null
          data_pagamento: string | null
          departamento_id: string | null
          documento_norm: string | null
          favorecido_texto: string | null
          fornecedor_id: string | null
          nota_fiscal: string | null
          numero_documento: string | null
          observacao: string | null
          origem_lancamento: string | null
          sincronizado_em: string
          status: string | null
          tipo: string
          valor: number
          valor_pago: number | null
          vencimento: string | null
        }
        Insert: {
          atualizado_em?: string
          categoria_codigo?: string | null
          centro_custo_id?: string | null
          cod_titulo: number
          competencia?: string | null
          criado_em?: string
          data_emissao?: string | null
          data_pagamento?: string | null
          departamento_id?: string | null
          documento_norm?: string | null
          favorecido_texto?: string | null
          fornecedor_id?: string | null
          nota_fiscal?: string | null
          numero_documento?: string | null
          observacao?: string | null
          origem_lancamento?: string | null
          sincronizado_em?: string
          status?: string | null
          tipo: string
          valor: number
          valor_pago?: number | null
          vencimento?: string | null
        }
        Update: {
          atualizado_em?: string
          categoria_codigo?: string | null
          centro_custo_id?: string | null
          cod_titulo?: number
          competencia?: string | null
          criado_em?: string
          data_emissao?: string | null
          data_pagamento?: string | null
          departamento_id?: string | null
          documento_norm?: string | null
          favorecido_texto?: string | null
          fornecedor_id?: string | null
          nota_fiscal?: string | null
          numero_documento?: string | null
          observacao?: string | null
          origem_lancamento?: string | null
          sincronizado_em?: string
          status?: string | null
          tipo?: string
          valor?: number
          valor_pago?: number | null
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "omie_titulos_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "lib_centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omie_titulos_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "lib_departamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omie_titulos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "lib_fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_area_linha: {
        Row: {
          ano: number
          area: string
          atualizado_em: string
          fonte: string | null
          id: number
          mes: number
          omie_sincronizado_em: string | null
          orcado: number
          pessoal: boolean
          realizado: number
          realizado_omie: number | null
          subcategoria: string
        }
        Insert: {
          ano: number
          area: string
          atualizado_em?: string
          fonte?: string | null
          id?: never
          mes: number
          omie_sincronizado_em?: string | null
          orcado?: number
          pessoal?: boolean
          realizado?: number
          realizado_omie?: number | null
          subcategoria: string
        }
        Update: {
          ano?: number
          area?: string
          atualizado_em?: string
          fonte?: string | null
          id?: never
          mes?: number
          omie_sincronizado_em?: string | null
          orcado?: number
          pessoal?: boolean
          realizado?: number
          realizado_omie?: number | null
          subcategoria?: string
        }
        Relationships: []
      }
      orcamento_omie_map: {
        Row: {
          area: string | null
          ativo: boolean
          atualizado_em: string
          descricao_categoria: string
          origem: string
          rubrica: string | null
          subcategoria: string | null
        }
        Insert: {
          area?: string | null
          ativo?: boolean
          atualizado_em?: string
          descricao_categoria: string
          origem?: string
          rubrica?: string | null
          subcategoria?: string | null
        }
        Update: {
          area?: string | null
          ativo?: boolean
          atualizado_em?: string
          descricao_categoria?: string
          origem?: string
          rubrica?: string | null
          subcategoria?: string | null
        }
        Relationships: []
      }
      orcamento_omie_sync_log: {
        Row: {
          ano: number | null
          concluido_em: string | null
          erro: string | null
          id: number
          iniciado_em: string
          linhas_atualizadas: number | null
          movimentos: number | null
          nao_mapeadas: number | null
          status: string
          valor_nao_mapeado: number | null
        }
        Insert: {
          ano?: number | null
          concluido_em?: string | null
          erro?: string | null
          id?: never
          iniciado_em?: string
          linhas_atualizadas?: number | null
          movimentos?: number | null
          nao_mapeadas?: number | null
          status: string
          valor_nao_mapeado?: number | null
        }
        Update: {
          ano?: number | null
          concluido_em?: string | null
          erro?: string | null
          id?: never
          iniciado_em?: string
          linhas_atualizadas?: number | null
          movimentos?: number | null
          nao_mapeadas?: number | null
          status?: string
          valor_nao_mapeado?: number | null
        }
        Relationships: []
      }
      parametrizacao_evidencias: {
        Row: {
          apelido: string | null
          aplicado_em: string | null
          atualizado_em: string
          chave: string
          chave_tipo: string
          confianca: string
          contraparte_nome: string
          contraparte_origem: string
          criado_em: string
          detalhe: string | null
          documento_norm: string | null
          fonte: string
          id: string
          o_que_e: string | null
          ocorrencias: number
        }
        Insert: {
          apelido?: string | null
          aplicado_em?: string | null
          atualizado_em?: string
          chave: string
          chave_tipo: string
          confianca: string
          contraparte_nome: string
          contraparte_origem: string
          criado_em?: string
          detalhe?: string | null
          documento_norm?: string | null
          fonte: string
          id?: string
          o_que_e?: string | null
          ocorrencias?: number
        }
        Update: {
          apelido?: string | null
          aplicado_em?: string | null
          atualizado_em?: string
          chave?: string
          chave_tipo?: string
          confianca?: string
          contraparte_nome?: string
          contraparte_origem?: string
          criado_em?: string
          detalhe?: string | null
          documento_norm?: string | null
          fonte?: string
          id?: string
          o_que_e?: string | null
          ocorrencias?: number
        }
        Relationships: []
      }
      parceiros_cadastro: {
        Row: {
          bonificacao: boolean
          campanha: string | null
          created_at: string
          id: string
          metodo_bonificacao: string | null
          metodo_recorrencia: string | null
          nome: string
          recorrencia: boolean
          status: string
          tier: string
          updated_at: string
          valor_bonificacao: number | null
          valor_recorrencia: number | null
        }
        Insert: {
          bonificacao?: boolean
          campanha?: string | null
          created_at?: string
          id?: string
          metodo_bonificacao?: string | null
          metodo_recorrencia?: string | null
          nome: string
          recorrencia?: boolean
          status?: string
          tier?: string
          updated_at?: string
          valor_bonificacao?: number | null
          valor_recorrencia?: number | null
        }
        Update: {
          bonificacao?: boolean
          campanha?: string | null
          created_at?: string
          id?: string
          metodo_bonificacao?: string | null
          metodo_recorrencia?: string | null
          nome?: string
          recorrencia?: boolean
          status?: string
          tier?: string
          updated_at?: string
          valor_bonificacao?: number | null
          valor_recorrencia?: number | null
        }
        Relationships: []
      }
      parceiros_campanha_logs: {
        Row: {
          campanha_anterior: string | null
          campanha_nova: string | null
          campo: string | null
          created_at: string
          id: string
          id_negocio: string | null
          indicador: string | null
          nome_negocio: string | null
          registro_id: string
          registro_tabela: string
          user_email: string | null
          user_id: string | null
          valor_anterior: string | null
          valor_novo: string | null
        }
        Insert: {
          campanha_anterior?: string | null
          campanha_nova?: string | null
          campo?: string | null
          created_at?: string
          id?: string
          id_negocio?: string | null
          indicador?: string | null
          nome_negocio?: string | null
          registro_id: string
          registro_tabela: string
          user_email?: string | null
          user_id?: string | null
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Update: {
          campanha_anterior?: string | null
          campanha_nova?: string | null
          campo?: string | null
          created_at?: string
          id?: string
          id_negocio?: string | null
          indicador?: string | null
          nome_negocio?: string | null
          registro_id?: string
          registro_tabela?: string
          user_email?: string | null
          user_id?: string | null
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Relationships: []
      }
      parceiros_indicacoes: {
        Row: {
          asaas_url: string | null
          canal_aquisicao: string | null
          codigo_indicacao: string | null
          created_at: string
          data_indicacao: string | null
          data_venda: string | null
          email_indicador: string | null
          hubspot_url: string | null
          id: string
          id_campanha: string | null
          id_negocio: string
          indicador: string | null
          mrr: number | null
          nome_campanha: string | null
          nome_negocio: string | null
          observacoes: string | null
          origem: string | null
          responsavel_takeat: string | null
          synced_at: string
          valor_total: number | null
          vendedor: string | null
        }
        Insert: {
          asaas_url?: string | null
          canal_aquisicao?: string | null
          codigo_indicacao?: string | null
          created_at?: string
          data_indicacao?: string | null
          data_venda?: string | null
          email_indicador?: string | null
          hubspot_url?: string | null
          id?: string
          id_campanha?: string | null
          id_negocio: string
          indicador?: string | null
          mrr?: number | null
          nome_campanha?: string | null
          nome_negocio?: string | null
          observacoes?: string | null
          origem?: string | null
          responsavel_takeat?: string | null
          synced_at?: string
          valor_total?: number | null
          vendedor?: string | null
        }
        Update: {
          asaas_url?: string | null
          canal_aquisicao?: string | null
          codigo_indicacao?: string | null
          created_at?: string
          data_indicacao?: string | null
          data_venda?: string | null
          email_indicador?: string | null
          hubspot_url?: string | null
          id?: string
          id_campanha?: string | null
          id_negocio?: string
          indicador?: string | null
          mrr?: number | null
          nome_campanha?: string | null
          nome_negocio?: string | null
          observacoes?: string | null
          origem?: string | null
          responsavel_takeat?: string | null
          synced_at?: string
          valor_total?: number | null
          vendedor?: string | null
        }
        Relationships: []
      }
      parceiros_indicacoes_audit: {
        Row: {
          action: string
          created_at: string
          id: string
          id_negocio: string | null
          indicacao_id: string | null
          snapshot: Json | null
          user_email: string | null
          user_id: string | null
          user_nome: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          id_negocio?: string | null
          indicacao_id?: string | null
          snapshot?: Json | null
          user_email?: string | null
          user_id?: string | null
          user_nome?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          id_negocio?: string | null
          indicacao_id?: string | null
          snapshot?: Json | null
          user_email?: string | null
          user_id?: string | null
          user_nome?: string | null
        }
        Relationships: []
      }
      parceiros_recorrencias: {
        Row: {
          asaas_url: string | null
          ativo: boolean
          created_at: string
          data_cancelamento: string | null
          data_indicacao: string | null
          data_venda: string | null
          email_indicador: string | null
          hubspot_url: string | null
          id: string
          id_campanha: string | null
          id_negocio: string | null
          indicador: string | null
          mrr: number | null
          nome_campanha: string | null
          nome_negocio: string | null
          observacoes: string | null
          recorrencia_valor: number | null
          responsavel_takeat: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          asaas_url?: string | null
          ativo?: boolean
          created_at?: string
          data_cancelamento?: string | null
          data_indicacao?: string | null
          data_venda?: string | null
          email_indicador?: string | null
          hubspot_url?: string | null
          id?: string
          id_campanha?: string | null
          id_negocio?: string | null
          indicador?: string | null
          mrr?: number | null
          nome_campanha?: string | null
          nome_negocio?: string | null
          observacoes?: string | null
          recorrencia_valor?: number | null
          responsavel_takeat?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          asaas_url?: string | null
          ativo?: boolean
          created_at?: string
          data_cancelamento?: string | null
          data_indicacao?: string | null
          data_venda?: string | null
          email_indicador?: string | null
          hubspot_url?: string | null
          id?: string
          id_campanha?: string | null
          id_negocio?: string | null
          indicador?: string | null
          mrr?: number | null
          nome_campanha?: string | null
          nome_negocio?: string | null
          observacoes?: string | null
          recorrencia_valor?: number | null
          responsavel_takeat?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      playbook_assets: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          playbook_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          playbook_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          playbook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playbook_assets_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
        ]
      }
      playbook_flows: {
        Row: {
          archived: boolean
          category: string
          created_at: string
          description: string | null
          edges: Json
          id: string
          last_edited_by: string | null
          nodes: Json
          owner_name: string | null
          playbook_id: string | null
          status: string
          title: string
          updated_at: string
          viewport: Json
        }
        Insert: {
          archived?: boolean
          category?: string
          created_at?: string
          description?: string | null
          edges?: Json
          id?: string
          last_edited_by?: string | null
          nodes?: Json
          owner_name?: string | null
          playbook_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          viewport?: Json
        }
        Update: {
          archived?: boolean
          category?: string
          created_at?: string
          description?: string | null
          edges?: Json
          id?: string
          last_edited_by?: string | null
          nodes?: Json
          owner_name?: string | null
          playbook_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          viewport?: Json
        }
        Relationships: []
      }
      playbooks: {
        Row: {
          archived: boolean
          category: string
          content: Json
          created_at: string
          description: string | null
          id: string
          last_edited_by: string | null
          owner_name: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          category?: string
          content?: Json
          created_at?: string
          description?: string | null
          id?: string
          last_edited_by?: string | null
          owner_name?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          category?: string
          content?: Json
          created_at?: string
          description?: string | null
          id?: string
          last_edited_by?: string | null
          owner_name?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          cargo: string | null
          created_at: string
          email: string
          id: string
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cargo?: string | null
          created_at?: string
          email: string
          id?: string
          nome: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cargo?: string | null
          created_at?: string
          email?: string
          id?: string
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projetos: {
        Row: {
          automacao: string
          created_at: string
          descricao_entrega: string | null
          id: string
          observacao: string | null
          ordem: number
          responsavel: string | null
          status: string
          updated_at: string
        }
        Insert: {
          automacao: string
          created_at?: string
          descricao_entrega?: string | null
          id?: string
          observacao?: string | null
          ordem?: number
          responsavel?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          automacao?: string
          created_at?: string
          descricao_entrega?: string | null
          id?: string
          observacao?: string | null
          ordem?: number
          responsavel?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      projetos_aprovados: {
        Row: {
          created_at: string
          data_inicio: string | null
          duracao_meses: number | null
          id: string
          nome: string
          observacao: string | null
          ordem: number
          orgao: string | null
          prazo_final: string | null
          status: string
          updated_at: string
          valor_aprovado: number
          valor_contrapartida: number
        }
        Insert: {
          created_at?: string
          data_inicio?: string | null
          duracao_meses?: number | null
          id?: string
          nome: string
          observacao?: string | null
          ordem?: number
          orgao?: string | null
          prazo_final?: string | null
          status?: string
          updated_at?: string
          valor_aprovado?: number
          valor_contrapartida?: number
        }
        Update: {
          created_at?: string
          data_inicio?: string | null
          duracao_meses?: number | null
          id?: string
          nome?: string
          observacao?: string | null
          ordem?: number
          orgao?: string | null
          prazo_final?: string | null
          status?: string
          updated_at?: string
          valor_aprovado?: number
          valor_contrapartida?: number
        }
        Relationships: []
      }
      projetos_aprovados_compras: {
        Row: {
          created_at: string
          data: string
          descricao: string
          fornecedor: string | null
          id: string
          nf_anexada: boolean
          nf_numero: string | null
          observacao: string | null
          projeto_id: string
          rubrica_id: string
          status: string
          updated_at: string
          valor: number
        }
        Insert: {
          created_at?: string
          data?: string
          descricao: string
          fornecedor?: string | null
          id?: string
          nf_anexada?: boolean
          nf_numero?: string | null
          observacao?: string | null
          projeto_id: string
          rubrica_id: string
          status?: string
          updated_at?: string
          valor?: number
        }
        Update: {
          created_at?: string
          data?: string
          descricao?: string
          fornecedor?: string | null
          id?: string
          nf_anexada?: boolean
          nf_numero?: string | null
          observacao?: string | null
          projeto_id?: string
          rubrica_id?: string
          status?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "projetos_aprovados_compras_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos_aprovados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projetos_aprovados_compras_rubrica_id_fkey"
            columns: ["rubrica_id"]
            isOneToOne: false
            referencedRelation: "projetos_aprovados_rubricas"
            referencedColumns: ["id"]
          },
        ]
      }
      projetos_aprovados_parcelas: {
        Row: {
          created_at: string
          data_prevista: string | null
          data_recebimento: string | null
          descricao: string | null
          id: string
          numero: number
          observacao: string | null
          projeto_id: string
          recebido: boolean
          updated_at: string
          valor: number
        }
        Insert: {
          created_at?: string
          data_prevista?: string | null
          data_recebimento?: string | null
          descricao?: string | null
          id?: string
          numero: number
          observacao?: string | null
          projeto_id: string
          recebido?: boolean
          updated_at?: string
          valor?: number
        }
        Update: {
          created_at?: string
          data_prevista?: string | null
          data_recebimento?: string | null
          descricao?: string | null
          id?: string
          numero?: number
          observacao?: string | null
          projeto_id?: string
          recebido?: boolean
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "projetos_aprovados_parcelas_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos_aprovados"
            referencedColumns: ["id"]
          },
        ]
      }
      projetos_aprovados_rubricas: {
        Row: {
          categoria: string
          created_at: string
          id: string
          obrigatorio: boolean
          observacao: string | null
          ordem: number
          parent_id: string | null
          projeto_id: string
          updated_at: string
          valor_planejado: number
        }
        Insert: {
          categoria: string
          created_at?: string
          id?: string
          obrigatorio?: boolean
          observacao?: string | null
          ordem?: number
          parent_id?: string | null
          projeto_id: string
          updated_at?: string
          valor_planejado?: number
        }
        Update: {
          categoria?: string
          created_at?: string
          id?: string
          obrigatorio?: boolean
          observacao?: string | null
          ordem?: number
          parent_id?: string | null
          projeto_id?: string
          updated_at?: string
          valor_planejado?: number
        }
        Relationships: [
          {
            foreignKeyName: "projetos_aprovados_rubricas_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "projetos_aprovados_rubricas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projetos_aprovados_rubricas_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos_aprovados"
            referencedColumns: ["id"]
          },
        ]
      }
      rc_asaas_finopstkt: {
        Row: {
          billing_type: string | null
          created_at: string | null
          customer: string | null
          data_pagamento: string | null
          id: number
          id_asaas: string | null
          status: string | null
          valor: number | null
        }
        Insert: {
          billing_type?: string | null
          created_at?: string | null
          customer?: string | null
          data_pagamento?: string | null
          id?: number
          id_asaas?: string | null
          status?: string | null
          valor?: number | null
        }
        Update: {
          billing_type?: string | null
          created_at?: string | null
          customer?: string | null
          data_pagamento?: string | null
          id?: number
          id_asaas?: string | null
          status?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      recargas_celulares: {
        Row: {
          created_at: string
          id: string
          numero: string | null
          origem: string | null
          origem_id: string | null
          proprietario: string
          proxima_recarga: string | null
          setor: string | null
          situacao: string | null
          solicitado_em: string | null
          ultima_recarga: string | null
          updated_at: string
          valor: number | null
          verificado: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          numero?: string | null
          origem?: string | null
          origem_id?: string | null
          proprietario: string
          proxima_recarga?: string | null
          setor?: string | null
          situacao?: string | null
          solicitado_em?: string | null
          ultima_recarga?: string | null
          updated_at?: string
          valor?: number | null
          verificado?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          numero?: string | null
          origem?: string | null
          origem_id?: string | null
          proprietario?: string
          proxima_recarga?: string | null
          setor?: string | null
          situacao?: string | null
          solicitado_em?: string | null
          ultima_recarga?: string | null
          updated_at?: string
          valor?: number | null
          verificado?: string | null
        }
        Relationships: []
      }
      recargas_celulares_historico: {
        Row: {
          colaborador: string | null
          created_at: string
          id: string
          linha_id: string
          numero: string | null
          operadora: string | null
          recarregado_em: string
          registrado_por: string | null
          solicitacao_id: string | null
          valor: number
        }
        Insert: {
          colaborador?: string | null
          created_at?: string
          id?: string
          linha_id: string
          numero?: string | null
          operadora?: string | null
          recarregado_em: string
          registrado_por?: string | null
          solicitacao_id?: string | null
          valor?: number
        }
        Update: {
          colaborador?: string | null
          created_at?: string
          id?: string
          linha_id?: string
          numero?: string | null
          operadora?: string | null
          recarregado_em?: string
          registrado_por?: string | null
          solicitacao_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "recargas_celulares_historico_linha_id_fkey"
            columns: ["linha_id"]
            isOneToOne: false
            referencedRelation: "recargas_celulares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recargas_celulares_historico_solicitacao_id_fkey"
            columns: ["solicitacao_id"]
            isOneToOne: false
            referencedRelation: "recargas_celulares_solicitacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      recargas_celulares_solicitacoes: {
        Row: {
          agendada_para: string | null
          callback_em: string | null
          callback_erro: string | null
          callback_status: string | null
          callback_url: string | null
          colaborador: string
          colaborador_email: string | null
          concluido_em: string | null
          concluido_por: string | null
          created_at: string
          id: string
          limite_diario: number | null
          numero: string | null
          operadora: string | null
          origem: string
          origem_id: string
          posicao_do_dia: number | null
          setor: string | null
          solicitado_em: string
          solicitante: string | null
          status: string
          updated_at: string
          valor: number
        }
        Insert: {
          agendada_para?: string | null
          callback_em?: string | null
          callback_erro?: string | null
          callback_status?: string | null
          callback_url?: string | null
          colaborador: string
          colaborador_email?: string | null
          concluido_em?: string | null
          concluido_por?: string | null
          created_at?: string
          id?: string
          limite_diario?: number | null
          numero?: string | null
          operadora?: string | null
          origem?: string
          origem_id: string
          posicao_do_dia?: number | null
          setor?: string | null
          solicitado_em: string
          solicitante?: string | null
          status?: string
          updated_at?: string
          valor?: number
        }
        Update: {
          agendada_para?: string | null
          callback_em?: string | null
          callback_erro?: string | null
          callback_status?: string | null
          callback_url?: string | null
          colaborador?: string
          colaborador_email?: string | null
          concluido_em?: string | null
          concluido_por?: string | null
          created_at?: string
          id?: string
          limite_diario?: number | null
          numero?: string | null
          operadora?: string | null
          origem?: string
          origem_id?: string
          posicao_do_dia?: number | null
          setor?: string | null
          solicitado_em?: string
          solicitante?: string | null
          status?: string
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      recargas_celulares_titulares: {
        Row: {
          ate: string | null
          colaborador: string
          created_at: string
          de: string
          id: string
          linha_id: string
        }
        Insert: {
          ate?: string | null
          colaborador: string
          created_at?: string
          de?: string
          id?: string
          linha_id: string
        }
        Update: {
          ate?: string | null
          colaborador?: string
          created_at?: string
          de?: string
          id?: string
          linha_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recargas_celulares_titulares_linha_id_fkey"
            columns: ["linha_id"]
            isOneToOne: false
            referencedRelation: "recargas_celulares"
            referencedColumns: ["id"]
          },
        ]
      }
      recargas_viagens: {
        Row: {
          created_at: string
          data: string
          id: string
          observacao: string | null
          updated_at: string
          valor_total: number
        }
        Insert: {
          created_at?: string
          data: string
          id?: string
          observacao?: string | null
          updated_at?: string
          valor_total?: number
        }
        Update: {
          created_at?: string
          data?: string
          id?: string
          observacao?: string | null
          updated_at?: string
          valor_total?: number
        }
        Relationships: []
      }
      recargas_viagens_itens: {
        Row: {
          created_at: string
          evento: string | null
          evento_fim: string | null
          evento_inicio: string | null
          id: string
          nome: string
          setor: string | null
          valor: number
          viagem_id: string
        }
        Insert: {
          created_at?: string
          evento?: string | null
          evento_fim?: string | null
          evento_inicio?: string | null
          id?: string
          nome: string
          setor?: string | null
          valor?: number
          viagem_id: string
        }
        Update: {
          created_at?: string
          evento?: string | null
          evento_fim?: string | null
          evento_inicio?: string | null
          id?: string
          nome?: string
          setor?: string | null
          valor?: number
          viagem_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recargas_viagens_itens_viagem_id_fkey"
            columns: ["viagem_id"]
            isOneToOne: false
            referencedRelation: "recargas_viagens"
            referencedColumns: ["id"]
          },
        ]
      }
      recargas_viagens_manuais: {
        Row: {
          colaborador: string
          created_at: string
          created_by: string | null
          data_ida: string | null
          data_volta: string | null
          destino: string
          dias: number
          id: string
          updated_at: string
          valor_total: number
          viagem_hash: string | null
        }
        Insert: {
          colaborador: string
          created_at?: string
          created_by?: string | null
          data_ida?: string | null
          data_volta?: string | null
          destino: string
          dias?: number
          id?: string
          updated_at?: string
          valor_total?: number
          viagem_hash?: string | null
        }
        Update: {
          colaborador?: string
          created_at?: string
          created_by?: string | null
          data_ida?: string | null
          data_volta?: string | null
          destino?: string
          dias?: number
          id?: string
          updated_at?: string
          valor_total?: number
          viagem_hash?: string | null
        }
        Relationships: []
      }
      recargas_viagens_status: {
        Row: {
          status: string
          updated_at: string
          viagem_hash: string
        }
        Insert: {
          status?: string
          updated_at?: string
          viagem_hash: string
        }
        Update: {
          status?: string
          updated_at?: string
          viagem_hash?: string
        }
        Relationships: []
      }
      receitas_asaas: {
        Row: {
          billing_type: string | null
          created_at: string | null
          customer: string | null
          data_pagamento: string | null
          id: number
          id_asaas: string | null
          status: string | null
          valor: number | null
        }
        Insert: {
          billing_type?: string | null
          created_at?: string | null
          customer?: string | null
          data_pagamento?: string | null
          id?: number
          id_asaas?: string | null
          status?: string | null
          valor?: number | null
        }
        Update: {
          billing_type?: string | null
          created_at?: string | null
          customer?: string | null
          data_pagamento?: string | null
          id?: number
          id_asaas?: string | null
          status?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      receitas_caixa_asaas: {
        Row: {
          billing_type: string | null
          created_at: string | null
          customer: string | null
          data_pagamento: string | null
          id: number
          id_asaas: string | null
          status: string | null
          valor: number | null
        }
        Insert: {
          billing_type?: string | null
          created_at?: string | null
          customer?: string | null
          data_pagamento?: string | null
          id?: number
          id_asaas?: string | null
          status?: string | null
          valor?: number | null
        }
        Update: {
          billing_type?: string | null
          created_at?: string | null
          customer?: string | null
          data_pagamento?: string | null
          id?: number
          id_asaas?: string | null
          status?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      regras_decisao: {
        Row: {
          acao: Json
          acerto: number | null
          alcada_resultante: string
          ativa: boolean
          atualizado_em: string
          condicao: Json
          confianca_minima: number
          criada_por: string | null
          criado_em: string
          descricao: string | null
          escopo: string
          fornecedor_id: string | null
          id: string
          n_aplicacoes: number
          n_corrigidas: number
          nome: string
          origem: string
          prioridade: number
          versao: number
        }
        Insert: {
          acao?: Json
          acerto?: number | null
          alcada_resultante?: string
          ativa?: boolean
          atualizado_em?: string
          condicao?: Json
          confianca_minima?: number
          criada_por?: string | null
          criado_em?: string
          descricao?: string | null
          escopo: string
          fornecedor_id?: string | null
          id?: string
          n_aplicacoes?: number
          n_corrigidas?: number
          nome: string
          origem?: string
          prioridade?: number
          versao?: number
        }
        Update: {
          acao?: Json
          acerto?: number | null
          alcada_resultante?: string
          ativa?: boolean
          atualizado_em?: string
          condicao?: Json
          confianca_minima?: number
          criada_por?: string | null
          criado_em?: string
          descricao?: string | null
          escopo?: string
          fornecedor_id?: string | null
          id?: string
          n_aplicacoes?: number
          n_corrigidas?: number
          nome?: string
          origem?: string
          prioridade?: number
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "regras_decisao_criada_por_fkey"
            columns: ["criada_por"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regras_decisao_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "lib_fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      rescisoes: {
        Row: {
          admissao: string | null
          alertas: Json
          arquivo: string | null
          atualizado_em: string
          aviso_dias: number | null
          aviso_em: string | null
          aviso_previo: string | null
          calculado_em: string | null
          cargo: string | null
          centro_custo: string | null
          chave: string
          colaborador: string
          colaborador_id: string | null
          cpf: string | null
          custo_empresa: number | null
          data_pagamento: string | null
          data_pagamento_prevista: string | null
          departamento: string | null
          desligamento: string
          dias_ferias_tirados: number | null
          dias_mes_saida: number | null
          dias_trabalhados_mes: number | null
          encargos: number | null
          fgts_base_multa: number | null
          fgts_multa: number | null
          fgts_recolher: number | null
          flash_mensal: number | null
          fonte: string | null
          fonte_remuneracao: string | null
          fontes: Json
          id: string
          liquido: number
          matricula: string | null
          memoria_md: string | null
          meses_trabalhados: number | null
          motivo: string
          motivo_texto: string | null
          observacao: string | null
          registrado_em: string
          registrado_por: string | null
          salario_base: number | null
          situacao: string
          skill_versao: string | null
          texto_resposta: string | null
          tipo_desligamento: string | null
          total_descontos: number
          total_proventos: number
          vinculo: string
        }
        Insert: {
          admissao?: string | null
          alertas?: Json
          arquivo?: string | null
          atualizado_em?: string
          aviso_dias?: number | null
          aviso_em?: string | null
          aviso_previo?: string | null
          calculado_em?: string | null
          cargo?: string | null
          centro_custo?: string | null
          chave: string
          colaborador: string
          colaborador_id?: string | null
          cpf?: string | null
          custo_empresa?: number | null
          data_pagamento?: string | null
          data_pagamento_prevista?: string | null
          departamento?: string | null
          desligamento: string
          dias_ferias_tirados?: number | null
          dias_mes_saida?: number | null
          dias_trabalhados_mes?: number | null
          encargos?: number | null
          fgts_base_multa?: number | null
          fgts_multa?: number | null
          fgts_recolher?: number | null
          flash_mensal?: number | null
          fonte?: string | null
          fonte_remuneracao?: string | null
          fontes?: Json
          id?: string
          liquido?: number
          matricula?: string | null
          memoria_md?: string | null
          meses_trabalhados?: number | null
          motivo: string
          motivo_texto?: string | null
          observacao?: string | null
          registrado_em?: string
          registrado_por?: string | null
          salario_base?: number | null
          situacao?: string
          skill_versao?: string | null
          texto_resposta?: string | null
          tipo_desligamento?: string | null
          total_descontos?: number
          total_proventos?: number
          vinculo?: string
        }
        Update: {
          admissao?: string | null
          alertas?: Json
          arquivo?: string | null
          atualizado_em?: string
          aviso_dias?: number | null
          aviso_em?: string | null
          aviso_previo?: string | null
          calculado_em?: string | null
          cargo?: string | null
          centro_custo?: string | null
          chave?: string
          colaborador?: string
          colaborador_id?: string | null
          cpf?: string | null
          custo_empresa?: number | null
          data_pagamento?: string | null
          data_pagamento_prevista?: string | null
          departamento?: string | null
          desligamento?: string
          dias_ferias_tirados?: number | null
          dias_mes_saida?: number | null
          dias_trabalhados_mes?: number | null
          encargos?: number | null
          fgts_base_multa?: number | null
          fgts_multa?: number | null
          fgts_recolher?: number | null
          flash_mensal?: number | null
          fonte?: string | null
          fonte_remuneracao?: string | null
          fontes?: Json
          id?: string
          liquido?: number
          matricula?: string | null
          memoria_md?: string | null
          meses_trabalhados?: number | null
          motivo?: string
          motivo_texto?: string | null
          observacao?: string | null
          registrado_em?: string
          registrado_por?: string | null
          salario_base?: number | null
          situacao?: string
          skill_versao?: string | null
          texto_resposta?: string | null
          tipo_desligamento?: string | null
          total_descontos?: number
          total_proventos?: number
          vinculo?: string
        }
        Relationships: [
          {
            foreignKeyName: "rescisoes_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "lib_colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      rescisoes_verbas: {
        Row: {
          base: number | null
          formula: string | null
          fundamento: string | null
          id: string
          incide_fgts: boolean | null
          incide_inss: boolean | null
          incide_irrf: boolean | null
          ordem: number
          referencia: string | null
          rescisao_id: string
          rubrica: string
          tipo: string
          valor: number
        }
        Insert: {
          base?: number | null
          formula?: string | null
          fundamento?: string | null
          id?: string
          incide_fgts?: boolean | null
          incide_inss?: boolean | null
          incide_irrf?: boolean | null
          ordem?: number
          referencia?: string | null
          rescisao_id: string
          rubrica: string
          tipo: string
          valor: number
        }
        Update: {
          base?: number | null
          formula?: string | null
          fundamento?: string | null
          id?: string
          incide_fgts?: boolean | null
          incide_inss?: boolean | null
          incide_irrf?: boolean | null
          ordem?: number
          referencia?: string | null
          rescisao_id?: string
          rubrica?: string
          tipo?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "rescisoes_verbas_rescisao_id_fkey"
            columns: ["rescisao_id"]
            isOneToOne: false
            referencedRelation: "rescisoes"
            referencedColumns: ["id"]
          },
        ]
      }
      resumo_tarefas_semana: {
        Row: {
          gerado_em: string
          id: string
          leitura_gerado_em: string | null
          leitura_md: string | null
          payload: Json
          semana_fim: string
          semana_inicio: string
          total_concluidas: number | null
        }
        Insert: {
          gerado_em?: string
          id?: string
          leitura_gerado_em?: string | null
          leitura_md?: string | null
          payload?: Json
          semana_fim: string
          semana_inicio: string
          total_concluidas?: number | null
        }
        Update: {
          gerado_em?: string
          id?: string
          leitura_gerado_em?: string | null
          leitura_md?: string | null
          payload?: Json
          semana_fim?: string
          semana_inicio?: string
          total_concluidas?: number | null
        }
        Relationships: []
      }
      rh_colaboradores: {
        Row: {
          aditivo_alteracao_escopo: boolean | null
          aditivo_atividades: string | null
          aditivo_denominacao: string | null
          aditivo_novo_cargo: string | null
          aditivo_novo_valor: number | null
          aditivo_vigencia: string | null
          agencia: string | null
          bairro: string | null
          banco: string | null
          camisa: string | null
          cargo: string | null
          cep: string | null
          cidade: string | null
          cnpj: string | null
          codbanco: string | null
          codigo: string | null
          complemento: string | null
          conta: string | null
          contrato_enviado_em: string | null
          cpf: string | null
          created_at: string | null
          datadesl: string | null
          descricao_funcao: string | null
          digito: string | null
          emailcorp: string | null
          emailpessoal: string | null
          emergencia_nome: string | null
          emergencia_parentesco: string | null
          emergencia_whatsapp: string | null
          estado: string | null
          estadocivil: string | null
          flash: number | null
          foto_url: string | null
          genero: string | null
          gestor_id: string | null
          id: string
          inicio: string | null
          logradouro: string | null
          min_garantido_m1: number | null
          min_garantido_m2: number | null
          min_garantido_m3: number | null
          modalidade: string | null
          modelo_remuneracao: string | null
          motivodesl: string | null
          nascimento: string | null
          naturalidade: string | null
          nome: string | null
          numero: string | null
          obs: string | null
          obsdesl: string | null
          pix: string | null
          razao: string | null
          rg: string | null
          setor: string | null
          synced_at: string
          tipodesl: string | null
          totalpass: string | null
          trabalho: string | null
          updated_at: string | null
          valor: number | null
          valor_liberalidade: number | null
          vence: string | null
          whatsapp: string | null
          whatsappcorp: string | null
        }
        Insert: {
          aditivo_alteracao_escopo?: boolean | null
          aditivo_atividades?: string | null
          aditivo_denominacao?: string | null
          aditivo_novo_cargo?: string | null
          aditivo_novo_valor?: number | null
          aditivo_vigencia?: string | null
          agencia?: string | null
          bairro?: string | null
          banco?: string | null
          camisa?: string | null
          cargo?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          codbanco?: string | null
          codigo?: string | null
          complemento?: string | null
          conta?: string | null
          contrato_enviado_em?: string | null
          cpf?: string | null
          created_at?: string | null
          datadesl?: string | null
          descricao_funcao?: string | null
          digito?: string | null
          emailcorp?: string | null
          emailpessoal?: string | null
          emergencia_nome?: string | null
          emergencia_parentesco?: string | null
          emergencia_whatsapp?: string | null
          estado?: string | null
          estadocivil?: string | null
          flash?: number | null
          foto_url?: string | null
          genero?: string | null
          gestor_id?: string | null
          id: string
          inicio?: string | null
          logradouro?: string | null
          min_garantido_m1?: number | null
          min_garantido_m2?: number | null
          min_garantido_m3?: number | null
          modalidade?: string | null
          modelo_remuneracao?: string | null
          motivodesl?: string | null
          nascimento?: string | null
          naturalidade?: string | null
          nome?: string | null
          numero?: string | null
          obs?: string | null
          obsdesl?: string | null
          pix?: string | null
          razao?: string | null
          rg?: string | null
          setor?: string | null
          synced_at?: string
          tipodesl?: string | null
          totalpass?: string | null
          trabalho?: string | null
          updated_at?: string | null
          valor?: number | null
          valor_liberalidade?: number | null
          vence?: string | null
          whatsapp?: string | null
          whatsappcorp?: string | null
        }
        Update: {
          aditivo_alteracao_escopo?: boolean | null
          aditivo_atividades?: string | null
          aditivo_denominacao?: string | null
          aditivo_novo_cargo?: string | null
          aditivo_novo_valor?: number | null
          aditivo_vigencia?: string | null
          agencia?: string | null
          bairro?: string | null
          banco?: string | null
          camisa?: string | null
          cargo?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          codbanco?: string | null
          codigo?: string | null
          complemento?: string | null
          conta?: string | null
          contrato_enviado_em?: string | null
          cpf?: string | null
          created_at?: string | null
          datadesl?: string | null
          descricao_funcao?: string | null
          digito?: string | null
          emailcorp?: string | null
          emailpessoal?: string | null
          emergencia_nome?: string | null
          emergencia_parentesco?: string | null
          emergencia_whatsapp?: string | null
          estado?: string | null
          estadocivil?: string | null
          flash?: number | null
          foto_url?: string | null
          genero?: string | null
          gestor_id?: string | null
          id?: string
          inicio?: string | null
          logradouro?: string | null
          min_garantido_m1?: number | null
          min_garantido_m2?: number | null
          min_garantido_m3?: number | null
          modalidade?: string | null
          modelo_remuneracao?: string | null
          motivodesl?: string | null
          nascimento?: string | null
          naturalidade?: string | null
          nome?: string | null
          numero?: string | null
          obs?: string | null
          obsdesl?: string | null
          pix?: string | null
          razao?: string | null
          rg?: string | null
          setor?: string | null
          synced_at?: string
          tipodesl?: string | null
          totalpass?: string | null
          trabalho?: string | null
          updated_at?: string | null
          valor?: number | null
          valor_liberalidade?: number | null
          vence?: string | null
          whatsapp?: string | null
          whatsappcorp?: string | null
        }
        Relationships: []
      }
      sicoob_extrato: {
        Row: {
          contraparte_documento: string | null
          contraparte_nome: string | null
          criado_em: string
          data_movimento: string | null
          historico: string | null
          id: string
          id_transacao: string
          numero_documento: string | null
          tipo: string | null
          valor: number | null
        }
        Insert: {
          contraparte_documento?: string | null
          contraparte_nome?: string | null
          criado_em?: string
          data_movimento?: string | null
          historico?: string | null
          id?: string
          id_transacao: string
          numero_documento?: string | null
          tipo?: string | null
          valor?: number | null
        }
        Update: {
          contraparte_documento?: string | null
          contraparte_nome?: string | null
          criado_em?: string
          data_movimento?: string | null
          historico?: string | null
          id?: string
          id_transacao?: string
          numero_documento?: string | null
          tipo?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      sicoob_saldo: {
        Row: {
          atualizado_em: string | null
          conta: string | null
          id: string
          saldo: number | null
          saldo_bloqueado: number | null
          saldo_disponivel: number | null
        }
        Insert: {
          atualizado_em?: string | null
          conta?: string | null
          id?: string
          saldo?: number | null
          saldo_bloqueado?: number | null
          saldo_disponivel?: number | null
        }
        Update: {
          atualizado_em?: string | null
          conta?: string | null
          id?: string
          saldo?: number | null
          saldo_bloqueado?: number | null
          saldo_disponivel?: number | null
        }
        Relationships: []
      }
      sync_agendamento: {
        Row: {
          atualizado_em: string
          hora_atual: number
          hora_pendente: number | null
          job_name: string
          vigente_a_partir: string | null
        }
        Insert: {
          atualizado_em?: string
          hora_atual: number
          hora_pendente?: number | null
          job_name: string
          vigente_a_partir?: string | null
        }
        Update: {
          atualizado_em?: string
          hora_atual?: number
          hora_pendente?: number | null
          job_name?: string
          vigente_a_partir?: string | null
        }
        Relationships: []
      }
      tarefas: {
        Row: {
          arquivada_em: string | null
          cat_area: string | null
          cat_natureza: string | null
          cat_origem: string | null
          concluido_em: string | null
          created_at: string
          facilities_solicitacao_id: string | null
          id: string
          observacao: string | null
          ordem: number
          pausado_ms: number
          prazo: string | null
          prioridade: string
          responsavel: string | null
          rotina: boolean
          rotina_antecedencia_dias: number
          rotina_ativa: boolean
          rotina_cadencia: Json | null
          rotina_serie_id: string | null
          rotina_subtarefas_fonte: string | null
          status: string
          status_desde: string | null
          subtarefas: Json
          titulo: string
          updated_at: string
        }
        Insert: {
          arquivada_em?: string | null
          cat_area?: string | null
          cat_natureza?: string | null
          cat_origem?: string | null
          concluido_em?: string | null
          created_at?: string
          facilities_solicitacao_id?: string | null
          id?: string
          observacao?: string | null
          ordem?: number
          pausado_ms?: number
          prazo?: string | null
          prioridade?: string
          responsavel?: string | null
          rotina?: boolean
          rotina_antecedencia_dias?: number
          rotina_ativa?: boolean
          rotina_cadencia?: Json | null
          rotina_serie_id?: string | null
          rotina_subtarefas_fonte?: string | null
          status?: string
          status_desde?: string | null
          subtarefas?: Json
          titulo: string
          updated_at?: string
        }
        Update: {
          arquivada_em?: string | null
          cat_area?: string | null
          cat_natureza?: string | null
          cat_origem?: string | null
          concluido_em?: string | null
          created_at?: string
          facilities_solicitacao_id?: string | null
          id?: string
          observacao?: string | null
          ordem?: number
          pausado_ms?: number
          prazo?: string | null
          prioridade?: string
          responsavel?: string | null
          rotina?: boolean
          rotina_antecedencia_dias?: number
          rotina_ativa?: boolean
          rotina_cadencia?: Json | null
          rotina_serie_id?: string | null
          rotina_subtarefas_fonte?: string | null
          status?: string
          status_desde?: string | null
          subtarefas?: Json
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_facilities_solicitacao_id_fkey"
            columns: ["facilities_solicitacao_id"]
            isOneToOne: false
            referencedRelation: "facilities_solicitacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefas_colunas: {
        Row: {
          atualizado_em: string
          nome: string
          pausa_idade: boolean
        }
        Insert: {
          atualizado_em?: string
          nome: string
          pausa_idade?: boolean
        }
        Update: {
          atualizado_em?: string
          nome?: string
          pausa_idade?: boolean
        }
        Relationships: []
      }
      tarefas_log: {
        Row: {
          acao: string
          created_at: string
          descricao: string | null
          id: string
          tarefa_id: string | null
          tarefa_titulo: string | null
          usuario: string | null
          usuario_id: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          descricao?: string | null
          id?: string
          tarefa_id?: string | null
          tarefa_titulo?: string | null
          usuario?: string | null
          usuario_id?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          descricao?: string | null
          id?: string
          tarefa_id?: string | null
          tarefa_titulo?: string | null
          usuario?: string | null
          usuario_id?: string | null
        }
        Relationships: []
      }
      time_cargos: {
        Row: {
          acumulo: boolean
          alvo: string | null
          ano: number
          atribuicoes: Json
          atualizado_em: string
          chave: string
          criado_em: string
          custo_mensal: number | null
          desacoplado: boolean
          id: string
          ordem: number
          parent_id: string | null
          pessoa: string | null
          prioridade: string | null
          senioridade: string | null
          status: string
          titulo: string
        }
        Insert: {
          acumulo?: boolean
          alvo?: string | null
          ano?: number
          atribuicoes?: Json
          atualizado_em?: string
          chave?: string
          criado_em?: string
          custo_mensal?: number | null
          desacoplado?: boolean
          id?: string
          ordem?: number
          parent_id?: string | null
          pessoa?: string | null
          prioridade?: string | null
          senioridade?: string | null
          status?: string
          titulo: string
        }
        Update: {
          acumulo?: boolean
          alvo?: string | null
          ano?: number
          atribuicoes?: Json
          atualizado_em?: string
          chave?: string
          criado_em?: string
          custo_mensal?: number | null
          desacoplado?: boolean
          id?: string
          ordem?: number
          parent_id?: string | null
          pessoa?: string | null
          prioridade?: string | null
          senioridade?: string | null
          status?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_cargos_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "time_cargos"
            referencedColumns: ["id"]
          },
        ]
      }
      time_escopos: {
        Row: {
          atualizado_em: string
          criado_em: string
          descricao: string | null
          horizonte: string | null
          id: string
          ordem: number
          parent_id: string | null
          pilar: string
          responsavel: string | null
          status: string
          titulo: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          descricao?: string | null
          horizonte?: string | null
          id?: string
          ordem?: number
          parent_id?: string | null
          pilar: string
          responsavel?: string | null
          status?: string
          titulo: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          descricao?: string | null
          horizonte?: string | null
          id?: string
          ordem?: number
          parent_id?: string | null
          pilar?: string
          responsavel?: string | null
          status?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_escopos_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "time_escopos"
            referencedColumns: ["id"]
          },
        ]
      }
      time_passos: {
        Row: {
          criado_em: string
          done: boolean
          id: string
          ordem: number
          texto: string
        }
        Insert: {
          criado_em?: string
          done?: boolean
          id?: string
          ordem?: number
          texto: string
        }
        Update: {
          criado_em?: string
          done?: boolean
          id?: string
          ordem?: number
          texto?: string
        }
        Relationships: []
      }
      time_rituais: {
        Row: {
          criado_em: string
          descricao: string | null
          id: string
          ordem: number
          pauta: Json
          periodicidade: string | null
          tipo: string | null
          titulo: string
        }
        Insert: {
          criado_em?: string
          descricao?: string | null
          id?: string
          ordem?: number
          pauta?: Json
          periodicidade?: string | null
          tipo?: string | null
          titulo: string
        }
        Update: {
          criado_em?: string
          descricao?: string | null
          id?: string
          ordem?: number
          pauta?: Json
          periodicidade?: string | null
          tipo?: string | null
          titulo?: string
        }
        Relationships: []
      }
      viagens_eventos_excluidos: {
        Row: {
          created_at: string
          evento_hash: string
        }
        Insert: {
          created_at?: string
          evento_hash: string
        }
        Update: {
          created_at?: string
          evento_hash?: string
        }
        Relationships: []
      }
      vigilancia_mudancas: {
        Row: {
          detectado_em: string
          diff: string | null
          id: number
          natureza: string
          pagina_id: number
          resumo: string | null
          visto_em: string | null
          visto_por: string | null
        }
        Insert: {
          detectado_em?: string
          diff?: string | null
          id?: number
          natureza?: string
          pagina_id: number
          resumo?: string | null
          visto_em?: string | null
          visto_por?: string | null
        }
        Update: {
          detectado_em?: string
          diff?: string | null
          id?: number
          natureza?: string
          pagina_id?: number
          resumo?: string | null
          visto_em?: string | null
          visto_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vigilancia_mudancas_pagina_id_fkey"
            columns: ["pagina_id"]
            isOneToOne: false
            referencedRelation: "vigilancia_paginas"
            referencedColumns: ["id"]
          },
        ]
      }
      vigilancia_paginas: {
        Row: {
          ativo: boolean
          categoria: string | null
          criado_em: string
          fornecedor: string | null
          id: number
          nome: string
          o_que_olhar: string | null
          ultima_leitura: string | null
          ultimo_status: string | null
          url: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string | null
          criado_em?: string
          fornecedor?: string | null
          id?: number
          nome: string
          o_que_olhar?: string | null
          ultima_leitura?: string | null
          ultimo_status?: string | null
          url: string
        }
        Update: {
          ativo?: boolean
          categoria?: string | null
          criado_em?: string
          fornecedor?: string | null
          id?: number
          nome?: string
          o_que_olhar?: string | null
          ultima_leitura?: string | null
          ultimo_status?: string | null
          url?: string
        }
        Relationships: []
      }
      workspace_comentarios: {
        Row: {
          autor_nome: string
          autor_user_id: string | null
          criado_em: string
          id: string
          link_id: string | null
          origem: string
          page_id: string
          resolvido: boolean
          texto: string
        }
        Insert: {
          autor_nome: string
          autor_user_id?: string | null
          criado_em?: string
          id?: string
          link_id?: string | null
          origem?: string
          page_id: string
          resolvido?: boolean
          texto: string
        }
        Update: {
          autor_nome?: string
          autor_user_id?: string | null
          criado_em?: string
          id?: string
          link_id?: string | null
          origem?: string
          page_id?: string
          resolvido?: boolean
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_comentarios_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "workspace_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_comentarios_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "workspace_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_links: {
        Row: {
          acessos: number
          criado_em: string
          criado_por: string | null
          criado_por_nome: string | null
          expira_em: string | null
          id: string
          page_id: string
          permite_comentario: boolean
          revogado_em: string | null
          token: string
          ultimo_acesso: string | null
        }
        Insert: {
          acessos?: number
          criado_em?: string
          criado_por?: string | null
          criado_por_nome?: string | null
          expira_em?: string | null
          id?: string
          page_id: string
          permite_comentario?: boolean
          revogado_em?: string | null
          token: string
          ultimo_acesso?: string | null
        }
        Update: {
          acessos?: number
          criado_em?: string
          criado_por?: string | null
          criado_por_nome?: string | null
          expira_em?: string | null
          id?: string
          page_id?: string
          permite_comentario?: boolean
          revogado_em?: string | null
          token?: string
          ultimo_acesso?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_links_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "workspace_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_pages: {
        Row: {
          archived: boolean
          content: Json
          cover_url: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          icon: string | null
          id: string
          is_favorite: boolean
          last_edited_by: string | null
          oculta: boolean
          parent_id: string | null
          position: number
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          content?: Json
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          icon?: string | null
          id?: string
          is_favorite?: boolean
          last_edited_by?: string | null
          oculta?: boolean
          parent_id?: string | null
          position?: number
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          content?: Json
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          icon?: string | null
          id?: string
          is_favorite?: boolean
          last_edited_by?: string | null
          oculta?: boolean
          parent_id?: string | null
          position?: number
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_pages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "workspace_pages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      cac_pagamentos: {
        Row: {
          categoria: string | null
          cnpj: string | null
          cod_titulo: number | null
          data_pagamento: string | null
          valor: number | null
          vencimento: string | null
        }
        Relationships: []
      }
      cap_titulos: {
        Row: {
          anexo_classe: string | null
          anexo_lido_em: string | null
          anexo_revisao: string | null
          anexo_tipo_lido: string | null
          anexos: Json | null
          anexos_no_erp: number | null
          categoria: string | null
          categoria_codigo: string | null
          cod_cliente: string | null
          cod_titulo: number | null
          competencia: string | null
          conta: string | null
          conta_codigo: string | null
          doc: string | null
          documento: string | null
          documento_classe: string | null
          emissao: string | null
          enviado_em: string | null
          erro_leitura: string | null
          favorecido: string | null
          favorecido_cru: string | null
          fornecedor_emite_nf: boolean | null
          gravidade: string | null
          nf_no_campo: string | null
          nota_no_hub: string | null
          pagamento: string | null
          parcela: string | null
          regra: string | null
          situacao: string | null
          status: string | null
          tem_apelido: boolean | null
          valor: number | null
          vencimento: string | null
        }
        Relationships: []
      }
      contraparte_apelido: {
        Row: {
          apelido: string | null
          chave: string | null
          nome: string | null
          via: string | null
        }
        Relationships: []
      }
      contrapartes_pessoas: {
        Row: {
          documento: string | null
          id: string | null
          nome: string | null
          observacao: string | null
          pessoa: string | null
          status: string | null
        }
        Relationships: []
      }
      facilities_nf_auditoria_v: {
        Row: {
          alvo_id_unico: string | null
          alvo_tipo: string | null
          aplicado_em: string | null
          aplicado_por: string | null
          compra_data: string | null
          compra_id: string | null
          compra_item: string | null
          compra_valor: number | null
          confianca: string | null
          created_at: string | null
          criterio: Json | null
          forma_pagamento: string | null
          fornecedor_nome: string | null
          id: number | null
          nf_arquivo: string | null
          nf_cnpj: string | null
          nf_nome: string | null
          nf_numero: string | null
          nf_url: string | null
          score: number | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facilities_nf_auditoria_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "facilities_compras"
            referencedColumns: ["id"]
          },
        ]
      }
      notas_externas_parada: {
        Row: {
          id: number | null
          ignorado_motivo: string | null
          motivo: string | null
        }
        Relationships: []
      }
      omie_anexo_quarentena: {
        Row: {
          cod_titulo: string | null
          erros: number | null
          tentativas: number | null
          ultima_tentativa: string | null
          ultimo_motivo: string | null
        }
        Relationships: []
      }
      tarefas_rotinas: {
        Row: {
          aberta_id: string | null
          aberta_prazo: string | null
          antecedencia_dias: number | null
          ativa: boolean | null
          cadencia: Json | null
          cat_area: string | null
          cat_natureza: string | null
          concluidas: number | null
          ocorrencias: number | null
          prioridade: string | null
          proxima_data: string | null
          proxima_itens: number | null
          responsavel: string | null
          serie_id: string | null
          subtarefas_fonte: string | null
          tarefa_modelo_id: string | null
          titulo: string | null
          ultima_conclusao: string | null
        }
        Relationships: []
      }
      vw_agente_saude: {
        Row: {
          agente_id: string | null
          ativo: boolean | null
          corrigidas_30d: number | null
          excecoes_abertas: number | null
          excecoes_vencidas: number | null
          execucoes_30d: number | null
          falhas_30d: number | null
          nome: string | null
          ultima_execucao: string | null
        }
        Relationships: []
      }
      vw_orcamento_area: {
        Row: {
          ano: number | null
          area: string | null
          consumido_pct: number | null
          mes: number | null
          orcado: number | null
          orcado_pessoal: number | null
          realizado: number | null
          realizado_pessoal: number | null
          saldo: number | null
          status: string | null
          tem_omie: boolean | null
        }
        Relationships: []
      }
      vw_orcamento_area_linha: {
        Row: {
          ano: number | null
          area: string | null
          consumido_pct: number | null
          fonte_realizado: string | null
          mes: number | null
          orcado: number | null
          pessoal: boolean | null
          realizado: number | null
          saldo: number | null
          subcategoria: string | null
        }
        Insert: {
          ano?: number | null
          area?: string | null
          consumido_pct?: never
          fonte_realizado?: never
          mes?: number | null
          orcado?: number | null
          pessoal?: boolean | null
          realizado?: never
          saldo?: never
          subcategoria?: string | null
        }
        Update: {
          ano?: number | null
          area?: string | null
          consumido_pct?: never
          fonte_realizado?: never
          mes?: number | null
          orcado?: number | null
          pessoal?: boolean | null
          realizado?: never
          saldo?: never
          subcategoria?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      aceita_recibo_do_app: { Args: { nome: string }; Returns: boolean }
      achado_do_lancamento: { Args: { p_id_unico: string }; Returns: string }
      agenda_checklist_do_dia: {
        Args: { p_dia: string; p_responsavel?: string }
        Returns: Json
      }
      anexo_classe: { Args: { p_nome: string }; Returns: string }
      anexo_documento_classe: {
        Args: {
          p_classe: string
          p_emite_nf: boolean
          p_ia_tipo: string
          p_revisao: string
        }
        Returns: string
      }
      anexo_triagem_desfazer: { Args: { p_desde?: string }; Returns: number }
      anexo_triagem_fila: {
        Args: { p_limite?: number }
        Returns: {
          c_tabela: string
          categoria: string
          cod_titulo: number
          competencia: string
          favorecido: string
          id_anexo: string
          nome: string
          valor: number
        }[]
      }
      anexo_triagem_fila_total: { Args: never; Returns: number }
      anexo_triagem_gravar: {
        Args: {
          p_arquivo: string
          p_cod_titulo: number
          p_leitura: Json
          p_motivo: string
          p_veredito: string
        }
        Returns: undefined
      }
      append_trilha_e_status: {
        Args: { p_evento: Json; p_id_unico: string; p_status: string }
        Returns: undefined
      }
      apply_orcamento_realizado_omie: {
        Args: { p_ano: number; p_dados: Json }
        Returns: number
      }
      apresentacao_duplicar: {
        Args: { p_id: string; p_nome: string }
        Returns: string
      }
      apresentacao_excluir: { Args: { p_id: string }; Returns: undefined }
      apresentacao_nome_livre: {
        Args: { p_mes: string; p_nome: string }
        Returns: string
      }
      apresentacao_publicar: {
        Args: { p_congelado: Json; p_id: string }
        Returns: undefined
      }
      apresentacao_salvar:
        | {
            Args: {
              p_id?: string
              p_mes: string
              p_nome: string
              p_roteiro: Json
              p_textos?: Json
            }
            Returns: string
          }
        | {
            Args: {
              p_id?: string
              p_mes: string
              p_nome: string
              p_periodo_tipo?: string
              p_roteiro: Json
              p_textos?: Json
            }
            Returns: string
          }
      asaas_assinaturas_a_sondar: {
        Args: { p_limite?: number }
        Returns: {
          assinatura: string
          cobrancas: number
          ultima: string
        }[]
      }
      asaas_entradas_projetadas: {
        Args: { p_ate: string; p_de: string }
        Returns: {
          a_vencer: number
          confirmado: number
          data: string
          qtd: number
          valor: number
        }[]
      }
      asaas_metricas: { Args: { p_referencia: string }; Returns: Json }
      asaas_prazo_credito: { Args: { p_forma: string }; Returns: number }
      auditoria_compras: { Args: never; Returns: Json }
      auditoria_envio_quase_la: {
        Args: { p_limite?: number }
        Returns: {
          competencia: string
          falta: string
          ja_enviado: boolean
          origem: string
          ref_id: string
          rotulo: string
          tem_comprovante: boolean
          tem_titulo: boolean
          valor: number
        }[]
      }
      auditoria_lojistas: { Args: never; Returns: Json }
      automacao_assinatura_erro: {
        Args: { p_resposta: string; p_status: number }
        Returns: string
      }
      automacao_colher: { Args: never; Returns: number }
      automacao_criar_tarefa: {
        Args: {
          p_id: string
          p_prazo?: string
          p_prioridade?: string
          p_responsavel?: string
        }
        Returns: string
      }
      automacao_diagnostico_gravar: {
        Args: {
          p_amostra: string
          p_assinatura: string
          p_causa: string
          p_gravidade: string
          p_jobname: string
          p_modelo: string
          p_o_que_fazer: string
          p_resumo: string
        }
        Returns: undefined
      }
      automacao_diagnosticos_abertos: {
        Args: never
        Returns: {
          causa: string
          gravidade: string
          jobname: string
          o_que_fazer: string
          ocorrencias: number
          primeira_em: string
          resumo: string
          ultima_em: string
        }[]
      }
      automacoes_para_diagnosticar: {
        Args: { p_limite?: number }
        Returns: {
          assinatura: string
          disparado_em: string
          falhas_7d: number
          jobname: string
          resposta: string
          schedule: string
          status_code: number
        }[]
      }
      aviso_dispensar: {
        Args: { p_assinatura: string; p_chave: string; p_fonte: string }
        Returns: undefined
      }
      avisos_graves_abertos: {
        Args: never
        Returns: {
          assinatura: string
          causa: string
          chave: string
          desde: string
          fonte: string
          o_que_fazer: string
          ocorrencias: number
          resumo: string
          titulo: string
        }[]
      }
      avisos_limpar_resolvidos: { Args: never; Returns: number }
      cac_celula: {
        Args: { p_ano: number; p_linha_id: string; p_mes: number }
        Returns: {
          categoria: string
          categoria_descricao: string
          cnpj: string
          cod_titulo: number
          data_pagamento: string
          departamento: string
          favorecido: string
          natureza: string
          pessoa: string
          tipo: string
          valor: number
        }[]
      }
      cac_linha_casa: {
        Args: {
          p_categoria: string
          p_categorias: string[]
          p_cnpj: string
          p_departamentos: string[]
        }
        Returns: boolean
      }
      cac_painel: {
        Args: { p_ano: number }
        Returns: {
          grupo: string
          linha_id: string
          mes: number
          ordem: number
          origem: string
          regra_nota: string
          rotulo: string
          valor: number
        }[]
      }
      caixa_nota_apontar: {
        Args: { p_cod_titulo: number; p_id: number }
        Returns: Json
      }
      caixa_notas_lista: {
        Args: { p_dias?: number; p_limite?: number }
        Returns: {
          alvo_data: string
          alvo_favorecido: string
          alvo_id_unico: string
          alvo_tipo: string
          alvo_valor: number
          arquivo: string
          casamento: string
          cnpj: string
          confianca: string
          data_doc: string
          detalhe: string
          documento: string
          enviado_erp_em: string
          erro_erp: string
          estado: string
          fonte: string
          id: number
          leitura_erro: string
          lido_em: string
          nome: string
          tem_arquivo: boolean
          tipo_documento: string
          valor: number
          visto_em: string
        }[]
      }
      cambio_do_dia: {
        Args: { p_data: string; p_moeda?: string }
        Returns: number
      }
      cap_anexo_revisar: {
        Args: { p_cod_titulo: number; p_veredito: string }
        Returns: string
      }
      cap_anexos_fila: {
        Args: { p_limite?: number }
        Returns: {
          cod_titulo: number
          competencia: string
          situacao: string
          valor: number
        }[]
      }
      cap_anexos_fila_total: { Args: never; Returns: number }
      cap_gravidade: { Args: { p_valor: number }; Returns: string }
      cap_notas_diagnostico: {
        Args: { p_ate?: string; p_de?: string }
        Returns: Json
      }
      cap_notas_facetas: {
        Args: { p_ate: string; p_de: string }
        Returns: Json
      }
      cap_notas_pistas: {
        Args: { p_ate?: string; p_de?: string; p_limite?: number }
        Returns: {
          bloqueio: Json
          categoria: string
          cod_titulo: number
          competencia: string
          detalhe: string
          favorecido: string
          fonte: string
          o_que_e: string
          pistas: Json
          quando: string
          tem_arquivo: boolean
          valor: number
        }[]
      }
      cap_notas_resumo: { Args: { p_ate: string; p_de: string }; Returns: Json }
      cap_notas_so_comprovante: {
        Args: {
          p_ate?: string
          p_de?: string
          p_dias?: number
          p_limite?: number
        }
        Returns: {
          anexo_tipo: string
          categoria: string
          cod_titulo: number
          competencia: string
          documento_classe: string
          favorecido: string
          situacao: string
          valor: number
          virou_nota_em: string
        }[]
      }
      cap_notas_titulos: {
        Args: {
          p_ate: string
          p_busca?: string
          p_categoria?: string
          p_categorias?: string[]
          p_conta?: string
          p_contas?: string[]
          p_de: string
          p_gravidades?: string[]
          p_limite?: number
          p_mes_ate?: string
          p_mes_de?: string
          p_offset?: number
          p_situacoes?: string[]
          p_valor_max?: number
          p_valor_min?: number
        }
        Returns: {
          anexo_classe: string
          anexo_lido_em: string
          anexo_revisao: string
          anexos: Json
          anexos_no_erp: number
          categoria: string
          categoria_codigo: string
          cod_titulo: number
          competencia: string
          conta: string
          doc: string
          documento: string
          enviado_em: string
          erro_leitura: string
          favorecido: string
          favorecido_cru: string
          gravidade: string
          nf_no_campo: string
          nota_no_hub: string
          observacao: string
          pagamento: string
          situacao: string
          tem_apelido: boolean
          total_geral: number
          valor: number
          vencimento: string
        }[]
      }
      cap_regra_sugerida: {
        Args: { p_codigo: string; p_descricao: string }
        Returns: string
      }
      cap_titulo_resumo: {
        Args: { p_cods: number[] }
        Returns: {
          cod_titulo: number
          data: string
          favorecido: string
          valor: number
        }[]
      }
      cartao_acesso: { Args: { p_card_final: string }; Returns: Json }
      cartao_importar: { Args: { p_payload: Json }; Returns: Json }
      cartao_marcar: {
        Args: {
          p_estabelecimento: string
          p_marcado?: boolean
          p_nota?: string
        }
        Returns: undefined
      }
      cartao_nome_fila: {
        Args: { p_limite?: number }
        Returns: {
          cod_titulo: number
          competencia: string
          documento_atual: string
          favorecido_cru: string
          observacao: string
          valor: number
        }[]
      }
      cartao_omie_lojistas: {
        Args: { p_limite?: number; p_offset?: number }
        Returns: {
          cod_titulo: string
          codigo_categoria: string
          contraparte: string
          data: string
          descricao_categoria: string
          observacao: string
          valor: number
        }[]
      }
      cartao_omie_map_gravar: { Args: { p_itens: Json }; Returns: Json }
      cartao_omie_titulos: {
        Args: { p_ate: string; p_de: string }
        Returns: {
          cod_titulo: string
          codigo_categoria: string
          contraparte: string
          data: string
          descricao_categoria: string
          documento: string
          valor: number
        }[]
      }
      cartao_recomendacao_decidir: {
        Args: { p_id: string; p_status?: string; p_texto?: string }
        Returns: undefined
      }
      cartao_recomendacao_tarefa: {
        Args: { p_id: string; p_prazo?: string; p_responsavel?: string }
        Returns: string
      }
      cartao_series: { Args: never; Returns: Json }
      chave_contraparte: { Args: { p: string }; Returns: string }
      churn_fila_sinal: {
        Args: { p_limite?: number }
        Returns: {
          cliente_nome: string
          cliente_ref: string
          cobrancas: number
          dias_atraso: number
          documento: string
          valor_aberto: number
        }[]
      }
      comentar_nota_publica: {
        Args: { p_autor: string; p_texto: string; p_token: string }
        Returns: Json
      }
      contraparte_apelido_de: {
        Args: { p_nomes: string[] }
        Returns: {
          apelido: string
          nome: string
        }[]
      }
      contraparte_chave: { Args: { p_nome: string }; Returns: string }
      contrapartes_por_documento: {
        Args: { p_docs: string[] }
        Returns: {
          aproximado: boolean
          doc: string
          fonte: string
          nome: string
        }[]
      }
      corpo_desmente: { Args: { p_resposta: string }; Returns: boolean }
      criar_token_e_registrar: {
        Args: {
          p_colaborador_id?: string
          p_criado_por?: string
          p_id_unicos: Json
          p_responsavel: string
          p_telefone?: string
        }
        Returns: Json
      }
      demonstracoes_categorias: {
        Args: { p_meses: string[]; p_rubrica?: string; p_tipo: string }
        Returns: {
          categoria: string
          lancamentos: number
          mes: string
          rubrica: string
          valor: number
        }[]
      }
      demonstracoes_contrapartes: {
        Args: { p_meses: string[]; p_rubrica?: string; p_tipo: string }
        Returns: {
          categoria: string
          cods: string[]
          contraparte: string
          lancamentos: number
          mes: string
          rubrica: string
          valor: number
        }[]
      }
      demonstracoes_lancamentos: {
        Args: { p_mes: string; p_rubrica: string; p_tipo: string }
        Returns: {
          categoria_codigo: string
          categoria_descricao: string
          cnpj_cpf: string
          cod_titulo: string
          contraparte: string
          data: string
          documento: string
          grupo: string
          status: string
          titulo: string
          valor: number
          vencimento: string
        }[]
      }
      demonstracoes_lancamentos_multi: {
        Args: { p_meses: string[]; p_rubricas: string[]; p_tipo: string }
        Returns: {
          categoria: string
          cod_titulo: string
          contraparte: string
          data: string
          mes: string
          observacao: string
          rubrica: string
          valor: number
        }[]
      }
      demonstracoes_reclassificacoes: {
        Args: { p_tipo: string }
        Returns: {
          alertas: number
          mes: string
          rubrica: string
          severidade: string
          valor_total: number
        }[]
      }
      demonstracoes_reclassificacoes_celula: {
        Args: { p_mes: string; p_rubrica: string; p_tipo: string }
        Returns: {
          cod_titulo: string
          fornecedor: string
          hist_lancamentos: number
          hist_no_padrao: number
          id: string
          ignorado_motivo: string
          rubrica_padrao: string
          severidade: string
          status: string
          valor: number
          valor_padrao: number
        }[]
      }
      disparar_automacao: {
        Args: {
          p_body?: Json
          p_headers?: Json
          p_jobname: string
          p_timeout_ms?: number
          p_token_nome?: string
          p_url: string
        }
        Returns: number
      }
      doc_fiscal_valido: { Args: { p_doc: string }; Returns: boolean }
      ebitda_ajuste_candidatos: {
        Args: { p_mes: string; p_piso?: number; p_rubricas: string[] }
        Returns: {
          categoria: string
          cnpj_cpf: string
          cod_titulo: string
          contraparte: string
          data: string
          forca: string
          hist_lancamentos: number
          hist_mediana: number
          motivo: string
          regra: string
          rubrica: string
          texto: string
          valor: number
          valor_lancamento: number
        }[]
      }
      ebitda_ajuste_grupos: {
        Args: { p_mes: string; p_piso?: number; p_rubricas: string[] }
        Returns: {
          categoria: string
          cods: string[]
          contraparte: string
          do_cartao: boolean
          forca: string
          grupo: string
          hist_mediana: number
          hist_meses: number
          itens: Json
          lancamentos: number
          motivo: string
          primeira: string
          regra: string
          rubrica: string
          ultima: string
          valor: number
          valor_lancamento: number
        }[]
      }
      eh_cartao: { Args: { p_contraparte: string }; Returns: boolean }
      email_acao_marcar_enviada: {
        Args: { p_chave: string }
        Returns: undefined
      }
      email_acao_virar_tarefa: {
        Args: { p_chave: string; p_prazo?: string; p_responsavel?: string }
        Returns: string
      }
      email_acoes_pendentes: {
        Args: { p_limite?: number }
        Returns: {
          acao: string
          assunto: string
          chave: string
          data_email: string
          enviado_em: string
          gmail_id: string
          msg_assunto: string
          msg_data: string
          porque: string
          remetente: string
          sugestao: string
          tarefa_id: string
          veredito: string
        }[]
      }
      email_resposta_fila: {
        Args: { p_limite?: number }
        Returns: {
          assunto: string
          data: string
          gmail_id: string
          remetente: string
          thread_id: string
        }[]
      }
      email_resposta_marcar_enviada: {
        Args: { p_gmail_id: string }
        Returns: undefined
      }
      email_respostas_pendentes: {
        Args: { p_limite?: number }
        Returns: {
          assunto: string
          criada_em: string
          gmail_id: string
          porque: string
          remetente: string
          sugestao: string
          thread_id: string
          veredito: string
        }[]
      }
      encerrar_cartao: {
        Args: { p_card_final: string; p_dias_graca?: number; p_motivo?: string }
        Returns: Json
      }
      estornos_chave: { Args: { t: string }; Returns: string }
      estornos_conciliar: { Args: never; Returns: Json }
      estornos_motivo_descarta: { Args: { t: string }; Returns: boolean }
      estornos_nome: { Args: { t: string }; Returns: string }
      estornos_planilha_orfas: {
        Args: never
        Returns: {
          data_solicitacao: string
          estabelecimento: string
          forma: string
          linha: number
          mes: number
          motivo: string
          status: string
          valor_estornar: number
        }[]
      }
      estornos_serie: {
        Args: { p_pendentes?: boolean }
        Returns: {
          antigo: number
          churn_real: number
          competencia: string
          estornado: number
          indevida: number
          nao_classificado: number
          pendente: number
          qtd: number
          qtd_antigo: number
          qtd_indevida: number
          qtd_nao_classificado: number
          qtd_parciais: number
          qtd_pendente: number
        }[]
      }
      estrangeiro_vale_como_nota: {
        Args: { p_texto: string; p_tipo: string }
        Returns: boolean
      }
      expressao_do_argumento: {
        Args: { p_arg: string; p_comando: string }
        Returns: string
      }
      extrato_comparativo: {
        Args: { p_fonte: string; p_mes: string }
        Returns: Json
      }
      facilities_aplicar_titulo: {
        Args: { p_compra_id?: string; p_limite?: number; p_so_exata?: boolean }
        Returns: number
      }
      facilities_casar_titulo: {
        Args: { p_compra_id?: string; p_limite?: number }
        Returns: {
          candidatos: number
          cod_titulo: number
          compra_id: string
          confianca: string
          data: string
          favorecido: string
          item: string
          valor: number
        }[]
      }
      facilities_nf_aplicar: {
        Args: {
          p_alvo_id_unico: string
          p_alvo_tipo: string
          p_compra_id: string
          p_confianca?: string
          p_criterio?: Json
          p_por?: string
          p_score?: number
        }
        Returns: {
          alvo_id_unico: string
          alvo_tipo: string
          aplicado_em: string | null
          aplicado_por: string | null
          compra_id: string
          confianca: string
          created_at: string
          criterio: Json
          decidido_em: string | null
          decidido_por: string | null
          id: number
          score: number | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "facilities_nf_auditoria"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      facilities_nf_candidatos: {
        Args: {
          p_compra_id: string
          p_dias_antes?: number
          p_dias_depois?: number
        }
        Returns: {
          alvo_data: string
          alvo_descricao: string
          alvo_id_unico: string
          alvo_status: string
          alvo_tipo: string
          alvo_valor: number
          confianca: string
          criterio: Json
          dias: number
          documento_bate: boolean
          grupo: string
          nome_score: number
          score: number
        }[]
      }
      facilities_nf_desfazer: {
        Args: { p_por?: string; p_vinculo_id: number }
        Returns: {
          alvo_id_unico: string
          alvo_tipo: string
          aplicado_em: string | null
          aplicado_por: string | null
          compra_id: string
          confianca: string
          created_at: string
          criterio: Json
          decidido_em: string | null
          decidido_por: string | null
          id: number
          score: number | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "facilities_nf_auditoria"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      facilities_nf_propostas: {
        Args: never
        Returns: {
          alvo_data: string
          alvo_descricao: string
          alvo_id_unico: string
          alvo_tipo: string
          alvo_valor: number
          compra_data: string
          compra_id: string
          compra_item: string
          compra_valor: number
          confianca: string
          created_at: string
          criterio: Json
          forma_pagamento: string
          fornecedor_nome: string
          id: number
          nf_arquivo: string
          nf_cnpj: string
          nf_nome: string
          nf_numero: string
          score: number
        }[]
      }
      facilities_radar_agenda: {
        Args: never
        Returns: {
          acao: string
          job: string
          proxima: string
        }[]
      }
      facilities_radar_fila: {
        Args: { p_limite?: number }
        Returns: {
          ativo: boolean
          cadencia_dias: number
          categoria: string
          created_at: string
          criado_por: string | null
          favorito: boolean
          fontes: string[]
          id: string
          link_ref: string | null
          pedido: string
          preco_alvo: number
          quantidade: number
          rodadas: number
          solicitacao_id: string | null
          specs: Json
          titulo: string
          ultima_varredura: string | null
          ultimo_erro: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "facilities_radar_alvos"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      facilities_radar_historico: {
        Args: { p_alvo_id: string; p_dias?: number }
        Returns: {
          dia: string
          mediana: number
          menor: number
          menor_no_teto: number
          ofertas: number
        }[]
      }
      facilities_radar_historico_oferta: {
        Args: { p_dias?: number; p_oferta_id: number }
        Returns: {
          dia: string
          preco: number
        }[]
      }
      facilities_radar_painel: {
        Args: never
        Returns: {
          alertas_novos: number
          alvo: Json
          economia_aberta: number
          economia_realizada: number
          melhor: Json
          menor_fora_do_teto: number
          ofertas_ativas: number
          pontos_historico: number
        }[]
      }
      facilities_radar_rendimento: {
        Args: { p_dias?: number }
        Returns: {
          alertas: number
          anuncios: number
          fonte: string
          uteis: number
        }[]
      }
      facilities_radar_virar_cotacao: {
        Args: { p_alerta_id: number; p_quem?: string }
        Returns: Json
      }
      fatura_cartao_do_token: {
        Args: { p_digitos: string; p_token: string }
        Returns: string
      }
      fatura_contestar_via_token: {
        Args: {
          p_digitos: string
          p_id_unico: string
          p_motivo: string
          p_texto?: string
          p_token: string
        }
        Returns: Json
      }
      fatura_descontestar_via_token: {
        Args: { p_digitos: string; p_id_unico: string; p_token: string }
        Returns: Json
      }
      fatura_justificar_via_token: {
        Args: {
          p_digitos: string
          p_id_unico: string
          p_texto: string
          p_token: string
        }
        Returns: Json
      }
      firecrawl_orcamento_status: {
        Args: { p_desde?: string }
        Returns: {
          ativo: boolean
          consumidor: string
          gasto_ciclo: number
          para_que: string
          piso_saldo: number
          resta_ciclo: number
          rotulo: string
          teto_mes: number
        }[]
      }
      fmt_brl: { Args: { v: number }; Returns: string }
      fn_classifica_texto: {
        Args: { p_texto: string }
        Returns: {
          area: string
          natureza: string
          rotina: boolean
        }[]
      }
      fn_familia_texto: { Args: { p_texto: string }; Returns: string }
      fn_resumo_tarefas_semana: { Args: { p_ref?: string }; Returns: Json }
      fornecedor_emite_nf: { Args: { p_nome: string }; Returns: boolean }
      garantir_links_dos_cartoes: { Args: never; Returns: number }
      hub_automacoes: { Args: never; Returns: Json }
      hub_base_url: { Args: never; Returns: string }
      ia_orcamento_status: {
        Args: never
        Returns: {
          ativo: boolean
          consumidor: string
          gasto_mes_usd: number
          para_que: string
          resta_hoje: number
          rotulo: string
          teto_dia: number
          teto_mes_usd: number
          usadas_hoje: number
        }[]
      }
      importar_auditoria: {
        Args: { p_achados: Json }
        Returns: {
          atualizados: number
          inseridos: number
        }[]
      }
      integracao_estado_gravar: {
        Args: {
          p_causa: string
          p_chave: string
          p_conectado: boolean
          p_detalhe: string
          p_gravidade: string
          p_nome: string
          p_o_que_fazer: string
          p_para_que: string
        }
        Returns: undefined
      }
      jsonb_ou_nulo: { Args: { p: string }; Returns: Json }
      justificativa_decidir: {
        Args: { p_id: string; p_status?: string; p_texto?: string }
        Returns: undefined
      }
      lancamento_do_achado: { Args: { p_id_unico: string }; Returns: string }
      lancamento_nota_salvar: {
        Args: {
          p_cod_titulo: string
          p_contraparte?: string
          p_mes?: string
          p_rubrica?: string
          p_texto: string
          p_tipo?: string
        }
        Returns: {
          atualizado_em: string
          autor: string | null
          autor_nome: string | null
          cod_titulo: string
          contraparte: string | null
          criado_em: string
          id: string
          origem_mes: string | null
          origem_rubrica: string | null
          origem_tipo: string | null
          texto: string
        }
        SetofOptions: {
          from: "*"
          to: "demonstracoes_lancamento_nota"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      modelo_apresentacao_excluir: {
        Args: { p_id: string }
        Returns: undefined
      }
      modelo_apresentacao_salvar: {
        Args: {
          p_descricao?: string
          p_id?: string
          p_nome: string
          p_periodo_tipo?: string
          p_roteiro: Json
        }
        Returns: string
      }
      nf_cadastros_a_corrigir: {
        Args: { p_limite?: number }
        Returns: {
          doc: string
          fonte: string
          id_customer: string
          ids: string[]
          motivo: string
          n_cod_cli: number
          nome: string
          os_faturada: boolean
          tentativas: number
          ultima_recusa: string
        }[]
      }
      nfse_bloqueio_emissao: {
        Args: {
          p_avulsa?: boolean
          p_dados?: Json
          p_estorno_registrado?: boolean
          p_status: string
        }
        Returns: string
      }
      nfse_cadastros_a_preparar: {
        Args: { p_desde?: string; p_limite?: number }
        Returns: {
          cobrancas: number
          codigo: number
          doc: string
          falta: string
          id_customer: string
          nome: string
          valor_ultimos_meses: number
        }[]
      }
      nfse_carencia: {
        Args: { p_erro: string; p_tentativas: number }
        Returns: string
      }
      nfse_preparo_montar: { Args: { p_desde?: string }; Returns: number }
      nome_de_arquivo_da_nota: {
        Args: { p_detalhe: string; p_fonte: string }
        Returns: string
      }
      normaliza_nome: { Args: { p_nome: string }; Returns: string }
      nota_fonte_do_titulo: {
        Args: { p_cod: string }
        Returns: {
          fonte: string
          link: string
          nome: string
        }[]
      }
      nota_onde_esta: {
        Args: {
          p_chave: string
          p_drive_id: string
          p_fonte: string
          p_link: string
          p_link_documento: string
        }
        Returns: Json
      }
      nota_propagar: { Args: { p_cod: string }; Returns: Json }
      nota_propagar_tudo: { Args: { p_limite?: number }; Returns: Json }
      notas_cambio_lote: { Args: never; Returns: Json }
      notas_e_decoracao: {
        Args: { p_o_que_e: string; p_parece_nota: boolean }
        Returns: boolean
      }
      notas_externas_acervo: {
        Args: {
          p_alvo?: string
          p_ate?: string
          p_busca?: string
          p_de?: string
          p_fonte?: string
          p_limite?: number
          p_motivo?: string
          p_offset?: number
          p_ordem?: string
          p_situacao?: string
          p_valor_max?: number
          p_valor_min?: number
        }
        Returns: {
          alvo_categoria: string
          alvo_cod_titulo: string
          alvo_data: string
          alvo_id_unico: string
          alvo_manual: boolean
          alvo_nome: string
          alvo_situacao: string
          alvo_tipo: string
          alvo_valor: number
          arquivo_bucket: string
          candidatos: Json
          casamento: string
          chave_fiscal: string
          cnpj: string
          competencia: string
          conferencia: string
          confianca: string
          copia_de: number
          copia_de_fonte: string
          copia_de_rotulo: string
          detalhe: string
          diz_anexado: boolean
          enviado_em: string
          enviado_erp_em: string
          erro_erp: string
          fila_erp: boolean
          fonte: string
          id: number
          ignorado_em: string
          ignorado_motivo: string
          linha: number
          link: string
          motivo: string
          nome: string
          o_que_e: string
          parece_nota: boolean
          status_planilha: string
          tem_arquivo: boolean
          tipo_documento: string
          total: number
          valor: number
          vencimento: string
        }[]
      }
      notas_externas_acervo_resumo: { Args: never; Returns: Json }
      notas_externas_achados: {
        Args: { p_conferencia?: string; p_limite?: number }
        Returns: {
          alvo_data: string
          alvo_favorecido: string
          alvo_id_unico: string
          alvo_tipo: string
          alvo_valor: number
          candidatos: Json
          casamento: string
          cnpj: string
          competencia: string
          conferencia: string
          confianca: string
          diz_anexado: boolean
          enviado_em: string
          enviado_erp_em: string
          erro_erp: string
          fila_erp: boolean
          fonte: string
          id: number
          linha: number
          link: string
          nome: string
          o_que_e: string
          status_planilha: string
          valor: number
        }[]
      }
      notas_externas_aplicar_sugestao: { Args: { p_id: number }; Returns: Json }
      notas_externas_arquivar_lote: {
        Args: { p_ids: number[]; p_motivo: string }
        Returns: number
      }
      notas_externas_arquivo_resumo: { Args: never; Returns: Json }
      notas_externas_candidatos: {
        Args: { p_id: number }
        Returns: {
          alvo_tipo: string
          categoria: string
          cod_titulo: string
          data: string
          dias: number
          id_unico: string
          ja_tem_nota: boolean
          nome: string
          valor: number
        }[]
      }
      notas_externas_casar: { Args: never; Returns: Json }
      notas_externas_confirmar: { Args: { p_ids: number[] }; Returns: number }
      notas_externas_corte_alcance: { Args: never; Returns: string }
      notas_externas_definir_alvo: {
        Args: { p_alvo_id_unico: string; p_alvo_tipo: string; p_id: number }
        Returns: undefined
      }
      notas_externas_desarquivar_lote: {
        Args: { p_ids: number[] }
        Returns: number
      }
      notas_externas_desarquivar_motivo: {
        Args: { p_motivo: string }
        Returns: number
      }
      notas_externas_desfazer_ia: {
        Args: { p_desde?: string }
        Returns: number
      }
      notas_externas_do_drive: { Args: never; Returns: number }
      notas_externas_enfileirar: { Args: { p_ids: number[] }; Returns: number }
      notas_externas_enfileirar_automatico: {
        Args: { p_limite?: number }
        Returns: Json
      }
      notas_externas_explicar_resumo: { Args: never; Returns: Json }
      notas_externas_facetas: { Args: never; Returns: Json }
      notas_externas_faxina: { Args: { p_simular?: boolean }; Returns: Json }
      notas_externas_fila_explicar: {
        Args: { p_limite?: number; p_modo: string }
        Returns: {
          candidatos: Json
          cnpj: string
          competencia: string
          detalhe: string
          enviado_em: string
          fonte: string
          id: number
          nome: string
          o_que_e: string
          valor: number
          vencimento: string
        }[]
      }
      notas_externas_gravar_motivo: {
        Args: { p_id: number; p_motivo: string }
        Returns: undefined
      }
      notas_externas_gravar_sugestao: {
        Args: {
          p_alvo_id_unico: string
          p_alvo_tipo: string
          p_confianca: string
          p_id: number
          p_modelo: string
          p_porque: string
        }
        Returns: undefined
      }
      notas_externas_ignorar: {
        Args: { p_id: number; p_motivo?: string }
        Returns: undefined
      }
      notas_externas_janela_medir: { Args: never; Returns: string }
      notas_externas_marcar_copias: { Args: never; Returns: number }
      notas_externas_motivo_por_regra: { Args: never; Returns: Json }
      notas_externas_para_arquivar: {
        Args: { p_limite?: number }
        Returns: {
          enviado_em: string
          fonte: string
          id: number
          link: string
          nome: string
        }[]
      }
      notas_externas_por_alvo: {
        Args: { p_alvo_tipo?: string; p_referencia?: string }
        Returns: {
          alvo_id_unico: string
          casamento: string
          chave_fiscal: string
          competencia: string
          conferencia: string
          confianca: string
          detalhe: string
          diz_anexado: boolean
          drive_id: string
          enviado_em: string
          enviado_erp_em: string
          erp_anexos: number
          erro_erp: string
          fila_erp: boolean
          fonte: string
          link: string
          nome: string
          nota_id: number
          o_que_e: string
          parece_nota: boolean
          status_planilha: string
          tem_arquivo: boolean
          tipo_documento: string
          valor: number
        }[]
      }
      notas_externas_por_que_parou: { Args: never; Returns: Json }
      notas_fiscais_auditoria: {
        Args: { p_ate: string; p_de: string }
        Returns: Json
      }
      notas_fiscais_candidatas: {
        Args: { p_avulsa?: boolean; p_ids: string[] }
        Returns: {
          bloqueio: string
          cnpj_cpf: string
          data_pagamento: string
          data_vencimento: string
          descricao: string
          email: string
          estornado: boolean
          id_asaas: string
          ja_tem_nota: boolean
          n_cod_cli: number
          n_cod_os: number
          status_asaas: string
          valor: number
        }[]
      }
      notas_fiscais_emitidas_hoje: { Args: never; Returns: number }
      notas_fiscais_fila_emissao: {
        Args: { p_limite?: number }
        Returns: {
          cnpj_cpf: string
          data_pagamento: string
          data_vencimento: string
          descricao: string
          email: string
          estornado: boolean
          id_asaas: string
          n_cod_cli: number
          n_cod_os: number
          status_asaas: string
          valor: number
        }[]
      }
      notas_fiscais_fila_resumo: {
        Args: never
        Returns: {
          cobrancas: number
          valor: number
        }[]
      }
      notas_fiscais_log: {
        Args: { p_dias?: number; p_limite?: number }
        Returns: {
          acao: string
          avulsa: boolean
          cliente: string
          criado_em: string
          id_asaas: string
          motivo: string
          n_cod_os: number
          nfse_chave: string
          nfse_numero: string
          operador: string
          resultado: string
          valor: number
        }[]
      }
      notas_fiscais_painel: {
        Args: { p_ate: string; p_de: string }
        Returns: {
          cliente_asaas: string
          cnpj_cpf: string
          data_pagamento: string
          data_vencimento: string
          descricao: string
          estornado: boolean
          id_asaas: string
          n_cod_os: number
          nf_asaas_numero: string
          nf_asaas_status: string
          nfse_chave: string
          nfse_mensagem: string
          nfse_numero: string
          nfse_status: string
          nfse_xml: string
          os_etapa: string
          os_faturada: boolean
          situacao: string
          status_asaas: string
          valor: number
        }[]
      }
      notas_fiscais_painel_json: {
        Args: { p_ate: string; p_de: string }
        Returns: Json
      }
      notas_fiscais_resumo: {
        Args: { p_ate: string; p_de: string }
        Returns: Json
      }
      numero_do_documento: { Args: { txt: string }; Returns: string }
      omie_anexo_link_fila: {
        Args: { p_limite?: number }
        Returns: {
          c_tabela: string
          cod_titulo: number
          id_anexo: string
          nome: string
        }[]
      }
      omie_cache_trocar_categoria: {
        Args: { p_cod_titulo: string; p_codigo: string }
        Returns: number
      }
      omie_categorias_disponiveis: {
        Args: never
        Returns: {
          codigo: string
          descricao: string
          despesa: boolean
          receita: boolean
          rubrica_dfc: string
          rubrica_dre: string
          usos: number
        }[]
      }
      omie_clientes_a_criar: {
        Args: { p_ate?: string; p_de?: string; p_limite?: number }
        Returns: {
          bairro: string
          bloqueio: string
          cep: string
          cidade: string
          cobrancas: number
          complemento: string
          doc: string
          email: string
          endereco: string
          endereco_numero: string
          estado: string
          id_asaas: string
          motivo_anterior: string
          nome: string
          omie_doc: string
          omie_nome: string
          pessoa_fisica: boolean
          sem_nota_hoje: number
          situacao_anterior: string
          telefone: string
          tentativas: number
          ultima: string
          valor: number
          via: string
        }[]
      }
      omie_lancamento: {
        Args: { p_cod_titulo: string }
        Returns: {
          categoria: string
          cod_titulo: string
          contraparte: string
          data: string
          documento: string
          grupo: string
          natureza: string
          status: string
          valor: number
        }[]
      }
      omie_reclassificacoes_detectar: { Args: never; Returns: number }
      omie_titulos_sem_texto: {
        Args: { p_limite?: number; p_so_cartao?: boolean }
        Returns: {
          cod_titulo: number
          contraparte: string
          dt: string
        }[]
      }
      pagamentos_previstos: {
        Args: { p_dia: string; p_janela_dias?: number }
        Returns: {
          categoria_codigo: string
          categoria_descricao: string
          cnpj_cpf: string
          cod_titulo: number
          documento: string
          documento_fiscal: string
          favorecido: string
          fornecedor: string
          observacao: string
          parcela: string
          previsao: string
          status: string
          valor: number
          valor_aberto: number
          vencimento: string
        }[]
      }
      parametrizacao_contrapartes: {
        Args: { p_ate?: string; p_de?: string }
        Returns: {
          categoria: string
          cidade: string
          documento: string
          lancamentos: number
          nome: string
          origem: string
          primeira: string
          total: number
          ultima: string
        }[]
      }
      parametrizacao_evidencias_auditoria: { Args: never; Returns: Json }
      parametrizacao_lancamentos: {
        Args: { p_limite?: number; p_nome: string; p_origem: string }
        Returns: {
          categoria: string
          cidade: string
          data: string
          descricao: string
          valor: number
        }[]
      }
      pergunta_apagar: { Args: { p_id: string }; Returns: undefined }
      pergunta_promover: {
        Args: {
          p_delta?: number
          p_delta_pct?: number
          p_despesa?: boolean
          p_id: string
          p_mes_anterior?: string
          p_valor?: number
          p_valor_anterior?: number
        }
        Returns: undefined
      }
      postgres_fdw_disconnect: { Args: { "": string }; Returns: boolean }
      postgres_fdw_disconnect_all: { Args: never; Returns: boolean }
      postgres_fdw_get_connections: {
        Args: never
        Returns: Record<string, unknown>[]
      }
      postgres_fdw_handler: { Args: never; Returns: unknown }
      preview_msg_ajuste: { Args: { p_id_unico: string }; Returns: Json }
      preview_msg_consolidada:
        | { Args: { p_responsavel: string }; Returns: Json }
        | {
            Args: { p_competencia?: string; p_responsavel: string }
            Returns: Json
          }
      promover_agendamentos_sync: { Args: never; Returns: undefined }
      reativar_cartao: { Args: { p_card_final: string }; Returns: Json }
      reclassificacao_ignorar: {
        Args: { p_escopo?: string; p_id: string; p_motivo?: string }
        Returns: number
      }
      reclassificacao_reabrir: { Args: { p_id: string }; Returns: number }
      registrar_comprovante_via_token: {
        Args: { p_id_unico: string; p_storage_path: string; p_token: string }
        Returns: Json
      }
      rescisao_brl: { Args: { n: number }; Returns: string }
      rescisao_nome_chave: { Args: { p_nome: string }; Returns: string }
      rescisao_registrar: { Args: { p_payload: Json }; Returns: Json }
      rescisao_situacao: {
        Args: {
          p_data_pagamento?: string
          p_id: string
          p_observacao?: string
          p_situacao: string
        }
        Returns: undefined
      }
      rescisao_verbas_pj: { Args: { r: Json }; Returns: Json }
      resolve_colaborador_por_nome: {
        Args: { p_nome: string }
        Returns: {
          id: string
          match_type: string
          nome: string
          telefone: string
        }[]
      }
      resolver_fatura_via_token: {
        Args: { p_digitos: string; p_ip?: string; p_token: string }
        Returns: Json
      }
      resolver_nota_publica: { Args: { p_token: string }; Returns: Json }
      resolver_token: {
        Args: { p_ip?: string; p_token: string }
        Returns: Json
      }
      revisao_decidir: {
        Args: { p_editado?: Json; p_mes: string; p_status?: string }
        Returns: undefined
      }
      revisao_justificativas: { Args: { p_mes: string }; Returns: Json }
      rh_apply_webhook: {
        Args: {
          old_record?: Json
          record?: Json
          schema?: string
          table?: string
          type: string
        }
        Returns: undefined
      }
      rotina_datas: {
        Args: { ate: string; cad: Json; de: string }
        Returns: string[]
      }
      salvar_justificativa_via_token: {
        Args: { p_id_unico: string; p_texto: string; p_token: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sync_rh_colaboradores: { Args: never; Returns: undefined }
      tarefas_rotinas_gerar: { Args: { p_hoje?: string }; Returns: number }
      titulos_por_memo: {
        Args: { p_memos: string[] }
        Returns: {
          cod_titulo: string
          memo: string
        }[]
      }
      token_forte_em_comum: { Args: { a: string; b: string }; Returns: boolean }
      unaccent: { Args: { "": string }; Returns: string }
      validar_token_para_id_unico: {
        Args: { p_id_unico: string; p_token: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
