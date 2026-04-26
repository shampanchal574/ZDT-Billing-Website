require("dotenv").config();

console.log('Server starting...');

const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();

// ================= ERROR HANDLING =================
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("💥 Unhandled Rejection:", err);
});

// ================= MIDDLEWARE =================
app.use(cors({ origin: "*" }));
app.use(express.json());

app.use(express.static(path.join(__dirname, '../frontend')));

// ================= INIT =================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================= HELPER: VERIFY USER =================
async function getUserEmail(req) {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) return null;

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) return null;

    return data.user.email;
  } catch {
    return null;
  }
}

// ================= HOME =================
app.get("/", (req, res) => {
  res.send("✅ Server is running");
});

// ================= GET KEY =================
app.get("/get-key", (req, res) => {
  res.json({ key: process.env.RAZORPAY_KEY_ID });
});

// ================= CREATE ORDER =================
app.post("/create-order", async (req, res) => {
  console.log("Create order endpoint called");
  try {
    const { amount } = req.body;
    console.log("Received amount:", amount);
    const orderAmount = amount || 99900; // Default to ₹999 if no amount provided
    console.log("Using order amount:", orderAmount);

    const order = await razorpay.orders.create({
      amount: orderAmount,
      currency: "INR",
      receipt: "receipt_" + Date.now(),
    });

    res.json(order);
  } catch (err) {
    console.error("❌ Order Error:", err);
    res.status(500).json({ error: "Order creation failed" });
  }
});

// ================= VERIFY PAYMENT =================
app.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      email,
    } = req.body;

    // 🔐 Validate payment
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false });
    }

    // 🔐 Verify signature
    const generated_signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generated_signature !== razorpay_signature) {
      return res.json({ success: false, message: "Invalid signature" });
    }

    console.log("✅ Payment verified");

    // 🔑 Generate License
    const license = "ZDT-" + uuidv4().slice(0, 8).toUpperCase();

    // 💾 Store License with email
    const { error } = await supabase.from("licenses").insert([
      {
        license_key: license,
        email: email || null, // Store email from authenticated user
        active: true,
        device_id: null,
        created_at: new Date(),
      },
    ]);

    if (error) {
      console.error("❌ DB Error:", error);
      return res.status(500).json({ success: false });
    }

    res.json({
      success: true,
      license,
    });

  } catch (err) {
    console.error("💥 Verify Error:", err);
    res.status(500).json({ success: false });
  }
});

// ================= GET LICENSES =================
app.get("/get-licenses", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    let email = null;

    // Try to get email from authenticated token
    if (token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data.user) {
        email = data.user.email;
      }
    }

    if (!email) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const { data, error } = await supabase
      .from("licenses")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ success: false });
    }

    res.json({
      success: true,
      licenses: data,
    });

  } catch (err) {
    console.error("💥 Fetch Error:", err);
    res.status(500).json({ success: false });
  }
});

// ================= ACTIVATE LICENSE =================
app.post("/activate-license", async (req, res) => {
  try {
    let { license_key, device_id } = req.body;

    if (!license_key || !device_id) {
      return res.status(400).json({ success: false });
    }

    license_key = license_key.trim().toUpperCase();

    const { data } = await supabase
      .from("licenses")
      .select("*")
      .eq("license_key", license_key)
      .maybeSingle();

    if (!data) {
      return res.json({ success: false, message: "Invalid license" });
    }

    if (!data.active) {
      return res.json({ success: false, message: "Inactive" });
    }

    if (!data.device_id) {
      await supabase
        .from("licenses")
        .update({ device_id })
        .eq("license_key", license_key);

      return res.json({ success: true, message: "Activated" });
    }

    if (data.device_id === device_id) {
      return res.json({ success: true, message: "Welcome back" });
    }

    return res.json({
      success: false,
      message: "Used on another device",
    });

  } catch (err) {
    console.error("💥 Activation Error:", err);
    res.status(500).json({ success: false });
  }
});

// ================= DOWNLOAD =================
app.get("/download", (req, res) => {
  console.log('Download route hit!');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="zdt-setup.exe"');
  res.send('Placeholder for zdt-setup.exe. Please contact support for the actual download.');
});

// ================= START =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});