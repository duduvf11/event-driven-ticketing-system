# Documento de Requisitos e Regras de Negócio

> **Projeto:** Event-Driven High-Concurrency Ticketing System  
> **Status:** Homologado & Implementado em Produção  
> **Versão:** 1.0.0  
> **Idioma:** Português (Brasil) | [English Version](requirements.md)  

---

## 1. Visão Geral do Sistema

O **Event-Driven Ticketing System** é uma plataforma de alta performance orientada a eventos para emissão, reserva e liquidação de ingressos sob cenários de tráfego de concorrência extrema (*Flash Sales*).

O sistema foi arquitetado com base no princípio de **Zero Overselling** (nenhuma venda acima do estoque real), tolerância a falhas, resiliência de concorrência distribuída e desacoplamento assíncrono via mensageria AMQP (RabbitMQ) e cache em memória (Redis).

---

## 2. Requisitos Funcionais (RF)

### 2.1. Autenticação, Identidade e Segurança

* **RF01 (Cadastro de Usuário):** O sistema deve permitir o registro de novos usuários através do endpoint `POST /auth/register`, persistindo senhas criptografadas com hash irreversível via `bcrypt` (salt rounds mínimo 10).
* **RF02 (Proteção de Credenciais):** O payload de resposta de registro e autenticação nunca deve expor a senha ou o hash de senha do usuário.
* **RF03 (Autenticação JWT):** O endpoint `POST /auth/login` deve autenticar e-mail e senha e emitir um JSON Web Token (JWT) assinado com algoritmo HMAC-SHA256 e prazo de expiração configurável.
* **RF04 (Guardas de Rota):** Todas as rotas de negócio (`/reservations`, `/orders/:id/pay`, `/orders/:id/cancel`) devem exigir autenticação obrigatória via cabeçalho `Authorization: Bearer <token>`.
* **RF05 (Blindagem Anti-IDOR):** O sistema deve impedir que um usuário acesse, pague ou cancele pedidos que pertençam a outro usuário, rejeitando a tentativa com status `403 Forbidden`.

### 2.2. Eventos e Lotes de Ingressos (Ticket Tiers)

* **RF06 (Modelagem de Lotes):** Cada lote de ingressos (`TicketTier`) deve ser associado a um evento e conter obrigatoriamente: identificador único (UUID), nome descritivo, preço unitário, capacidade total (`totalQty`), quantidade reservada (`reservedQty`) e quantidade vendida (`soldQty`).
* **RF07 (Cálculo de Disponibilidade Atômica):** O estoque disponível de um lote é obtido pela fórmula invariante:
  $$\text{Disponível} = \text{totalQty} - (\text{reservedQty} + \text{soldQty})$$

### 2.3. Ciclo de Vida de Reservas e Pedidos

* **RF08 (Criação de Reserva):** O endpoint `POST /reservations` deve receber `ticketTierId` e `quantity`, reservando atomicamente os ingressos e criando um pedido com status `PENDING` e prazo de expiração (`expiresAt`).
* **RF09 (Idempotência de Reserva e Checkout):** As operações críticas devem aceitar o cabeçalho `x-idempotency-key` ou `Idempotency-Key`. Requisições duplicadas com a mesma chave dentro do ciclo de vida do pedido devem retornar o pedido previamente processado (`200 OK`) sem alocar novo estoque ou cobrar duas vezes.
* **RF10 (Liquidação de Pagamento):** O endpoint `POST /orders/:id/pay` deve validar a titularidade do pedido e seu status (`PENDING`). Ao liquidar com sucesso, deve transicionar o pedido para `CONFIRMED`, converter a quantidade reservada em vendida (`reservedQty -= qty`, `soldQty += qty`) e publicar o evento `orders.paid` na mensageria.
* **RF11 (Cancelamento Voluntário):** O endpoint `POST /orders/:id/cancel` permite ao titular cancelar um pedido pendente, transicionando o status para `CANCELLED`, liberando a reserva no PostgreSQL e restaurando a disponibilidade do estoque no Redis imediatamente.
* **RF12 (Integridade da Máquina de Estados):** Pedidos que já se encontram em estado `CONFIRMED` não podem ser cancelados via endpoint de cancelamento, sendo rejeitados com `400 Bad Request`.

### 2.4. Expiração Automática Orientada a Eventos (DLX / TTL)

* **RF13 (Agendamento sem Polling):** Toda reserva `PENDING` criada deve ter um evento de expiração agendado no RabbitMQ com TTL nativo (`x-message-ttl`), sem necessidade de consultas periódicas em banco de dados (*cron jobs*).
* **RF14 (Roteamento via Dead Letter Exchange):** Ao expirar o tempo limite de reserva, o RabbitMQ deve encaminhar a mensagem automaticamente através de uma Dead Letter Exchange (`orders.dlx`) para a fila de processamento de expiração.
* **RF15 (Worker de Expiração):** Um consumidor dedicado deve processar a mensagem expirada. Se o pedido ainda estiver em estado `PENDING`, ele deve ser atualizado para `EXPIRED`, seu estoque reservado deve ser devolvido ao lote no PostgreSQL e o saldo do cache no Redis deve ser incrementado. Se o pedido já tiver sido pago (`CONFIRMED`) ou cancelado (`CANCELLED`), nenhuma mutação é executada (*No-op*).

### 2.5. Observabilidade e Saúde do Sistema

* **RF16 (Healthcheck Operacional):** O endpoint `GET /health` deve verificar e reportar em tempo real a conectividade ativa de todas as dependências de infraestrutura (`database: UP`, `redis: UP`, `rabbitmq: UP`).

---

## 3. Regras de Negócio (RN)

* **RN01 (Garantia Matemática de Zero Overselling):** Sob hipótese alguma o somatório de ingressos reservados e vendidos pode exceder o estoque inicial do lote:
  $$\text{reservedQty} + \text{soldQty} \le \text{totalQty}$$
  Qualquer requisição que tente reservar ingressos acima da capacidade disponível deve ser rejeitada com `400 Bad Request` informando a quantidade restante.
* **RN02 (Três Camadas de Defesa de Concorrência):**
  1. *Camada 1 (Optimistic Fast-Fail Cache):* Consulta preliminar na chave `ticket_tier:<id>:available` no Redis. Se o saldo for menor que a quantidade requisitada, a requisição falha instantaneamente em $< 10\text{ ms}$, sem disputar o lock distribuído.
  2. *Camada 2 (Distributed Lock no Redis):* Uso de lock com token randômico exclusivo (`lock:ticket_tier:<id>`), TTL de segurança e retentativas com backoff exponencial.
  3. *Camada 3 (Transação ACID no PostgreSQL):* Transação isolada no banco de dados que revalida o estoque na linha do registro antes de incrementar `reservedQty` e persistir a ordem.
* **RN03 (Liberação Segura de Locks via Lua):** O token de travamento do lock distribuído deve ser comparado e deletado atomicamente via script Lua no Redis, evitando que um worker libere o lock pertencente a outro processo.
* **RN04 (Validação de Titularidade Anti-IDOR):** As operações em pedidos verificam estritamente `order.userId === req.user.id`. Tentativas de acesso entre tenants/usuários distintos são rejeitadas com `403 Forbidden`.
* **RN05 (Atomicidade da Reserva):** Se um lote possuir 3 ingressos e o usuário solicitar 4, o pedido é rejeitado na íntegra (*Fail Fast*). Não existe alocação parcial de ingressos.
* **RN06 (Barreira contra Poison Pills na Mensageria):** O worker consumidor de mensagens deve validar a integridade estrutural do JSON recebido. Mensagens malformadas ou com campos ausentes devem ser descartadas com rejeição direta para DLQ (`channel.nack(msg, false, false)`), prevenindo travamento do worker em loops infinitos.

---

## 4. Requisitos Não-Funcionais (RNF)

* **RNF01 (Persistência e Confiabilidade ACID):** Utilização do **PostgreSQL** com **Prisma ORM**, aplicando migrações declarativas e transações com rollback automático em caso de falha.
* **RNF02 (Cache e Coordenação Distribuída):** Utilização do **Redis** para armazenamento de contadores de inventário, controle de taxa (*Rate Limiting*) e semáforos distribuídos.
* **RNF03 (Mensageria e Tolerância a Falhas):** Utilização do **RabbitMQ** com suporte a Dead Letter Exchanges (`DLX`), mensagens com persistência em disco (`deliveryMode: 2`) e canais de confirmação.
* **RNF04 (Desempenho de Flash Sale):** O sistema deve processar requisições sob disputa simultânea em $p95 < 300\text{ ms}$ para reservas confirmadas, suportando pelo menos 100 Virtual Users no mesmo segundo.
* **RNF05 (Blindagem de Rede e Segurança HTTP):** Aplicação de headers de proteção via **Helmet** (`nosniff`, `SAMEORIGIN`, supressão de `X-Powered-By`), política de **CORS** restritiva e **Rate Limiting** distribuído via Redis Store (`express-rate-limit`).
* **RNF06 (Containerização Total):** Provisionamento de todo o ecossistema (PostgreSQL, Redis, RabbitMQ e k6) através do **Docker Compose**.
* **RNF07 (Garantia de Qualidade e Cobertura):**
  * Suítes de testes de integração automatizados com **Jest** e **Supertest** (100% de aprovação).
  * Scripts de teste de carga com **k6** e script de auditoria de reconciliação contábil pós-teste com saída em exit code binário (0 para sucesso, 1 para discrepância).
