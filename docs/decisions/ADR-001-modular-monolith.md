# ADR-001: Start with a modular monolith

**Context:** The platform has many high-integrity workflows but is greenfield and operated by a small team.

**Decision:** Deploy one NestJS application with clear modules, explicit APIs, database constraints, and asynchronous queues.

**Alternatives considered:** Microservices add network and operational failure modes too early; a single unstructured application cannot protect domain boundaries.

**Result:** Modules may be extracted only after measured contention, separate scaling needs, or resilience boundaries justify the operational cost.
