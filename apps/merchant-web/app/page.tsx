const journeys = [
  ["01", "Onboard", "Business verification and merchant profile"],
  ["02", "Catalogue", "Products, availability and precise ETB pricing"],
  ["03", "Fulfil", "Authorized acceptance and preparation workflows"],
  ["04", "Reconcile", "Sales, fees, payouts and support records"]
];

export default function MerchantHome() {
  return <main>
    <header><p className="eyebrow">KORA / MERCHANT</p><h1>Make every handoff count.</h1><p className="lede">A merchant workspace designed around reliable fulfilment, not decorative dashboards.</p></header>
    <section className="journeys" aria-label="Merchant capability roadmap">
      {journeys.map(([number, title, detail]) => <article key={number}><span>{number}</span><h2>{title}</h2><p>{detail}</p></article>)}
    </section>
    <p className="notice">Merchant sign-in activates only after identity, organization membership, and audit policies are implemented.</p>
  </main>;
}
