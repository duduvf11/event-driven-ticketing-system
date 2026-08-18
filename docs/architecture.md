# Arquitetura do Sistema e Fluxo de Dados

**Projeto:** Event-Driven Ticketing System

---

## 1. Visão Geral da Arquitetura

O sistema adota uma arquitetura orientada a eventos (*Event-Driven Architecture*) para desacoplar a etapa crítica de reserva temporária de ingressos da etapa de processamento financeiro e liquidação de pedidos.

```mermaid
flowchart TD
    Client([Cliente / Frontend]) -->|1. POST /orders| API[API REST]
    
    subgraph Síncrono [Tempo Real: p95 < 150ms]
        API -->|2. Check Idempotência| Redis[(Redis)]
        API -->|3. Decremento Atômico| Postgres[(PostgreSQL)]
        API -->|4. Publica Evento: order.created| RMQ[RabbitMQ Queue]
    end

    API -->|5. Resposta: 202 Accepted| Client

    subgraph Assíncrono [Processamento em Segundo Plano]
        RMQ -->|6. Consome Mensagem| Worker[Payment Worker]
        Worker -->|7. Processa Cobrança| Gateway[Gateway de Pagamento]
        Worker -->|8. Atualiza Status para PAID / FAILED| Postgres
    end

    subgraph Manutenção de Estoque
        Cron[Expiration Cron / Worker] -->|9. Identifica Reservas Expiradas| Postgres
        Cron -->|10. Devolve Estoque & Marca EXPIRED| Postgres
    end
```

---

## 2. Diagrama Entidade-Relacionamento (ER)

O modelo relacional foi desenhado para isolar o estoque por lote (`ticket_tiers`) e garantir a integridade referencial dos pedidos:

```mermaid
erDiagram
    USERS ||--o{ ORDERS : "realiza"
    EVENTS ||--|{ TICKET_TIERS : "possui"
    TICKET_TIERS ||--o{ ORDER_ITEMS : "composto_por"
    ORDERS ||--|{ ORDER_ITEMS : "contém"

    USERS {
        uuid id PK
        string name
        string email UK
        string password_hash
        string role "CUSTOMER | ADMIN"
        timestamp created_at
    }

    EVENTS {
        uuid id PK
        string title
        string description
        string location
        timestamp start_time
        timestamp end_time
        timestamp created_at
    }

    TICKET_TIERS {
        uuid id PK
        uuid event_id FK
        string name "Ex: Pista Lote 1"
        int price_in_cents
        int total_quantity
        int available_quantity
    }

    ORDERS {
        uuid id PK
        uuid user_id FK
        string status "PENDING_PAYMENT | PAID | EXPIRED | CANCELLED"
        string idempotency_key UK
        int total_amount_in_cents
        timestamp expires_at
        timestamp created_at
    }

    ORDER_ITEMS {
        uuid id PK
        uuid order_id FK
        uuid ticket_tier_id FK
        int quantity
        int unit_price_in_cents
    }
```

---

## 3. Principais Decisões Arquiteturais e Trade-offs

1. **Separação entre Reserva e Pagamento:**
   * **Decisão:** A API só reserva o recurso no PostgreSQL e envia para a fila do RabbitMQ.
   * **Trade-off:** O cliente não recebe o status final imediatamente na resposta HTTP; ele recebe `202 Accepted` e consulta o status ou aguarda notificação via polling/webhook. Em troca, a API suporta picos massivos de tráfego sem derrubar o banco.

2. **Tipagem Monetária em Inteiros (`*_in_cents`):**
   * **Decisão:** Preços e totais armazenados em centavos (ex: R$ 100,00 $\rightarrow$ `10000`).
   * **Motivo:** Evita inconsistências de arredondamento causadas pela representação binária de números de ponto flutuante (`float`/`double`).
