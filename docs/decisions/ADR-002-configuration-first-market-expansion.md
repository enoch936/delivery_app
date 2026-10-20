# ADR-002: Market configuration is data, not code

**Decision:** Countries, cities, zones, operating hours, currency, fees, providers and enabled service categories are configuration entities or environment-backed launch settings.

**Why:** The launch city must be changeable; Ethiopia-specific choices cannot be hardcoded across clients and services.

**Guardrail:** A category or provider is not shown as active until its configuration has passed the relevant operational and approval gates.
