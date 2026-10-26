export async function createSquareInvoice(params: {
  bookingId: string;
  invoiceNumber: number;
  customerName: string;
  customerEmail?: string;
  lineItems: { description: string; amount: number }[];
  note?: string;
}) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const baseUrl = process.env.SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";

  if (!token || !locationId) {
    console.warn("Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID");
    return null;
  }

  const headers = {
    "Square-Version": "2024-03-20",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    // 1. First create an Order
    if (params.lineItems.length === 0) {
    return null;
  }

  const orderPayload = {
      idempotency_key: `order_${params.bookingId}_${Date.now()}`,
      order: {
        location_id: locationId,
        reference_id: params.bookingId,
        line_items: params.lineItems.map((li) => ({
          name: li.description.substring(0, 500),
          quantity: "1",
          base_price_money: {
            amount: li.amount * 100, // Amount is in dollars, convert to cents
            currency: "USD",
          },
        })),
      },
    };

    const orderRes = await fetch(`${baseUrl}/v2/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify(orderPayload),
    });

    if (!orderRes.ok) {
      console.error("Square order error:", await orderRes.text());
      return null;
    }

    const orderData = await orderRes.json();
    const orderId = orderData.order.id;

    // 2. We need a Customer ID to create an invoice. 
    // Square invoices require a primary_recipient with a customer_id.
    // We'll search for the customer by email, or create one.
    let customerId = undefined;
    let customerEmail = params.customerEmail;
    if (!customerEmail || !customerEmail.includes("@")) {
      customerEmail = "billing@lukashahn.media"; 
    }

    const searchRes = await fetch(`${baseUrl}/v2/customers/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: {
          filter: {
            email_address: {
              exact: customerEmail
            }
          }
        }
      })
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.customers && searchData.customers.length > 0) {
        customerId = searchData.customers[0].id;
      }
    }

    if (!customerId) {
      const custPayload = {
        idempotency_key: `cust_${params.bookingId}_${Date.now()}`,
        given_name: params.customerName.split(" ")[0] || "Client",
        family_name: params.customerName.split(" ").slice(1).join(" ") || "",
        email_address: customerEmail,
      };
      const custRes = await fetch(`${baseUrl}/v2/customers`, {
        method: "POST",
        headers,
        body: JSON.stringify(custPayload),
      });
      if (custRes.ok) {
        const custData = await custRes.json();
        customerId = custData.customer.id;
      }
    }

    if (!customerId) {
       console.error("Could not create/find Square customer");
       return null;
    }

    // 3. Create the Invoice
    const invoicePayload = {
      idempotency_key: `inv_${params.bookingId}_${Date.now()}`,
      invoice: {
        order_id: orderId,
        location_id: locationId,
        primary_recipient: {
          customer_id: customerId,
        },
        delivery_method: "SHARE_MANUALLY",
        invoice_number: params.invoiceNumber.toString(),
        title: "Photo & Video Services",
        description: params.note || "Thank you for your business!",
        payment_requests: [
          {
            request_type: "BALANCE",
            due_date: new Date().toISOString().split("T")[0],
          },
        ],
        accepted_payment_methods: {
          card: true,
          bank_account: true,
        },
      },
    };

    let invoiceRes = await fetch(`${baseUrl}/v2/invoices`, {
      method: "POST",
      headers,
      body: JSON.stringify(invoicePayload),
    });

    if (!invoiceRes.ok) {
      const errorText = await invoiceRes.text();
      if (errorText.includes("already used")) {
        // Retry with a random suffix if this internal invoice number was already taken in Square (e.g. reused sandbox or recreated internal booking)
        invoicePayload.invoice.invoice_number = `${params.invoiceNumber}-${Math.floor(Math.random() * 1000)}`;
        invoicePayload.idempotency_key = `inv_${params.bookingId}_${Date.now()}`;
        // Re-set customer ID in case it was updated to the valid email customer
        invoicePayload.invoice.primary_recipient.customer_id = customerId;
        
        invoiceRes = await fetch(`${baseUrl}/v2/invoices`, {
          method: "POST",
          headers,
          body: JSON.stringify(invoicePayload),
        });
      }
      
      if (!invoiceRes.ok) {
        console.error("Square invoice error:", errorText, await invoiceRes.text().catch(() => ""));
        return null;
      }
    }

    const invoiceData = await invoiceRes.json();
    const invoiceId = invoiceData.invoice.id;

    // 4. Publish the Invoice
    const publishRes = await fetch(`${baseUrl}/v2/invoices/${invoiceId}/publish`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        idempotency_key: `pub_${params.bookingId}_${Date.now()}`,
        version: invoiceData.invoice.version,
      }),
    });

    if (!publishRes.ok) {
      console.error("Square invoice publish error:", await publishRes.text());
      return null;
    }

    const publishData = await publishRes.json();
    return {
      id: publishData.invoice.id,
      url: publishData.invoice.public_url,
    };
  } catch (err) {
    console.error("Square invoice creation failed:", err);
    return null;
  }
}