export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { email } = req.body;
  const token = process.env.POLAR_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ success: false, error: "Server config error" });

  try {
    const customerRes = await fetch(`https://api.polar.sh/v1/customers?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const customers = await customerRes.json();
    
    if (!customers.items || customers.items.length === 0) {
      return res.status(404).json({ success: false, error: "No customer found" });
    }

    const customerId = customers.items[0].id;
    const subRes = await fetch(`https://api.polar.sh/v1/subscriptions?customer_id=${customerId}&active=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const subs = await subRes.json();
    const activeSub = subs.items?.find((s) => s.status === "active" || s.status === "trialing");

    if (activeSub) {
      return res.status(200).json({ success: true, isPro: true, email });
    }

    return res.status(200).json({ success: false, error: "No active subscription" });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Network error" });
  }
}
