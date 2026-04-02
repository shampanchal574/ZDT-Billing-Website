require("dotenv").config();

const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");

const app = express();

// ================= GLOBAL ERROR HANDLER =================
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("💥 Unhandled Rejection:", err);
});

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// 🔍 Request Logger
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  next();
});

// ================= ENV DEBUG =================
console.log("Supabase URL:", process.env.SUPABASE_URL);

// ================= INIT =================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  try {
    const order = await razorpay.orders.create({
      amount: 49900,
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
    console.log("🔍 Payment Body:", req.body);

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    const generated_signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generated_signature !== razorpay_signature) {
      console.log("❌ Signature mismatch");
      return res.json({ success: false, message: "Invalid payment signature" });
    }

    console.log("✅ Payment verified");

    const license = "ZDT-" + uuidv4().slice(0, 8).toUpperCase();
    console.log("🎯 Generated License:", license);

    const { error } = await supabase.from("licenses").insert([
      {
        license_key: license,
        active: true,
        device_id: null,
        created_at: new Date(),
      },
    ]);

    if (error) {
      console.error("❌ Supabase Insert Error:", error);
      return res.status(500).json({ success: false, message: "DB insert failed" });
    }

    res.json({
      success: true,
      license,
      download_url: "#",
    });

  } catch (err) {
    console.error("💥 Verify Payment Crash:", err);
    res.status(500).json({ success: false, message: "Server crash" });
  }
});

// ================= ACTIVATE LICENSE =================
app.post("/activate-license", async (req, res) => {
  try {
    console.log("🔐 Activation Body:", req.body);

    let { license_key, device_id } = req.body;

    if (!license_key || !device_id) {
      return res.status(400).json({ success: false, message: "Missing data" });
    }

    // 🔥 Normalize license
    license_key = license_key.trim().toUpperCase();

    console.log("🔍 Searching license:", license_key);

    const { data, error } = await supabase
      .from("licenses")
      .select("*")
      .eq("license_key", license_key)
      .maybeSingle();

    console.log("📊 DB Result:", data, error);

    if (error) {
      console.error("❌ Supabase Fetch Error:", error);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    if (!data) {
      return res.json({ success: false, message: "Invalid license" });
    }

    if (!data.active) {
      return res.json({ success: false, message: "License inactive" });
    }

    // 🔒 First activation
    if (!data.device_id) {
      const { error: updateError } = await supabase
        .from("licenses")
        .update({ device_id })
        .eq("license_key", license_key);

      if (updateError) {
        console.error("❌ Update Error:", updateError);
        return res.status(500).json({ success: false, message: "Update failed" });
      }

      console.log("✅ Activated new device");
      return res.json({ success: true, message: "Activated" });
    }

    // ✅ Same device
    if (data.device_id === device_id) {
      console.log("✅ Same device login");
      return res.json({ success: true, message: "Welcome back" });
    }

    // ❌ Different device
    console.log("❌ Different device attempted");
    return res.json({
      success: false,
      message: "License already used on another device",
    });

  } catch (err) {
    console.error("💥 Activation Crash:", err);
    return res.status(500).json({ success: false, message: "Server crash" });
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});