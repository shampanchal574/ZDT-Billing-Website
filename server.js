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

app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  next();
});

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

    // 🔐 STEP 1: Verify Supabase User
    const token = req.headers.authorization?.split(" ")[1];

    const { data: userData, error: userError } =
      await supabase.auth.getUser(token);

    if (userError || !userData.user) {
      console.log("❌ Unauthorized user");
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const email = userData.user.email;
    console.log("👤 Verified User:", email);

    // 🔐 STEP 2: Validate payment fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    // 🔐 STEP 3: Verify signature
    const generated_signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generated_signature !== razorpay_signature) {
      console.log("❌ Signature mismatch");
      return res.json({ success: false, message: "Invalid payment signature" });
    }

    console.log("✅ Payment verified");

    // 🔐 STEP 4: Generate License
    const license = "ZDT-" + uuidv4().slice(0, 8).toUpperCase();
    console.log("🎯 Generated License:", license);

    // 🔐 STEP 5: Store in DB
    const { error } = await supabase.from("licenses").insert([
      {
        license_key: license,
        email: email,
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
    });

  } catch (err) {
    console.error("💥 Verify Payment Crash:", err);
    res.status(500).json({ success: false, message: "Server crash" });
  }
});

// ================= GET LICENSES =================
app.get("/get-licenses", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    const { data: userData, error } =
      await supabase.auth.getUser(token);

    if (error || !userData.user) {
      return res.status(401).json({ success: false });
    }

    const email = userData.user.email;

    const { data, error: dbError } = await supabase
      .from("licenses")
      .select("license_key, created_at")
      .eq("email", email);

    if (dbError) {
      console.error("❌ Fetch Error:", dbError);
      return res.status(500).json({ success: false });
    }

    res.json({ success: true, licenses: data });

  } catch (err) {
    console.error("💥 Get Licenses Crash:", err);
    res.status(500).json({ success: false });
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

    license_key = license_key.trim().toUpperCase();

    const { data, error } = await supabase
      .from("licenses")
      .select("*")
      .eq("license_key", license_key)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ success: false });
    }

    if (!data) {
      return res.json({ success: false, message: "Invalid license" });
    }

    if (!data.active) {
      return res.json({ success: false, message: "Inactive license" });
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
    console.error("💥 Activation Crash:", err);
    res.status(500).json({ success: false });
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});