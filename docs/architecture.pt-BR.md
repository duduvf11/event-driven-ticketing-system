# Arquitetura do Sistema e Engenharia de Dados

> **Projeto:** Event-Driven High-Concurrency Ticketing System  
> **Status:** Homologado & Implementado em Produção  
> **Versão:** 1.0.0  
> **Idioma:** Português (Brasil) | [English Version](architecture.md)  

---

## 1. Visão Geral da Arquitetura

O sistema implementa uma **Arquitetura Orientada a Eventos (EDA)** projetada para isolar a etapa crítica de reserva atômica de ingressos do processamento de pagamento e da manutenção do ciclo de vida de expiração.

### 1.1. Diagrama de Topologia e Fluxo de Dados

```mermaid
flowchart TD
    Client([Cliente / Web Client]) -->|1. POST /reservations| API[Express REST API]

    subgraph Guards [Camada de Borda & Segurança]
        API --> Helm[Helmet & CORS Policy]
        API --> RL[Redis Rate Limiter rl:reservations]
        API --> Auth[JWT Bearer Auth Middleware]
    end

    subgraph Defense [Defesa em 3 Camadas de Concorrência]
        Auth -->|Passo A: Fast-Fail Check <10ms| RCache[(Redis Inventory Cache)]
        Auth -->|Passo B: Acquire Distributed Lock| RLock[(Redis Distributed Lock)]
        RLock -->|Passo C: ACID Transaction Commit| PG[(PostgreSQL Database)]
        PG -->|Passo D: Decrement Saldo| RCache
        PG -->|Passo E: Safe Lua Release| RLock
    end

    subgraph Messaging [Topologia de Mensageria RabbitMQ]
        PG -->|2. Publica com TTL 15min| QDelay[Queue: reservations.expiration.delay]
        QDelay -.->|TTL Expira sem Consumidor| DLX[Dead Letter Exchange: orders.dlx]
        DLX -->|Roteamento Automático| QExp[Queue: reservations.expiration.process]
        QExp -->|3. Consome Mensagem Expirada| ExpWorker[Expiration Consumer Worker]
        ExpWorker -->|4. Rollback de Estoque| PG
        ExpWorker -->|5. Incrementa Saldo| RCache
    end

    subgraph Settlement [Liquidação de Pagamento]
        Client -->|POST /orders/:id/pay| PayHandler[Payment Controller]
        PayHandler -->|Valida Anti-IDOR| PG
        PayHandler -->|Marca CONFIRMED| PG
        PayHandler -->|Publica Evento| Fanout[Exchange: orders.fanout]
        Fanout --> EmailQueue[Notification Queues]
    end
```

---

## 2. A Estratégia de Defesa de Concorrência em Três Camadas

Para liquidar lotes em segundos (*Flash Sales*) sem sobrecarregar a infraestrutura e eliminando filas de espera desnecessárias, a reserva utiliza uma arquitetura de três barreiras complementares:

### Camada 1: *Optimistic Fast-Fail Cache* (Redis)

* **Objetivo:** Filtrar o tráfego excedente no limiar da memória.
* **Mecanismo:** Antes de solicitar locks ou abrir conexões no PostgreSQL, a API consulta `ticket_tier:<id>:available` no Redis.
* **Impacto:** Quando o lote esgota, 90% das requisições são rejeitadas com `400 Bad Request` em menos de **$10\text{ ms}$**, poupando o banco de dados e eliminando esperas em locks.

### Camada 2: *Distributed Lock* com Token Randômico e Safe Release (Redis)

* **Objetivo:** Impedir *Race Conditions* em escala horizontal.
* **Mecanismo:** Aquisição de chave exclusiva (`lock:ticket_tier:<id>`) com token UUID único, tempo de vida (TTL) de segurança de 5000ms e retentativas com backoff exponencial.
* **Liberação Atômica via Script Lua:** A desalocação do lock utiliza um script Lua executado diretamente no motor do Redis:

  ```lua
  if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
  else
      return 0
  end
  ```

  Isso garante que um processo mais lento jamais libere o lock que já expirou e foi adquirido por outro nó.

### Camada 3: Transação ACID em Nível de Linha (PostgreSQL)

* **Objetivo:** Consistência transacional e autoridade contábil final.
* **Mecanismo:** Dentro de uma transação isolada (`prisma.$transaction`), a linha do lote é consultada, o saldo invariante é comprovado (`totalQty - (reservedQty + soldQty) >= requestedQty`), a reserva é incrementada (`reservedQty += qty`) e o pedido `PENDING` é persistido com data de expiração.

---

## 3. Máquina de Estados Finita (FSM) dos Pedidos

O ciclo de vida das ordens segue uma máquina de estados estrita que previne mutações espúrias e cancelamentos indevidos:

```mermaid
stateDiagram-v2
    [*] --> PENDING: POST /reservations
    
    PENDING --> CONFIRMED: POST /orders/:id/pay (Sucesso)
    PENDING --> CANCELLED: POST /orders/:id/cancel (Voluntário)
    PENDING --> EXPIRED: TTL Expirado (RabbitMQ DLX Worker)

    CONFIRMED --> [*]: Estado Terminal (Imutável)
    CANCELLED --> [*]: Estado Terminal (Estoque Devolvido)
    EXPIRED --> [*]: Estado Terminal (Estoque Devolvido)
```

### Regras de Transição

1. **`PENDING` $\rightarrow$ `CONFIRMED`:** Apenas o titular pode pagar (Anti-IDOR). Transfere ingressos de `reservedQty` para `soldQty` e emite o evento `orders.paid`.
2. **`PENDING` $\rightarrow$ `CANCELLED`:** Cancela a reserva voluntariamente, restaura `reservedQty` no banco e incrementa o saldo no Redis.
3. **`PENDING` $\rightarrow$ `EXPIRED`:** O RabbitMQ DLX entrega a mensagem expirada ao worker, que atualiza o status e devolve os ingressos ao inventário.
4. **`CONFIRMED` $\rightarrow$ Tentativa de Cancelamento:** Rejeitado com código `400 Bad Request` (*"Cannot cancel an order that has already been paid and confirmed"*).

---

## 4. Diagrama Entidade-Relacionamento (Prisma ERD)

O esquema relacional garante integridade referencial estrita e isolamento entre eventos, lotes e itens de pedidos:

```mermaid
erDiagram
    User ||--o{ Order : "realiza"
    Event ||--|{ TicketTier : "possui"
    TicketTier ||--o{ OrderItem : "composto_por"
    Order ||--|{ OrderItem : "contém"

    User {
        string id PK "UUID v4"
        string name "Nome completo"
        string email UK "E-mail exclusivo"
        string passwordHash "Bcrypt salt 10"
        datetime createdAt
        datetime updatedAt
    }

    Event {
        string id PK "UUID v4"
        string title "Título do Evento"
        string description "Descrição"
        string location "Local ou Arena"
        datetime eventDate "Data de realização"
        datetime createdAt
        datetime updatedAt
    }

    TicketTier {
        string id PK "UUID v4"
        string eventId FK "Referência ao Evento"
        string name "Ex: VIP Keynote Pass"
        decimal price "Preço unitário"
        int totalQty "Capacidade total"
        int reservedQty "Quantidade reservada temporariamente"
        int soldQty "Quantidade confirmada/paga"
        datetime createdAt
        datetime updatedAt
    }

    Order {
        string id PK "UUID v4"
        string userId FK "Referência ao Usuário"
        string status "PENDING | CONFIRMED | CANCELLED | EXPIRED"
        decimal totalAmount "Valor total do pedido"
        string idempotencyKey UK "Chave de Idempotência"
        datetime expiresAt "Data limite de expiração"
        datetime createdAt
        datetime updatedAt
    }

    OrderItem {
        string id PK "UUID v4"
        string orderId FK "Referência ao Pedido"
        string ticketTierId FK "Referência ao Lote"
        int quantity "Quantidade reservada"
        decimal unitPrice "Preço unitário congelado"
        datetime createdAt
    }
```

---

## 5. Arquitetura de Expiração Event-Driven via AMQP DLX (Sem Polling)

Diferente de sistemas legados que dependem de consultas repetitivas de varredura no banco (`SELECT WHERE expires_at < NOW()`), este projeto adota agendamento nativo por mensagens:

1. **Publicação com TTL:** Ao criar a reserva, a API publica uma mensagem na fila `reservations.expiration.delay` configurada com `x-message-ttl: 900000` (15 minutos) e vinculada à Dead Letter Exchange `orders.dlx`.
2. **Sem Consumidor na Fila de Atraso:** A fila de atraso não possui consumidores conectados; as mensagens aguardam passivamente no broker.
3. **Morte e Roteamento para a DLQ:** Ao atingir o TTL, o RabbitMQ descarta a mensagem da fila original e a encaminha automaticamente via `orders.dlx` para a fila de processamento `reservations.expiration.process`.
4. **Processamento no Worker:** O `reservation-expiration.consumer.ts` consome a mensagem, aplica proteção contra *Poison Pills* e transaciona o status do pedido para `EXPIRED`.

---

## 6. Decisões de Arquitetura e Compensações (*Trade-offs*)

| Decisão Tomada | Alternativa Rejeitada | Justificativa Técnica |
| :--- | :--- | :--- |
| **Dead Letter Exchange (DLX) com TTL** | Cron Job Poller no Banco (`node-cron`) | Elimina overhead de I/O de queries periódicas (`SELECT`) no banco de dados e escala com precisão milimétrica de entrega de eventos. |
| **Optimistic Fast-Fail no Redis** | Enfileiramento cego no Distributed Lock | Reduz o tempo de resposta das requisições excedentes de ~9 segundos para $< 10\text{ ms}$, evitando contenção desnecessária de conexões. |
| **Distributed Lock (Redis) + ACID (PG)** | Pessimistic Locking (`SELECT FOR UPDATE`) | Permite coordenação de múltiplos nós e instâncias sem bloquear tabelas inteiras no PostgreSQL ou causar deadlocks sob concorrência massiva. |
| **Desacoplamento `app.ts` / `server.ts`** | Instanciação e listen no mesmo arquivo | Permite execução de testes automatizados via Supertest em memória sem alocação de portas TCP físicas e sem colisões de socket. |
