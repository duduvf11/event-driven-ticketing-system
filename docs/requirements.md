# System Requirements & Business Rules Document

> **Project:** Event-Driven High-Concurrency Ticketing System  
> **Status:** Verified & Implemented in Production  
> **Version:** 1.0.0  
> **Language:** English | [Versão em Português](requirements.pt-BR.md)  

---

## 1. System Overview

The **Event-Driven Ticketing System** is an event-driven, high-performance platform engineered for issuing, reserving, and settling event tickets under extreme concurrency traffic scenarios (*Flash Sales*).

The architecture is built upon the **Zero Overselling** invariant (strictly preventing sales beyond physical inventory), fault tolerance, distributed concurrency resilience, and asynchronous decoupling powered by AMQP messaging (RabbitMQ) and in-memory caching (Redis).

---

## 2. Functional Requirements (FR)

### 2.1. Authentication, Identity & Security

* **FR01 (User Registration):** The system must allow user registration via `POST /auth/register`, irreversibly hashing passwords with `bcrypt` (minimum 10 salt rounds).
* **FR02 (Credential Confidentiality):** Registration and login response payloads must never disclose plain passwords or password hashes.
* **FR03 (JWT Authentication):** The `POST /auth/login` endpoint must authenticate email and password, issuing a signed JSON Web Token (JWT) via HMAC-SHA256 with a configurable expiration window.
* **FR04 (Route Guards):** All core business routes (`/reservations`, `/orders/:id/pay`, `/orders/:id/cancel`) require an `Authorization: Bearer <token>` header.
* **FR05 (Anti-IDOR Barrier):** The system must strictly restrict users from viewing, paying for, or cancelling orders owned by another user, rejecting unauthorized attempts with `403 Forbidden`.

### 2.2. Events and Ticket Tiers

* **FR06 (Tier Modeling):** Every `TicketTier` is linked to an Event and must specify: unique identifier (UUID), name, unit price, total capacity (`totalQty`), reserved quantity (`reservedQty`), and confirmed sold quantity (`soldQty`).
* **FR07 (Atomic Availability Invariant):** Available inventory for any tier is governed by the invariant formula:
  $$\text{Available} = \text{totalQty} - (\text{reservedQty} + \text{soldQty})$$

### 2.3. Reservation & Order Lifecycle

* **FR08 (Reservation Creation):** The `POST /reservations` endpoint receives `ticketTierId` and `quantity`, atomically reserving the inventory and persisting a purchase order in `PENDING` status with an expiration timestamp (`expiresAt`).
* **FR09 (Reservation & Checkout Idempotency):** Critical state-changing endpoints must support the `x-idempotency-key` or `Idempotency-Key` header. Duplicate submissions with identical keys return the previously processed order (`200 OK`) without double-booking inventory or charging twice.
* **FR10 (Payment Settlement):** The `POST /orders/:id/pay` endpoint validates ownership and `PENDING` status. Upon successful payment, it transitions the order to `CONFIRMED`, converts reserved quantity to sold inventory (`reservedQty -= qty`, `soldQty += qty`), and dispatches an `orders.paid` AMQP event.
* **FR11 (Voluntary Cancellation):** The `POST /orders/:id/cancel` endpoint allows order owners to cancel pending reservations, transitioning status to `CANCELLED`, releasing the hold in PostgreSQL, and immediately replenishing the Redis inventory cache.
* **FR12 (State Machine Integrity):** Orders already in `CONFIRMED` status cannot be cancelled via the cancellation endpoint and are rejected with `400 Bad Request`.

### 2.4. Event-Driven Auto-Expiration (DLX / TTL)

* **FR13 (Polling-Free Scheduling):** Every `PENDING` reservation schedules an expiration message in RabbitMQ with a native message TTL (`x-message-ttl`), completely avoiding expensive database polling *cron jobs*.
* **FR14 (Dead Letter Exchange Routing):** When reservation TTL elapses, RabbitMQ automatically dead-letters the message through a Dead Letter Exchange (`orders.dlx`) into the expiration queue.
* **FR15 (Expiration Consumer Worker):** A dedicated background worker consumes expired messages. If the order remains `PENDING`, it updates status to `EXPIRED`, decrements `reservedQty` in PostgreSQL, and increments the Redis cache. If the order was already paid (`CONFIRMED`) or cancelled (`CANCELLED`), execution acts as a safe *No-op*.

### 2.5. Observability & System Health

* **FR16 (Operational Healthcheck):** The `GET /health` endpoint probes and reports active downstream connectivity in real time (`database: UP`, `redis: UP`, `rabbitmq: UP`).

---

## 3. Business Rules (BR)

* **BR01 (Zero Overselling Mathematical Guarantee):** The sum of reserved and sold tickets must never exceed initial capacity:
  $$\text{reservedQty} + \text{soldQty} \le \text{totalQty}$$
  Any reservation request attempting to allocate beyond available stock must be rejected with `400 Bad Request` indicating the remaining quantity.
* **BR02 (Three-Layer Concurrency Defense):**
  1. *Layer 1 (Optimistic Fast-Fail Cache):* Rapid pre-check against `ticket_tier:<id>:available` in Redis. If stock is below requested quantity, the request fails fast in $< 10\text{ ms}$, eliminating distributed lock contention.
  2. *Layer 2 (Redis Distributed Lock):* Resource locking via unique random token (`lock:ticket_tier:<id>`), safety TTL, and exponential backoff retries.
  3. *Layer 3 (PostgreSQL ACID Transaction):* Row-level verification inside an atomic transaction confirming inventory prior to incrementing `reservedQty` and persisting the order.
* **BR03 (Safe Lock Release via Lua Scripting):** Lock release must compare and delete the lock token atomically using a Redis Lua script, preventing one process from accidentally unlocking a resource acquired by another.
* **BR04 (Anti-IDOR Ownership Verification):** Mutating order operations strictly verify `order.userId === req.user.id`. Cross-tenant violations are rejected with `403 Forbidden`.
* **BR05 (Reservation Atomicity):** If a tier has 3 tickets left and the user requests 4, the transaction is rejected completely (*Fail Fast*). Partial allocations are prohibited.
* **BR06 (Poison Pill Message Barrier):** Workers validate the structural integrity of incoming JSON payloads. Malformed payloads or incomplete schemas are rejected immediately to the DLQ (`channel.nack(msg, false, false)`), preventing infinite consumption loops.

---

## 4. Non-Functional Requirements (NFR)

* **NFR01 (ACID Persistence & Reliability):** **PostgreSQL** paired with **Prisma ORM**, utilizing declarative migrations and automatic rollback transactions.
* **NFR02 (Distributed Caching & Coordination):** **Redis** for real-time inventory counters, distributed rate-limit stores, and distributed locking.
* **NFR03 (Message Brokering & Fault Tolerance):** **RabbitMQ** with Dead Letter Exchanges (`DLX`), disk persistence (`deliveryMode: 2`), and publisher confirmation channels.
* **NFR04 (Flash Sale SLA & Performance):** Confirmed reservations must complete with $p95 < 300\text{ ms}$ under 100 concurrent Virtual Users in the same second.
* **NFR05 (Network Shields & HTTP Security):** **Helmet** security headers (`nosniff`, `SAMEORIGIN`, hidden `X-Powered-By`), strict **CORS** whitelisting, and Redis-backed **Rate Limiting** (`express-rate-limit`).
* **NFR06 (Complete Containerization):** Full stack orchestration (PostgreSQL, Redis, RabbitMQ, and k6) via **Docker Compose**.
* **NFR07 (Quality Assurance & Validation):**
  * Automated end-to-end integration tests using **Jest** and **Supertest** (100% pass rate).
  * High-concurrency load testing scripts using **k6**.
  * Post-test reconciliation audit script exiting with strict binary exit codes (0 for success, 1 for discrepancy).
