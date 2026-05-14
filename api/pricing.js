export default async function handler(req, res) {
  const token = process.env.POLAR_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ success: false, error: "No token" });

  try {
    const orgsRes = await fetch("https://api.polar.sh/v1/organizations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const orgs = await orgsRes.json();
    if (!orgs.items || orgs.items.length === 0) return res.status(404).json({ success: false, error: "No orgs" });

    const orgId = orgs.items[0].id;
    const productsRes = await fetch(`https://api.polar.sh/v1/products?organization_id=${orgId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const products = await productsRes.json();

    const plans = products.items.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || "",
      price: `$${p.prices?.[0]?.price_amount / 100 || 0}`,
      checkoutUrl: `https://polar.sh/checkout/${p.id}`,
      features: p.benefits?.map((b) => b.description) || [],
      isHighlighted: p.name.toLowerCase().includes("pro"),
    }));

    return res.status(200).json({ success: true, plans });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error" });
  }
}
