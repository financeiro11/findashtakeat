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
  public: {
    Tables: {
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
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
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
          user_id: string
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
          user_id: string
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
          user_id?: string
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
      auditoria: {
        Row: {
          area: string
          categoria: string | null
          competencia: string
          created_at: string
          data_lancamento: string | null
          descricao: string | null
          id: number
          id_transacao: string | null
          id_unico: string
          justificativa: string | null
          link_comprovante: string | null
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
          id?: never
          id_transacao?: string | null
          id_unico: string
          justificativa?: string | null
          link_comprovante?: string | null
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
          id?: never
          id_transacao?: string | null
          id_unico?: string
          justificativa?: string | null
          link_comprovante?: string | null
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
          link_comprovante: string | null
          observacao: string | null
          omie_categoria_codigo: string | null
          omie_categoria_descricao: string | null
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
          link_comprovante?: string | null
          observacao?: string | null
          omie_categoria_codigo?: string | null
          omie_categoria_descricao?: string | null
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
          link_comprovante?: string | null
          observacao?: string | null
          omie_categoria_codigo?: string | null
          omie_categoria_descricao?: string | null
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
          referencia?: string
          status?: string
          tem_comprovante?: boolean
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      automacoes_catalogo: {
        Row: {
          automacao: string
          categoria: string | null
          created_at: string
          dor: string | null
          execucoes: number
          ferramentas: string | null
          horas_mes: number | null
          id: string
          impacto: string | null
          observacao: string | null
          ordem: number
          responsavel: string | null
          solucao: string | null
          status: string
          ultima_falha: string | null
          updated_at: string
        }
        Insert: {
          automacao: string
          categoria?: string | null
          created_at?: string
          dor?: string | null
          execucoes?: number
          ferramentas?: string | null
          horas_mes?: number | null
          id?: string
          impacto?: string | null
          observacao?: string | null
          ordem?: number
          responsavel?: string | null
          solucao?: string | null
          status?: string
          ultima_falha?: string | null
          updated_at?: string
        }
        Update: {
          automacao?: string
          categoria?: string | null
          created_at?: string
          dor?: string | null
          execucoes?: number
          ferramentas?: string | null
          horas_mes?: number | null
          id?: string
          impacto?: string | null
          observacao?: string | null
          ordem?: number
          responsavel?: string | null
          solucao?: string | null
          status?: string
          ultima_falha?: string | null
          updated_at?: string
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
          ano: number
          created_at: string
          dados: Json
          id: string
          observacao: string | null
          updated_at: string
        }
        Insert: {
          ano: number
          created_at?: string
          dados?: Json
          id?: string
          observacao?: string | null
          updated_at?: string
        }
        Update: {
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
          codigo: string | null
          created_at: string
          descricao: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          codigo?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          codigo?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
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
          categoria: string | null
          contato_email: string | null
          contato_nome: string | null
          contato_telefone: string | null
          created_at: string
          documento: string | null
          id: string
          nome: string
          observacao: string | null
          status: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          categoria?: string | null
          contato_email?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          documento?: string | null
          id?: string
          nome: string
          observacao?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          categoria?: string | null
          contato_email?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          documento?: string | null
          id?: string
          nome?: string
          observacao?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      lib_politicas: {
        Row: {
          aplica_a: string[]
          ativa: boolean
          categoria: string | null
          conteudo: string
          created_at: string
          id: string
          tags: string[]
          titulo: string
          updated_at: string
        }
        Insert: {
          aplica_a?: string[]
          ativa?: boolean
          categoria?: string | null
          conteudo: string
          created_at?: string
          id?: string
          tags?: string[]
          titulo: string
          updated_at?: string
        }
        Update: {
          aplica_a?: string[]
          ativa?: boolean
          categoria?: string | null
          conteudo?: string
          created_at?: string
          id?: string
          tags?: string[]
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      magic_tokens: {
        Row: {
          acessos: number
          colaborador_id: string | null
          criado_em: string
          criado_por: string | null
          enviado_para: string | null
          expira_em: string
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
          colaborador_id?: string | null
          criado_em?: string
          criado_por?: string | null
          enviado_para?: string | null
          expira_em: string
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
          colaborador_id?: string | null
          criado_em?: string
          criado_por?: string | null
          enviado_para?: string | null
          expira_em?: string
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
          proprietario: string
          proxima_recarga: string | null
          setor: string | null
          situacao: string | null
          ultima_recarga: string | null
          updated_at: string
          valor: number | null
          verificado: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          numero?: string | null
          proprietario: string
          proxima_recarga?: string | null
          setor?: string | null
          situacao?: string | null
          ultima_recarga?: string | null
          updated_at?: string
          valor?: number | null
          verificado?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          numero?: string | null
          proprietario?: string
          proxima_recarga?: string | null
          setor?: string | null
          situacao?: string | null
          ultima_recarga?: string | null
          updated_at?: string
          valor?: number | null
          verificado?: string | null
        }
        Relationships: []
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
      tarefas: {
        Row: {
          created_at: string
          id: string
          observacao: string | null
          ordem: number
          prazo: string | null
          prioridade: string
          responsavel: string | null
          status: string
          subtarefas: Json
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          observacao?: string | null
          ordem?: number
          prazo?: string | null
          prioridade?: string
          responsavel?: string | null
          status?: string
          subtarefas?: Json
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          observacao?: string | null
          ordem?: number
          prazo?: string | null
          prioridade?: string
          responsavel?: string | null
          status?: string
          subtarefas?: Json
          titulo?: string
          updated_at?: string
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
      append_trilha_e_status: {
        Args: { p_evento: Json; p_id_unico: string; p_status: string }
        Returns: undefined
      }
      apply_orcamento_realizado_omie: {
        Args: { p_ano: number; p_dados: Json }
        Returns: number
      }
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
      fmt_brl: { Args: { v: number }; Returns: string }
      hub_base_url: { Args: never; Returns: string }
      importar_auditoria: {
        Args: { p_achados: Json }
        Returns: {
          atualizados: number
          inseridos: number
        }[]
      }
      normaliza_nome: { Args: { p_nome: string }; Returns: string }
      preview_msg_ajuste: { Args: { p_id_unico: string }; Returns: Json }
      preview_msg_consolidada: {
        Args: { p_responsavel: string }
        Returns: Json
      }
      registrar_comprovante_via_token: {
        Args: { p_id_unico: string; p_storage_path: string; p_token: string }
        Returns: Json
      }
      resolve_colaborador_por_nome: {
        Args: { p_nome: string }
        Returns: {
          id: string
          match_type: string
          nome: string
          telefone: string
        }[]
      }
      resolver_token: {
        Args: { p_ip?: string; p_token: string }
        Returns: Json
      }
      salvar_justificativa_via_token: {
        Args: { p_id_unico: string; p_texto: string; p_token: string }
        Returns: Json
      }
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
  public: {
    Enums: {},
  },
} as const
