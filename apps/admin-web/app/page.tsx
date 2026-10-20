const controls = ["Orders", "Couriers", "Merchants", "Service zones", "Configuration", "Audit trail"];

export default function OperationsHome() {
  return (
    <main>
      <header>
        <p className="eyebrow">KORA / OPERATIONS</p>
        <h1>Operate deliberately.</h1>
        <p className="lede">The operations console is connected only after an authenticated API and role policy are in place. No metric below is presented as live data.</p>
      </header>
      <section aria-label="Foundation status" className="status-card">
        <span aria-hidden="true">●</span>
        <div><strong>Foundation mode</strong><p>Identity, authorization and persisted operational metrics are the next gated capabilities.</p></div>
      </section>
      <section aria-label="Planned operations areas" className="grid">
        {controls.map((control) => <article key={control}><h2>{control}</h2><p>Requires authorized, persisted backend data before activation.</p></article>)}
      </section>
    </main>
  );
}
