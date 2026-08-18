# Documento de Requisitos e Regras de Negócio

**Projeto:** Event-Driven Ticketing System  
**Status:** Em Especificação

---

## 1. Visão Geral

O **Event-Driven Ticketing System** é uma API REST orientada a eventos para emissão e compra de ingressos sob alta demanda. O sistema foi projetado para lidar com concorrência massiva de reservas sem permitir estoque negativo (*overbooking*), desacoplando o checkout do processamento financeiro por meio de mensageria assíncrona.

---

## 2. Requisitos Funcionais (RF)

### 2.1 Autenticação e Usuários

* **RF01:** O sistema deve permitir o cadastro e autenticação de usuários (clientes e administradores).
* **RF02:** Apenas usuários autenticados podem reservar ou comprar ingressos.
* **RF03:** Apenas administradores podem criar, editar ou cancelar eventos e lotes de ingressos.

### 2.2 Eventos e Lotes (Ticket Tiers)

* **RF04:** O sistema deve permitir a listagem de eventos com seus respectivos lotes de ingressos e quantidades disponíveis.
* **RF05:** Cada lote de ingresso deve conter nome, preço unitário (em centavos), capacidade total e quantidade disponível em tempo real.

### 2.3 Reservas e Pedidos

* **RF06:** O sistema deve permitir a criação de uma reserva temporária de ingressos (`POST /orders`).
* **RF07:** O pedido reservado deve ser criado com o status `PENDING_PAYMENT` e um prazo de expiração (`expires_at`) definido para 10 minutos após a criação.
* **RF08:** O sistema deve enviar o pedido para processamento de pagamento assíncrono via mensageria (`RabbitMQ`).
* **RF09:** O sistema deve permitir a consulta do status de um pedido pelo seu identificador (`GET /orders/:id`).

### 2.4 Expiração e Liberação de Estoque

* **RF10:** Um processo em segundo plano (*Worker*) deve identificar pedidos em `PENDING_PAYMENT` cujo tempo de expiração (`expires_at`) foi atingido.
* **RF11:** Pedidos expirados devem ter o status atualizado para `EXPIRED` e a quantidade de ingressos reservada deve ser devolvida automaticamente ao lote correspondente.

---

## 3. Regras de Negócio (RN)

* **RN01 (Prevenção de Overbooking):** A reserva de ingressos deve ocorrer de forma atômica e condicional no banco de dados (`WHERE available_quantity >= requested_quantity`). O estoque jamais pode atingir valores negativos.
* **RN02 (Idempotência no Checkout):** O endpoint de pagamento deve exigir o cabeçalho `Idempotency-Key`. Requisições duplicadas com a mesma chave dentro da janela de validade não devem gerar cobranças adicionais.
* **RN03 (Representação Monetária):** Todos os valores monetários (preços e totais) devem ser expressos e persistidos como números inteiros (centavos), evitando erros de arredondamento de ponto flutuante.
* **RN04 (Limite de Reserva por Pedido):** Um usuário pode reservar no máximo 4 ingressos por pedido em um único evento.
* **RN05 (Atomicidade da Reserva):** Se um pedido solicitar múltiplos ingressos e não houver quantidade suficiente para atender à totalidade do pedido, a transação deve ser abortada por inteiro (*Fail Fast*).

---

## 4. Requisitos Não-Funcionais (RNF)

* **RNF01 (Persistência Principal):** Utilização do banco de dados relacional **PostgreSQL** para garantir consistência ACID nos dados de eventos, usuários e pedidos.
* **RNF02 (Desacoplamento e Mensageria):** O processamento de pagamentos deve ser processado de forma assíncrona utilizando **RabbitMQ**.
* **RNF03 (Controle de Concorrência e Cache):** Uso de **Redis** para gerenciamento de chaves de idempotência e travas temporárias.
* **RNF04 (Containerização):** Todo o ambiente de infraestrutura local (PostgreSQL, RabbitMQ, Redis) deve ser provisionado via **Docker Compose**.
* **RNF05 (Tempo de Resposta da Reserva):** A rota de criação de reserva (`POST /orders`) deve responder em $p95 < 150\text{ ms}$, delegando tarefas pesadas aos workers.
