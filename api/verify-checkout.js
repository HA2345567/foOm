export default async function handler(req, res) {
  const { checkoutId } = req.query;
  const token = process.env.POLAR_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ success: false, error: "Server config error" });

  try {
    const response = await fetch(`https://api.polar.sh/v1/checkouts/${checkoutId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return res.status(500).json({ success: false, error: "Failed to verify with Polar" });

    const checkout = await response.json();
    const isPro = checkout.status === "succeeded" || checkout.status === "confirmed";
    
    return res.status(200).json({ 
      success: true, 
      isPro,
      email: checkout.customer_email 
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Network error" });
  }
}
